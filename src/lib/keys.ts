import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Keys come from the environment, or from one-line files kept outside the repository:
//   ~/.secrets/anthropic.env   ANTHROPIC_API_KEY=...
//   ~/.secrets/openai.env      OPENAI_API_KEY=...
const SECRETS_DIR = process.env.SECRETS_DIR ?? path.join(os.homedir(), ".secrets");

export function loadKey(name: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY"): boolean {
  if (process.env[name]?.trim()) return true;
  const file = path.join(SECRETS_DIR, name === "OPENAI_API_KEY" ? "openai.env" : "anthropic.env");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  for (const line of text.split("\n")) {
    const [k, ...rest] = line.split("=");
    if (k?.trim() === name && rest.join("=").trim()) {
      process.env[name] = rest.join("=").trim().replace(/^["']|["']$/g, "");
      return true;
    }
  }
  return false;
}

export function requireKey(name: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY"): void {
  if (!loadKey(name)) {
    throw new Error(`${name} is not set. Export it, or put "${name}=..." in ${SECRETS_DIR}/${name === "OPENAI_API_KEY" ? "openai" : "anthropic"}.env`);
  }
}
