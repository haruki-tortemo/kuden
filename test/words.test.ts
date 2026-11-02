import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMasterWords } from "../src/lib/words.ts";
import type { Storyboard, Transcript } from "../src/lib/episode.ts";

const transcript: Transcript = {
  audio: "a.wav",
  duration: 10,
  segments: [
    { id: 0, start: 0, end: 3, text: "えー、温度計は見ない。", tokens: [] },
    { id: 1, start: 3, end: 5, text: "手で覚える。", tokens: [] },
  ],
};

function board(text: string, source_segments = [0, 1], speaker: "master" | "apprentice" = "master"): Storyboard {
  return {
    title_ja: "t",
    lesson_ja: "l",
    setting: "s",
    characters: [],
    panels: [
      {
        id: "p1",
        beat: "judgment",
        shot: "close",
        height: "normal",
        characters: [],
        image_prompt: "x",
        balloons: [{ speaker, kind: "speech", text_ja: text, source_segments, anchor: "top" }],
      },
    ],
  };
}

test("words from the recording pass, with fillers dropped", () => {
  assert.deepEqual(checkMasterWords(board("温度計は見ない。手で覚える。"), transcript), []);
});

test("added words are caught", () => {
  const problems = checkMasterWords(board("温度計は絶対に見ない。"), transcript);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /絶対/);
});

test("reordered words are caught", () => {
  assert.equal(checkMasterWords(board("手で覚える。温度計は見ない。"), transcript).length, 1);
});

test("a master balloon must cite the recording", () => {
  assert.match(checkMasterWords(board("手で覚える", []), transcript)[0], /no source/);
  assert.match(checkMasterWords(board("手で覚える", [7]), transcript)[0], /unknown/);
});

test("apprentice lines are not checked", () => {
  assert.deepEqual(checkMasterWords(board("わかりました！", [], "apprentice"), transcript), []);
});
