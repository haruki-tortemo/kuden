import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Segment, type Token, type Transcript } from "./episode.ts";

// Speech-to-text runs locally with whisper.cpp, so the craftsman's voice never leaves the Mac at this step.
const MODEL_DIR = process.env.WHISPER_MODEL_DIR ?? path.join(os.homedir(), ".claude/scripts/whisper-models");
const MODEL = process.env.WHISPER_MODEL ?? path.join(MODEL_DIR, "ggml-large-v3-turbo.bin");
const VAD_MODEL = process.env.WHISPER_VAD_MODEL ?? path.join(MODEL_DIR, "ggml-silero-v5.1.2.bin");

interface WhisperJson {
  transcription: {
    offsets: { from: number; to: number };
    text: string;
    tokens?: { text: string; offsets: { from: number; to: number } }[];
  }[];
}

export function toWav(input: string, wav: string): void {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
}

export function probeDuration(file: string): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(out.toString().trim());
}

export function transcribe(wav: string, workDir: string, quiet = false): Transcript {
  if (!fs.existsSync(MODEL)) throw new Error(`Whisper model not found: ${MODEL} (set WHISPER_MODEL)`);
  const base = path.join(workDir, "whisper");
  const args = ["-m", MODEL, "-l", "ja", "-f", wav, "-ojf", "-of", base, "-np", "-ml", "60", "-sow"];
  // VAD is off by default: with it on, whisper.cpp reports token times on a speech-only clock,
  // and the voice clips need the recording's own clock.
  if (process.env.WHISPER_VAD === "1" && fs.existsSync(VAD_MODEL)) args.push("--vad", "-vm", VAD_MODEL);
  // quiet: the live interview transcribes every few seconds, so its progress lines are kept off the terminal
  // (they still come back in the error if whisper fails).
  execFileSync("whisper-cli", args, { stdio: ["ignore", "ignore", quiet ? "pipe" : "inherit"] });
  const raw = JSON.parse(fs.readFileSync(`${base}.json`, "utf8")) as WhisperJson;

  const segments: Segment[] = [];
  for (const row of raw.transcription) {
    const text = row.text.trim();
    if (!text) continue;
    const start = row.offsets.from / 1000;
    const end = row.offsets.to / 1000;
    segments.push({ id: segments.length, start, end, text, tokens: tokenTimes(row.tokens ?? []) });
  }
  return { audio: path.basename(wav), duration: probeDuration(wav), segments };
}

function tokenTimes(raw: NonNullable<WhisperJson["transcription"][number]["tokens"]>): Token[] {
  return raw
    .filter((tk) => !/^\[_.*\]$/.test(tk.text) && tk.text.trim())
    .map((tk) => ({ text: tk.text, start: tk.offsets.from / 1000, end: tk.offsets.to / 1000 }));
}
