// Compare two Claude models on the lighter writing steps of one episode: translation and the storyboard
// critic. Both models get the same inputs. Results go to episodes/<id>/compare/ for a person to read side
// by side; this script prints only what can be counted.
//
//   node tools/compare-light-model.ts --ep my-episode [--a claude-opus-5-5] [--b claude-sonnet-5-5]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Storyboard, episodeDir, readJson, writeJson, type Translations } from "../src/lib/episode.ts";
import { requireKey } from "../src/lib/keys.ts";

const { values } = parseArgs({
  options: {
    ep: { type: "string" },
    a: { type: "string", default: "claude-opus-5-5" },
    b: { type: "string", default: "claude-sonnet-5-5" },
    craft: { type: "string", default: "寿司職人" },
  },
});
if (!values.ep) throw new Error("--ep is required");
requireKey("ANTHROPIC_API_KEY");
const { translate, critique } = await import("../src/lib/storyboard.ts");

const dir = episodeDir(values.ep);
const out = path.join(dir, "compare");
fs.mkdirSync(out, { recursive: true });
const board = readJson(path.join(dir, "storyboard.json"), Storyboard);

// Writing problems the critic must catch, planted in a copy of the storyboard. The veteran's lines are
// left untouched, so any comment on them is a false alarm.
const PLANTED = [
  { where: "title", find: (b: Storyboard) => b.title_ja, set: (b: Storyboard) => (b.title_ja = "湯気の向こうに") },
  { where: "lesson", find: (b: Storyboard) => b.lesson_ja, set: (b: Storyboard) => (b.lesson_ja = "焦らず、素材の声に耳を傾けること。") },
  {
    where: "narration p1",
    find: () => "",
    set: (b: Storyboard) => {
      const n = b.panels[0].balloons.find((x) => x.speaker === "narration");
      if (n) n.text_ja = "その時、運命を分ける一瞬が訪れた。";
    },
  },
  {
    where: "apprentice last panel",
    find: () => "",
    set: (b: Storyboard) => {
      const a = b.panels.at(-1)!.balloons.find((x) => x.speaker === "apprentice");
      if (a) a.text_ja = "湯気が消えたら握りどき、ということですね。";
    },
  },
];
const planted: Storyboard = structuredClone(board);
for (const p of PLANTED) p.set(planted);
const PLANTED_LINES = ["湯気の向こうに", "素材の声", "運命を分ける", "ということですね"];
const masterLines = board.panels.flatMap((p) => p.balloons.filter((b) => b.speaker === "master").map((b) => b.text_ja));

function enWords(t: Translations): number[] {
  return t.balloons.map((b) => b.text.en.trim().split(/\s+/).length);
}

const summary: Record<string, unknown> = {};
for (const model of [values.a!, values.b!]) {
  const tag = model.replace(/^claude-/, "");
  const t0 = Date.now();
  const tr = await translate(board, `第1話　${values.craft}の判断`, model);
  const seconds = (Date.now() - t0) / 1000;
  writeJson(path.join(out, `translations.${tag}.json`), tr);

  const easy = tr.balloons.map((b) => b.text.ja_easy);
  const words = enWords(tr);
  const critic = [];
  for (let run = 1; run <= 2; run++) {
    const issues = await critique(planted, model);
    const caught = PLANTED_LINES.filter((l) => issues.some((i) => i.includes(l)));
    const onMaster = issues.filter((i) => masterLines.some((m) => m.length > 6 && i.includes(m.slice(0, 8))));
    critic.push({ run, caught: `${caught.length}/${PLANTED_LINES.length}`, missed: PLANTED_LINES.filter((l) => !caught.includes(l)), onMaster: onMaster.length, issues });
  }
  writeJson(path.join(out, `critic.${tag}.json`), critic);

  summary[tag] = {
    translate_seconds: seconds,
    en_words_max: Math.max(...words),
    en_over_8: words.filter((w) => w > 8).length,
    easy_with_reading: easy.filter((s) => /[一-鿿][(（][ぁ-ゖ]+[)）]/.test(s)).length,
    easy_spaced: easy.filter((s) => / /.test(s)).length,
    easy_plain_form: easy.filter((s) => /(だ|である)[。！？]?$/.test(s.trim())).length,
    balloons: easy.length,
    master_name: tr.master_name,
    critic: critic.map((c) => ({ caught: c.caught, missed: c.missed, onMaster: c.onMaster, total: c.issues.length })),
  };
  console.log(tag, JSON.stringify(summary[tag], null, 1));
}
writeJson(path.join(out, "summary.json"), summary);
