#!/usr/bin/env node
// PreToolUse hook for Bash: before a `git commit`, look at what is staged and stop the commit when
// something that must stay on this Mac is about to enter the repository.
//   - working data: interviews, generated episodes, the built page, design drafts, .env files
//   - keys that look real
//   - absolute paths into someone's home folder
//   - private words listed one per line in .claude/blocked-words.local.txt (not committed)
// Exit code 2 blocks the tool call and shows the reasons to Claude.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
const command = input.tool_input?.command ?? "";
if (!/\bgit\b[^\n;&|]*\bcommit\b/.test(command)) process.exit(0);

const dir = command.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/)?.[1]?.replace(/^["']|["']$/g, "") ?? input.cwd ?? process.cwd();
const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

let root;
try {
  root = git("rev-parse", "--show-toplevel").trim();
} catch {
  process.exit(0);
}
// Only guard this project, not another repository the command happens to point at.
const real = (p) => fs.realpathSync(path.resolve(p));
if (real(root) !== real(process.env.CLAUDE_PROJECT_DIR ?? root)) process.exit(0);

const problems = [];
const names = git("diff", "--cached", "--name-only").split("\n").filter(Boolean);
const KEEP_LOCAL = [/^episodes\//, /^out\//, /^design\/mocks\//, /(^|\/)\.env(\.|$)/, /\.local\./];
for (const n of names) if (KEEP_LOCAL.some((re) => re.test(n)) && !n.endsWith(".env.example")) problems.push(`staged file must stay local: ${n}`);

const added = git("diff", "--cached", "-U0", "--no-color")
  .split("\n")
  .filter((l) => l.startsWith("+") && !l.startsWith("+++"));

const PATTERNS = [
  [/sk-(ant|proj)-[A-Za-z0-9_-]{16,}/, "something that looks like an API key"],
  [/\b(ANTHROPIC|OPENAI)_API_KEY\s*=\s*\S{8,}/, "an API key assignment"],
  [/\/(Users|home)\/[^/\s]+\//, "an absolute path into a home folder"],
];
const wordsFile = path.join(root, ".claude/blocked-words.local.txt");
const words = fs.existsSync(wordsFile)
  ? fs.readFileSync(wordsFile, "utf8").split("\n").map((w) => w.trim()).filter((w) => w && !w.startsWith("#"))
  : [];

for (const line of added) {
  for (const [re, what] of PATTERNS) if (re.test(line)) problems.push(`${what}: ${line.slice(0, 120)}`);
  for (const w of words) if (line.toLowerCase().includes(w.toLowerCase())) problems.push(`a private word ("${w}"): ${line.slice(0, 120)}`);
}

if (problems.length) {
  process.stderr.write(`Commit stopped by .claude/hooks/staged-check.mjs:\n- ${[...new Set(problems)].join("\n- ")}\nUnstage or fix these, then commit again.\n`);
  process.exit(2);
}
