import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ROOT, Storyboard, Translations, readJson, writeJson } from "./episode.ts";
import { exportEpisode, type PanelImages } from "./export.ts";
import { LOUDNESS, type VoiceClip } from "./voice.ts";

// Before anything is published, the veteran goes through the finished episode with the interviewer:
// listen to each of their lines, fix a word, record a line again or take a voice out, and say which
// proofreading changes are right. The choices are kept in confirm.json; storyboard.json and voices.json
// stay as they were made, so every choice can be undone.

export interface ConfirmState {
  checked: string[]; // panels the veteran passed
  // Keyed "p2#1". voice: "differs" = the text was changed and the voice still says the old words.
  edits: Record<string, { text: string; voice: "differs" | "kept" | "recorded" }>;
  removed: string[]; // balloons whose voice is taken out
  corrections: Record<string, "ok" | "reverted">; // keyed by transcript segment id
}

export const balloonKey = (panel: string, index: number) => `${panel}#${index}`;
export const emptyState = (): ConfirmState => ({ checked: [], edits: {}, removed: [], corrections: {} });
export const recordedFile = (panel: string, index: number) => `voice/${panel}-${index}.rec.m4a`;

// The changed parts of a proofread line, so the screen can show 内輪 → 団扇 instead of two whole sentences.
export function changedParts(original: string, corrected: string): { from: string; to: string }[] {
  const a = [...original];
  const b = [...corrected];
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const parts: { from: string; to: string }[] = [];
  let cur: { from: string; to: string } | null = null;
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      if (cur) parts.push(cur);
      cur = null;
      i++;
      j++;
    } else {
      cur ??= { from: "", to: "" };
      if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) cur.to += b[j++];
      else cur.from += a[i++];
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

// The episode as the veteran left it: their wording, and only the voices they kept.
export function applyChoices(board: Storyboard, voices: VoiceClip[], state: ConfirmState): { board: Storyboard; voices: VoiceClip[] } {
  const out = structuredClone(board);
  for (const p of out.panels) p.balloons.forEach((b, i) => (b.text_ja = state.edits[balloonKey(p.id, i)]?.text ?? b.text_ja));
  const kept = voices
    .filter((v) => !state.removed.includes(balloonKey(v.panel_id, v.index)))
    .map((v) => (state.edits[balloonKey(v.panel_id, v.index)]?.voice === "recorded" ? { ...v, file: recordedFile(v.panel_id, v.index) } : v));
  return { board: out, voices: kept };
}

// What still stops publishing, in the words the screen shows.
export function blockers(board: Storyboard, voices: VoiceClip[], state: ConfirmState): string[] {
  const out: string[] = [];
  const unchecked = board.panels.filter((p) => !state.checked.includes(p.id)).length;
  if (unchecked) out.push(`確かめていないコマが ${unchecked} つあります。`);
  const differs = Object.entries(state.edits).filter(
    ([k, e]) => e.voice === "differs" && !state.removed.includes(k) && voices.some((v) => balloonKey(v.panel_id, v.index) === k),
  ).length;
  if (differs) out.push(`字と声がずれているセリフが ${differs} つあります。録り直すか、このまま使うかを選んでください。`);
  return out;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".m4a": "audio/mp4",
  ".json": "application/json",
};

