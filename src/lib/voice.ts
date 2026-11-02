import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Segment, Storyboard, Transcript } from "./episode.ts";
import { normalize } from "./words.ts";

export interface VoiceClip {
  panel_id: string;
  index: number;
  file: string; // relative to the episode folder
  start: number;
  end: number;
}

const PAD_BEFORE = 0.12;
const PAD_AFTER = 0.25;

// Which recognised token holds a character position. Positions are taken as a fraction of the line,
// so a proofread line of similar length still lines up with the tokens as they were heard.
function tokenAt(seg: Segment, fraction: number): number {
  const lens = seg.tokens.map((t) => normalize(t.text).length);
  const total = lens.reduce((a, b) => a + b, 0);
  let target = Math.min(fraction, 0.999) * total;
  for (let i = 0; i < lens.length; i++) {
    if (target < lens[i]) return i;
    target -= lens[i];
  }
  return lens.length - 1;
}

function startAt(seg: Segment, fraction: number): number {
  if (!seg.tokens.length) return seg.start + fraction * (seg.end - seg.start);
  return seg.tokens[tokenAt(seg, fraction)].start;
}

// The end runs on through the punctuation tokens that follow: whisper gives the trailing breath of a
// phrase to its 。 or 、 rather than to the last word.
function endAt(seg: Segment, fraction: number): number {
  if (!seg.tokens.length) return seg.start + fraction * (seg.end - seg.start);
  let i = tokenAt(seg, fraction);
  while (i + 1 < seg.tokens.length && !normalize(seg.tokens[i + 1].text)) i++;
  return seg.tokens[i].end;
}

// The seconds in which the veteran says exactly the words of one balloon.
export function spokenSpan(text: string, segs: Segment[]): { start: number; end: number } {
  const parts = segs.map((s) => normalize(s.text));
  const want = normalize(text);
  let first: [number, number] | null = null;
  let last: [number, number] | null = null;
  let si = 0;
  let ci = 0;
  for (const ch of want) {
    while (si < parts.length) {
      const k = parts[si].indexOf(ch, ci);
      if (k !== -1) {
        first ??= [si, k];
        last = [si, k];
        ci = k + 1;
        break;
      }
      si++;
      ci = 0;
    }
  }
  if (!first || !last) return { start: segs[0].start, end: segs.at(-1)!.end };
  const len = (i: number) => Math.max(1, parts[i].length);
  return {
    start: startAt(segs[first[0]], first[1] / len(first[0])),
    end: endAt(segs[last[0]], (last[1] + 0.5) / len(last[0])),
  };
}

// Each veteran balloon gets the seconds of the recording it was taken from.
// Every clip is brought to the same loudness, because interview audio and re-recordings differ.
export function cutVoices(board: Storyboard, t: Transcript, sourceAudio: string, epDir: string): VoiceClip[] {
  const byId = new Map(t.segments.map((s) => [s.id, s]));
  const clips: VoiceClip[] = [];
  for (const panel of board.panels) {
    panel.balloons.forEach((b, index) => {
      if (b.speaker !== "master" || b.source_segments.length === 0) return;
      const segs = b.source_segments.map((id) => byId.get(id)).filter((s) => s != null);
      if (!segs.length) return;
      const span = spokenSpan(b.text_ja, segs);
      const start = Math.max(0, span.start - PAD_BEFORE);
      const end = Math.min(t.duration, span.end + PAD_AFTER);
      const rel = `voice/${panel.id}-${index}.m4a`;
      const out = path.join(epDir, rel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error",
        "-ss", start.toFixed(3), "-to", end.toFixed(3), "-i", sourceAudio,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.04",
        "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "96k", out,
      ]);
      clips.push({ panel_id: panel.id, index, file: rel, start: round(start), end: round(end) });
    });
  }
  return clips;
}

const round = (n: number) => Math.round(n * 100) / 100;
