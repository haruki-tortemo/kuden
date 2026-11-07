import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addSample } from "../src/lib/sample.ts";

function setup(opts: { checked?: string[]; synthetic?: boolean; panel?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sample-"));
  const epDir = path.join(root, "ep");
  const publishedDir = path.join(root, "out");
  fs.mkdirSync(epDir);
  fs.mkdirSync(path.join(publishedDir, "panels"), { recursive: true });
  fs.writeFileSync(path.join(publishedDir, "index.html"), "<p>page</p>");
  fs.writeFileSync(path.join(publishedDir, "panels", opts.panel ?? "p1.png"), "x");
  fs.writeFileSync(
    path.join(epDir, "storyboard.json"),
    JSON.stringify({
      title_ja: "t",
      lesson_ja: "l",
      setting: "s",
      characters: [],
      panels: [{ id: "p1", beat: "trouble", shot: "medium", height: "normal", characters: [], image_prompt: "", balloons: [] }],
    }),
  );
  fs.writeFileSync(path.join(epDir, "voices.json"), "[]");
  fs.writeFileSync(path.join(epDir, "confirm.json"), JSON.stringify({ checked: opts.checked ?? ["p1"] }));
  if (opts.synthetic) fs.writeFileSync(path.join(epDir, "source.aiff"), "x");
  return { epDir, publishedDir, samplesDir: path.join(root, "samples"), name: "sushi-rice" };
}

test("a confirmed episode is copied, and samples/ opens it", () => {
  const paths = setup();
  const page = addSample(paths);
  assert.equal(fs.readFileSync(page, "utf8"), "<p>page</p>");
  assert.match(fs.readFileSync(path.join(paths.samplesDir, "index.html"), "utf8"), /url=sushi-rice\/index\.html/);
});

test("an episode with panels not passed is refused", () => {
  assert.throws(() => addSample(setup({ checked: [] })), /確かめていないコマ/);
});

test("a synthesised voice is refused", () => {
  assert.throws(() => addSample(setup({ synthetic: true })), /speech synthesiser/);
});

test("placeholder panels are refused", () => {
  assert.throws(() => addSample(setup({ panel: "p1.svg" })), /placeholder/);
});

test("a name that would leave samples/ is refused", () => {
  assert.throws(() => addSample({ ...setup(), name: "../up" }), /sample name/);
});
