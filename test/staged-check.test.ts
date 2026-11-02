import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOOK = path.resolve(import.meta.dirname, "../.claude/hooks/staged-check.mjs");

// A throwaway repository, so the test never touches this project's staging area.
function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "staged-check-"));
  execFileSync("git", ["init", "-q", dir]);
  fs.mkdirSync(path.join(dir, ".claude"));
  fs.writeFileSync(path.join(dir, ".claude/blocked-words.local.txt"), "# private\nsecretword\n");
  return dir;
}

function run(dir: string, command: string) {
  return spawnSync("node", [HOOK], {
    input: JSON.stringify({ tool_input: { command }, cwd: dir }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: "utf8",
  });
}

function stage(dir: string, file: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  execFileSync("git", ["-C", dir, "add", "-f", file]);
}

test("lets a clean commit through and ignores other commands", () => {
  const dir = repo();
  stage(dir, "src/a.ts", "export const a = 1;\n");
  assert.equal(run(dir, `git -C ${dir} commit -m x`).status, 0);
  assert.equal(run(dir, "ls -la").status, 0);
});

test("stops working data, home paths, keys and private words", () => {
  // Built at run time so this file does not trip the hook when it is committed.
  const home = ["", "Users", "someone", "project"].join("/");
  const key = ["sk", "ant", "abcdefghijklmnopqrstu"].join("-");
  for (const [file, text] of [
    ["episodes/x/transcript.json", "{}\n"],
    ["docs/a.md", `see ${home}\n`],
    ["docs/b.md", `key ${key}\n`],
    ["docs/c.md", "this mentions SecretWord here\n"],
  ]) {
    const dir = repo();
    stage(dir, file, text);
    const r = run(dir, `git -C ${dir} commit -m x`);
    assert.equal(r.status, 2, `${file} should be stopped`);
    assert.match(r.stderr, /Commit stopped/);
  }
});
