import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ROOT, Storyboard, Transcript, Translations, episodeDir, readJson, writeJson } from "./lib/episode.ts";
import { probeDuration, toWav, transcribe } from "./lib/transcribe.ts";
import { cutVoices, type VoiceClip } from "./lib/voice.ts";
import { exportEpisode, type PanelImages } from "./lib/export.ts";
import { requireKey } from "./lib/keys.ts";
import { drawPlaceholder } from "./lib/placeholder.ts";

const USAGE = `Usage:
  node src/cli.ts ingest <audio file> --ep <id>     recording -> transcript with times (local whisper.cpp)
  node src/cli.ts storyboard --ep <id> [--craft 寿司職人]   transcript -> panels and balloons, then translations (Claude)
  node src/cli.ts draw --ep <id> [--placeholder] [--only p3]  panels -> images (GPT-Image-2.5)
  node src/cli.ts review --ep <id>                    Claude checks every drawn panel in three passes
  node src/cli.ts voice --ep <id>                     cut the veteran's voice for each balloon
  node src/cli.ts export --ep <id> [--out dir] [--voice-base url]   static page you can open or host
                                                      (--voice-base: load voice clips from there instead of copying them)
  node src/cli.ts all <audio file> --ep <id> [--placeholder]
  node src/cli.ts interview --ep <id> [--craft 寿司職人] [--minutes 30] [--port 4174]
                                                      live interview: records, transcribes and suggests the next question
                                                      (afterwards: ingest episodes/<id>/live/recording.webm --ep <id>)`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    ep: { type: "string" },
    craft: { type: "string", default: "寿司職人" },
    number: { type: "string", default: "1" },
    placeholder: { type: "boolean", default: false },
    only: { type: "string" },
    out: { type: "string" },
    "voice-base": { type: "string" },
    minutes: { type: "string", default: "30" },
    port: { type: "string", default: "4174" },
  },
});

const [command, input] = positionals;
if (!command || !values.ep) {
  console.log(USAGE);
  process.exit(command ? 1 : 0);
}
const ep = values.ep;
const dir = episodeDir(ep);
const file = (name: string) => path.join(dir, name);

function ingest(audio: string): void {
  if (!audio || !fs.existsSync(audio)) throw new Error(`Recording not found: ${audio}`);
  fs.mkdirSync(dir, { recursive: true });
  const source = file(`source${path.extname(audio).toLowerCase() || ".audio"}`);
  if (path.resolve(audio) !== source) fs.copyFileSync(audio, source);
  toWav(source, file("source.wav"));
  console.log(`transcribing ${probeDuration(file("source.wav")).toFixed(0)} s of audio…`);
  const t = transcribe(file("source.wav"), dir);
  writeJson(file("transcript.json"), t);
  console.log(`transcript: ${t.segments.length} lines -> ${file("transcript.json")}`);
}

async function storyboard(): Promise<void> {
  requireKey("ANTHROPIC_API_KEY");
  // Loaded here so the local steps (ingest, voice, export) never load the API SDK.
  const { makeStoryboard, proofread, translate } = await import("./lib/storyboard.ts");
  const raw = readJson(file("transcript.json"), Transcript);
  console.log("Claude is checking the transcript for misheard words…");
  const t = await proofread(raw, values.craft!);
  writeJson(file("transcript.checked.json"), t);
  for (const c of t.corrections) console.log(`  [${c.segment_id}] ${c.original} -> ${c.corrected} (${c.reason})`);
  console.log("Claude is building the storyboard…");
  const board = await makeStoryboard(t, values.craft!);
  writeJson(file("storyboard.json"), board);
  console.log(`storyboard: ${board.panels.length} panels, "${board.title_ja}"`);
  console.log("Claude is translating the balloons…");
  writeJson(file("translations.json"), await translate(board, `第${values.number}話　${values.craft}の判断`));
}

