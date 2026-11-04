import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ROOT, type Segment, writeJson } from "./episode.ts";
import { transcribe } from "./transcribe.ts";
import { nextMove, type Move } from "./interviewer.ts";
import type { MakeJob } from "./demo.ts";

// A small server on this Mac for a live interview. The page records the room (or the call) and sends
// the audio every few seconds; the server appends it to one recording, transcribes the new part locally,
// and asks Claude for the next question. Nothing listens beyond 127.0.0.1.
//
// The recording is kept whole (live/recording.webm), so after the interview it goes through `ingest`
// like any other recording and the voice clips come from the full-quality audio.

interface State {
  segments: Segment[]; // settled lines
  pending: Segment | null; // the last line, which may have been cut off mid-word
  settledUntil: number; // seconds into the recording up to which lines are settled
  asked: string[];
  moves: Move[];
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

export function startLiveServer(opts: { epDir: string; craft: string; minutes: number; port: number; job?: MakeJob }): http.Server {
  const live = path.join(opts.epDir, "live");
  fs.mkdirSync(live, { recursive: true });
  const recording = path.join(live, "recording.webm");
  const stateFile = path.join(live, "state.json");
  const state: State = fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
    : { segments: [], pending: null, settledUntil: 0, asked: [], moves: [] };
  const save = () => writeJson(stateFile, state);
  let busy: Promise<unknown> = Promise.resolve();
  // One job at a time: chunks arrive faster than whisper can run, and order matters.
  const queue = <T>(job: () => Promise<T> | T): Promise<T> => {
    const run = busy.then(job, job);
    busy = run.catch(() => {});
    return run;
  };

  function transcribeNew(): void {
    const wav = path.join(live, "tail.wav");
    try {
      // fatal: the file is still being written, so ffmpeg always reports that it ended early.
      execFileSync("ffmpeg", ["-y", "-loglevel", "fatal", "-ss", String(state.settledUntil), "-i", recording, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
    } catch {
      return; // the first bytes may not be decodable yet
    }
    const t = transcribe(wav, live, true);
    const lines = t.segments.map((s) => ({ ...s, start: s.start + state.settledUntil, end: s.end + state.settledUntil, tokens: [] }));
    if (!lines.length) return;
    // Every line but the last is settled; the last is shown but transcribed again next time.
    for (const s of lines.slice(0, -1)) state.segments.push({ ...s, id: state.segments.length });
    state.pending = lines.at(-1)!;
    state.settledUntil = state.pending.start;
  }

  const allLines = () => [...state.segments, ...(state.pending ? [state.pending] : [])];

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
      try {
        if (req.method === "POST" && url.pathname === "/api/audio") {
          const bytes = await body();
          const lines = await queue(() => {
            fs.appendFileSync(recording, bytes);
            transcribeNew();
            save();
            return allLines();
          });
          return json(200, { lines });
        }
        if (req.method === "POST" && url.pathname === "/api/asked") {
          const { question } = JSON.parse((await body()).toString() || "{}");
          if (typeof question === "string" && question.trim()) state.asked.push(question.trim());
          save();
          return json(200, { asked: state.asked });
        }
        if (req.method === "POST" && url.pathname === "/api/next") {
          const move = await nextMove({ craft: opts.craft, minutes: opts.minutes, segments: allLines(), asked: state.asked });
          state.moves.push(move);
          save();
          return json(200, move);
        }
        if (req.method === "GET" && url.pathname === "/api/state") {
          const make = opts.job?.view() ?? null;
          return json(200, { craft: opts.craft, minutes: opts.minutes, lines: allLines(), asked: state.asked, move: state.moves.at(-1) ?? null, make });
        }
        // Only in the demo: make the episode from this recording, and report how far it has got.
        if (opts.job && url.pathname === "/api/make") {
          if (req.method === "POST") await queue(() => opts.job!.start());
          return json(200, opts.job.view());
        }
        // The page itself.
        const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const file = path.join(ROOT, "web/interviewer", path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
        if (req.method === "GET" && file.startsWith(path.join(ROOT, "web/interviewer")) && fs.existsSync(file)) {
          res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
          return res.end(fs.readFileSync(file));
        }
        json(404, { error: "not found" });
      } catch (err) {
        json(500, { error: err instanceof Error ? err.message : String(err) });
      }
    })
    .listen(opts.port, "127.0.0.1");
}
