import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRules } from "../src/lib/rules.ts";
import type { Panel, Storyboard } from "../src/lib/episode.ts";

function panel(id: string, beat: Panel["beat"], shot: Panel["shot"], lines: [Panel["balloons"][number]["speaker"], string][] = []): Panel {
  return {
    id,
    beat,
    shot,
    height: "normal",
    characters: [],
    image_prompt: "x",
    balloons: lines.map(([speaker, text_ja]) => ({ speaker, kind: speaker === "narration" ? "caption" : "speech", text_ja, source_segments: [], anchor: "top" })),
  };
}

const good = (): Storyboard => ({
  title_ja: "酢飯を握る前に温度を見る",
  lesson_ja: "飯台に手を当てて、ぬるいと感じたら握りはじめる。",
  setting: "s",
  characters: [],
  panels: [
    panel("p1", "trouble", "medium", [["apprentice", "親方、うちわはもう止めますか？"]]),
    panel("p2", "cue", "close"),
    panel("p3", "judgment", "hands"),
    panel("p4", "result", "wide", [["narration", "次の朝。"]]),
  ],
});

test("a well-formed storyboard passes", () => {
  assert.deepEqual(checkRules(good()), []);
});

test("neighbouring panels with the same shot are caught", () => {
  const b = good();
  b.panels[1].shot = "medium";
  assert.match(checkRules(b).join("\n"), /p1 and p2 are both "medium"/);
});

test("long apprentice and narration lines are caught, veteran lines are not", () => {
  const b = good();
  b.panels[0].balloons[0].text_ja = "親方、湯気が消えるまでずっとそばで待っていないといけないんですか？";
  b.panels[3].balloons.push({ speaker: "master", kind: "speech", text_ja: "あ".repeat(38), source_segments: [1], anchor: "top" });
  const problems = checkRules(b);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /p1 balloon 0 \(apprentice\)/);
});

test("the episode must open on trouble and have a cue before the judgment", () => {
  const b = good();
  b.panels[0].beat = "cue";
  b.panels[1].beat = "trouble";
  b.panels.reverse();
  const text = checkRules(b).join("\n");
  assert.match(text, /first panel/);
});

test("a missing hands panel and a long title are caught", () => {
  const b = good();
  b.panels[2].shot = "close";
  b.panels[1].shot = "medium";
  b.title_ja = "湯気が消えかけた時に人肌で握るという職人の大切な判断";
  const text = checkRules(b).join("\n");
  assert.match(text, /no "hands" panel/);
  assert.match(text, /title has/);
});
