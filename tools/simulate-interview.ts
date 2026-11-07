// Feed a recorded transcript to the interviewer a little at a time, as if the interview were happening,
// and print what it would suggest at each point and how long the suggestion took.
//
//   node tools/simulate-interview.ts --ep my-episode [--model claude-opus-5-5]
import path from "node:path";
import { parseArgs } from "node:util";
import { Transcript, episodeDir, readJson } from "../src/lib/episode.ts";
import { requireKey } from "../src/lib/keys.ts";

const { values } = parseArgs({
  options: { ep: { type: "string" }, craft: { type: "string", default: "寿司職人" }, model: { type: "string" } },
});
if (!values.ep) throw new Error("--ep is required");
requireKey("ANTHROPIC_API_KEY");
const { nextMove } = await import("../src/lib/interviewer.ts");

const dir = episodeDir(values.ep);
const t = readJson(path.join(dir, "transcript.checked.json"), Transcript);
const n = t.segments.length;

// The questions the interviewer is assumed to have asked before the veteran starts telling.
const BEFORE_TELLING = [
  "今日は、若い人にお仕事のやり方を残すために伺います。30 分ほどです。声を漫画で使わせてもらってもいいですか。",
  "若い人が一番つまずくのは、どんな時ですか。",
  "その時のことを、最初から最後まで話してください。口を挟まずに聞きます。",
];

const points = [
  { label: "before anything is said", asked: [], upto: 0 },
  { label: "the veteran is in the middle of telling", asked: BEFORE_TELLING, upto: Math.floor(n * 0.4) },
  { label: "the veteran has finished telling", asked: BEFORE_TELLING, upto: n },
];

for (const p of points) {
  const t0 = Date.now();
  const move = await nextMove({ craft: values.craft!, segments: t.segments.slice(0, p.upto), asked: p.asked, model: values.model });
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== ${p.label} (${p.upto}/${n} lines) — ${seconds}s`);
  console.log(JSON.stringify(move, null, 1));
}