async function draw(): Promise<void> {
  const board = readJson(file("storyboard.json"), Storyboard);
  const images: PanelImages = fs.existsSync(file("images.json")) ? JSON.parse(fs.readFileSync(file("images.json"), "utf8")) : {};
  const panels = board.panels.filter((p) => !values.only || values.only.split(",").includes(p.id));
  if (values.placeholder) {
    for (const p of panels) {
      drawPlaceholder(p, file(`panels/${p.id}.svg`));
      images[p.id] = `panels/${p.id}.svg`;
    }
  } else {
    requireKey("OPENAI_API_KEY");
    const { drawCharacter, drawMaterial, drawPanel } = await import("./lib/draw.ts");
    const log = file("draw-log.jsonl");
    const refs: Record<string, string> = {};
    for (const id of ["master", "apprentice"] as const) {
      refs[id] = file(`characters/${id}.png`);
      if (!fs.existsSync(refs[id])) {
        console.log(`drawing the ${id}'s reference sheet…`);
        await drawCharacter(board, id, refs[id], log);
      }
    }
    if (board.material) {
      refs.material = file("characters/material.png");
      if (!fs.existsSync(refs.material)) {
        console.log(`drawing the material sheet (${board.material.name_ja})…`);
        await drawMaterial(board, refs.material, log);
      }
    }
    // Drawn panels are kept: a panel is drawn again only when named with --only (the old one goes to _old/).
    for (const p of panels) {
      const out = file(`panels/${p.id}.png`);
      if (fs.existsSync(out) && !values.only) {
        console.log(`${p.id} already drawn, kept (use --only ${p.id} to draw it again)`);
      } else {
        console.log(`drawing ${p.id} (${p.beat}, ${p.shot})…`);
        await drawPanel(board, p, refs, out, log);
      }
      images[p.id] = `panels/${p.id}.png`;
      writeJson(file("images.json"), images);
    }
  }
  writeJson(file("images.json"), images);
}

async function review(): Promise<void> {
  requireKey("ANTHROPIC_API_KEY");
  const { reviewEpisode } = await import("./lib/review.ts");
  const board = readJson(file("storyboard.json"), Storyboard);
  const rel: PanelImages = JSON.parse(fs.readFileSync(file("images.json"), "utf8"));
  const images = Object.fromEntries(Object.entries(rel).map(([k, v]) => [k, file(v)]));
  const sheets = { master: file("characters/master.png"), apprentice: file("characters/apprentice.png") };
  const reviews = await reviewEpisode(board, images, sheets);
  writeJson(file("review.json"), reviews);
  for (const r of reviews) {
    console.log(`${r.panel_id}: ${r.verdict === "ok" ? "ok" : "check"}`);
    for (const p of r.problems) console.log(`  [${p.pass}/${p.severity}] ${p.what} (${p.where})`);
  }
  const redo = reviews.filter((r) => r.verdict !== "ok").map((r) => r.panel_id);
  if (redo.length) console.log(`to draw again: node src/cli.ts draw --ep ${ep} --only ${redo.join(",")}`);
}

function voice(): void {
  const board = readJson(file("storyboard.json"), Storyboard);
  const checked = file("transcript.checked.json");
  const t = readJson(fs.existsSync(checked) ? checked : file("transcript.json"), Transcript);
  const clips = cutVoices(board, t, file("source.wav"), dir);
  writeJson(file("voices.json"), clips);
  console.log(`voice: ${clips.length} clips`);
}

function exportPage(): void {
  const outDir = values.out ? path.resolve(values.out) : path.join(ROOT, "out", ep);
  const index = exportEpisode({
    epDir: dir,
    outDir,
    board: readJson(file("storyboard.json"), Storyboard),
    translations: readJson(file("translations.json"), Translations),
    images: JSON.parse(fs.readFileSync(file("images.json"), "utf8")),
    voices: JSON.parse(fs.readFileSync(file("voices.json"), "utf8")) as VoiceClip[],
    voiceBase: values["voice-base"],
  });
  console.log(`page: ${index}`);
}

try {
  switch (command) {
    case "ingest": ingest(input!); break;
    case "storyboard": await storyboard(); break;
    case "draw": await draw(); break;
    case "review": await review(); break;
    case "voice": voice(); break;
    case "export": exportPage(); break;
    case "interview": {
      requireKey("ANTHROPIC_API_KEY");
      const { startLiveServer } = await import("./lib/live.ts");
      const port = Number(values.port);
      startLiveServer({ epDir: dir, craft: values.craft!, minutes: Number(values.minutes), port });
      console.log(`interview: http://127.0.0.1:${port}/  (Ctrl+C to stop; the recording is kept in ${path.join(dir, "live")})`);
      break;
    }
    case "all":
      ingest(input!);
      await storyboard();
      await draw();
      if (!values.placeholder) await review();
      voice();
      exportPage();
      break;
    default:
      console.log(USAGE);
      process.exit(1);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