export function startConfirmServer(opts: { epDir: string; ep: string; number: string; port: number }): http.Server {
  const { epDir } = opts;
  const file = (name: string) => path.join(epDir, name);
  const board = readJson(file("storyboard.json"), Storyboard);
  const images: PanelImages = JSON.parse(fs.readFileSync(file("images.json"), "utf8"));
  const voices: VoiceClip[] = JSON.parse(fs.readFileSync(file("voices.json"), "utf8"));
  const checked = file("transcript.checked.json");
  const corrections = fs.existsSync(checked)
    ? (JSON.parse(fs.readFileSync(checked, "utf8")).corrections ?? []) as { segment_id: number; original: string; corrected: string; reason: string }[]
    : [];
  const stateFile = file("confirm.json");
  const state: ConfirmState = fs.existsSync(stateFile) ? { ...emptyState(), ...JSON.parse(fs.readFileSync(stateFile, "utf8")) } : emptyState();
  const outDir = path.join(ROOT, "out", opts.ep);
  const save = () => writeJson(stateFile, state);
  const hasVoice = (panel: string, index: number) => voices.some((v) => v.panel_id === panel && v.index === index);
  const uncheck = (panel: string) => (state.checked = state.checked.filter((id) => id !== panel));

  function setText(panel: string, index: number, text: string, voice: "differs" | "kept") {
    const k = balloonKey(panel, index);
    const original = board.panels.find((p) => p.id === panel)?.balloons[index]?.text_ja;
    if (original === undefined) throw new Error(`No balloon ${k}`);
    if (text === original) delete state.edits[k];
    else state.edits[k] = { text, voice: hasVoice(panel, index) ? voice : "kept" };
    uncheck(panel);
  }

  function view() {
    const current = applyChoices(board, voices, state);
    return {
      title: board.title_ja,
      kicker: `第${opts.number}話`,
      checked: state.checked,
      blockers: blockers(board, voices, state),
      published: fs.existsSync(path.join(outDir, "index.html")) ? "/published/index.html" : null,
      panels: board.panels.map((p, pi) => {
        const used = new Set(p.balloons.flatMap((b) => b.source_segments));
        return {
          id: p.id,
          image: `/ep/${images[p.id]}`,
          balloons: p.balloons.map((b, index) => {
            const k = balloonKey(p.id, index);
            const clip = current.voices.find((v) => v.panel_id === p.id && v.index === index);
            return {
              index,
              speaker: b.speaker,
              kind: b.kind,
              text: current.board.panels[pi].balloons[index].text_ja,
              original: b.text_ja,
              edited: k in state.edits,
              hasVoice: hasVoice(p.id, index),
              voice: clip ? `/ep/${clip.file}?v=${fs.existsSync(file(clip.file)) ? fs.statSync(file(clip.file)).mtimeMs : 0}` : null,
              voiceState: state.edits[k]?.voice ?? null,
              removed: state.removed.includes(k),
            };
          }),
          corrections: corrections
            .filter((c) => used.has(c.segment_id))
            .map((c) => ({ segment: c.segment_id, parts: changedParts(c.original, c.corrected), reason: c.reason, state: state.corrections[c.segment_id] ?? null })),
        };
      }),
    };
  }

  async function publish(): Promise<string> {
    const left = blockers(board, voices, state);
    if (left.length) throw new Error(left.join(" "));
    const current = applyChoices(board, voices, state);
    let translations = readJson(file("translations.json"), Translations);
    if (Object.keys(state.edits).length) {
      // Changed wording has to be translated again; the translation step only loads when it is needed.
      const { requireKey } = await import("./keys.ts");
      requireKey("ANTHROPIC_API_KEY");
      const { translate } = await import("./storyboard.ts");
      translations = await translate(current.board, translations.kicker.ja);
      writeJson(file("translations.confirmed.json"), translations);
    }
    exportEpisode({ epDir, outDir, board: current.board, translations, images, voices: current.voices });
    return "/published/index.html";
  }

  return http
    .createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(body));
      };
      const body = async () => {
        const parts: Buffer[] = [];
        for await (const c of req) parts.push(c as Buffer);
        return Buffer.concat(parts);
      };
      const serve = (root: string, rel: string) => {
        const f = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
        if (!f.startsWith(root + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return json(404, { error: "not found" });
        res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream", "cache-control": "no-store" });
        res.end(fs.readFileSync(f));
      };
      try {
        if (req.method === "GET" && url.pathname === "/api/episode") return json(200, view());
        if (req.method === "POST" && url.pathname.startsWith("/api/")) {
          const action = url.pathname.slice(5);
          if (action === "record") {
            // A line recorded again on this screen, brought to the same loudness as the interview clips.
            const panel = url.searchParams.get("panel") ?? "";
            const index = Number(url.searchParams.get("index"));
            if (!hasVoice(panel, index)) throw new Error("This line has no voice to record again");
            const tmp = file(`voice/${panel}-${index}.rec.webm`);
            fs.writeFileSync(tmp, await body());
            execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp, "-af", `${LOUDNESS},afade=t=in:d=0.04`, "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "96k", file(recordedFile(panel, index))]);
            fs.rmSync(tmp);
            const k = balloonKey(panel, index);
            const text = state.edits[k]?.text ?? board.panels.find((p) => p.id === panel)!.balloons[index].text_ja;
            state.edits[k] = { text, voice: "recorded" };
            state.removed = state.removed.filter((r) => r !== k);
            uncheck(panel);
            save();
            return json(200, view());
          }
          const input = JSON.parse((await body()).toString() || "{}");
          const { panel, index } = input as { panel: string; index: number };
          if (action === "edit") {
            setText(panel, index, String(input.text ?? "").trim(), "differs");
            // A line fixed by hand supersedes any earlier answer about the proofreading on it, so ask again.
            for (const id of board.panels.find((p) => p.id === panel)?.balloons[index]?.source_segments ?? []) delete state.corrections[id];
          }
          else if (action === "keep") {
            const e = state.edits[balloonKey(panel, index)];
            if (e) e.voice = "kept";
            uncheck(panel);
          } else if (action === "remove") {
            const k = balloonKey(panel, index);
            state.removed = input.removed ? [...new Set([...state.removed, k])] : state.removed.filter((r) => r !== k);
            uncheck(panel);
          } else if (action === "correction") {
            const c = corrections.find((x) => x.segment_id === input.segment);
            if (!c) throw new Error(`No correction for line ${input.segment}`);
            state.corrections[c.segment_id] = input.state === "reverted" ? "reverted" : "ok";
            if (input.state === "reverted") {
              // Put the heard words back into every line made from that part of the recording.
              // The voice says the heard words, so it still matches.
              for (const p of board.panels)
                p.balloons.forEach((b, i) => {
                  if (!b.source_segments.includes(c.segment_id)) return;
                  let text = state.edits[balloonKey(p.id, i)]?.text ?? b.text_ja;
                  for (const part of changedParts(c.original, c.corrected)) if (part.to) text = text.replace(part.to, part.from);
                  setText(p.id, i, text, "kept");
                });
            }
          } else if (action === "checked") {
            uncheck(panel);
            if (input.checked) state.checked.push(panel);
          } else if (action === "publish") {
            const page = await publish();
            return json(200, { ...view(), published: page });
          } else return json(404, { error: "not found" });
          save();
          return json(200, view());
        }
        if (req.method === "GET" && url.pathname.startsWith("/ep/")) return serve(epDir, decodeURIComponent(url.pathname.slice(4)));
        if (req.method === "GET" && url.pathname.startsWith("/published/")) return serve(outDir, decodeURIComponent(url.pathname.slice(11)));
        if (req.method === "GET") return serve(path.join(ROOT, "web/confirm"), url.pathname === "/" ? "index.html" : url.pathname.slice(1));
        json(404, { error: "not found" });
      } catch (err) {
        json(500, { error: err instanceof Error ? err.message : String(err) });
      }
    })
    .listen(opts.port, "127.0.0.1");
}
