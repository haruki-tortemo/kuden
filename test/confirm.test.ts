import { test } from "node:test";
import assert from "node:assert/strict";
import { applyChoices, blockers, changedParts, emptyState, recordedFile } from "../src/lib/confirm.ts";
import type { Storyboard } from "../src/lib/episode.ts";
import type { VoiceClip } from "../src/lib/voice.ts";

const board = {
  title_ja: "t",
  lesson_ja: "l",
  characters: [],
  panels: [
    {
      id: "p1",
      beat: "trouble",
      shot: "medium",
      height: "normal",
      characters: ["master", "apprentice"],
      image_prompt: "",
      balloons: [
        { speaker: "apprentice", kind: "speech", text_ja: "よく冷ましたのに、だめですか？", source_segments: [], anchor: "top-left" },
        { speaker: "master", kind: "speech", text_ja: "目が固くなって、口の中でほどけないんだ。", source_segments: [4], anchor: "top-right" },
      ],
    },
    { id: "p2", beat: "cue", shot: "close", height: "normal", characters: ["master"], image_prompt: "", balloons: [] },
  ],
} as unknown as Storyboard;
const voices: VoiceClip[] = [{ panel_id: "p1", index: 1, file: "voice/p1-1.m4a", start: 1, end: 2 }];

test("changedParts shows only what proofreading changed", () => {
  assert.deepEqual(changedParts("内輪でね、一生懸命仰いで", "団扇でね、一生懸命扇いで"), [
    { from: "内輪", to: "団扇" },
    { from: "仰", to: "扇" },
  ]);
  assert.deepEqual(changedParts("同じ", "同じ"), []);
});

test("a fixed word keeps the old voice until the veteran chooses", () => {
  const state = emptyState();
  state.checked = ["p1", "p2"];
  state.edits["p1#1"] = { text: "米が固くなって、口の中でほどけないんだ。", voice: "differs" };
  assert.match(blockers(board, voices, state).join(), /字と声がずれている/);

  state.edits["p1#1"].voice = "kept";
  assert.deepEqual(blockers(board, voices, state), []);
  const out = applyChoices(board, voices, state);
  assert.equal(out.board.panels[0].balloons[1].text_ja, "米が固くなって、口の中でほどけないんだ。");
  assert.equal(board.panels[0].balloons[1].text_ja, "目が固くなって、口の中でほどけないんだ。", "the storyboard itself is not changed");
  assert.equal(out.voices[0].file, "voice/p1-1.m4a");
});

test("a recorded line replaces the clip, a removed voice is left out", () => {
  const state = emptyState();
  state.edits["p1#1"] = { text: "米が固くなって。", voice: "recorded" };
  assert.equal(applyChoices(board, voices, state).voices[0].file, recordedFile("p1", 1));
  state.removed = ["p1#1"];
  state.edits["p1#1"].voice = "differs";
  assert.equal(applyChoices(board, voices, state).voices.length, 0);
  assert.match(blockers(board, voices, state).join(), /確かめていないコマが 2 つ/);
  assert.doesNotMatch(blockers(board, voices, state).join(), /ずれ/, "a removed voice cannot differ");
});
