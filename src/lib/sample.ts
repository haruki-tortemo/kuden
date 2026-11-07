import fs from "node:fs";
import path from "node:path";
import { Storyboard, readJson } from "./episode.ts";
import { blockers, emptyState } from "./confirm.ts";
import type { VoiceClip } from "./voice.ts";

// A sample is a published page copied into samples/, so anyone can read it and hear it without keys.
// episodes/ and out/ stay on this Mac; this is the one way a finished episode enters the repository.
// It has to be a real person's voice, drawn for real, and passed panel by panel on the confirmation screen.
export function addSample(opts: { epDir: string; publishedDir: string; samplesDir: string; name: string }): string {
  const { epDir, publishedDir, samplesDir, name } = opts;
  const file = (rel: string) => path.join(epDir, rel);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`Use lower-case letters, digits and hyphens for the sample name: ${name}`);
  if (!fs.existsSync(path.join(publishedDir, "index.html"))) throw new Error("This episode has no published page. Press 公開する on the confirmation screen first.");
  if (!fs.existsSync(file("confirm.json"))) throw new Error("This episode has not been through the confirmation screen.");
  if (fs.existsSync(file("source.aiff"))) throw new Error("This episode was read by a speech synthesiser. A sample carries a real person's voice.");

  const board = readJson(file("storyboard.json"), Storyboard);
  const voices = JSON.parse(fs.readFileSync(file("voices.json"), "utf8")) as VoiceClip[];
  const left = blockers(board, voices, { ...emptyState(), ...JSON.parse(fs.readFileSync(file("confirm.json"), "utf8")) });
  if (left.length) throw new Error(left.join(" "));

  const drawn = fs.readdirSync(path.join(publishedDir, "panels"));
  if (drawn.some((f) => f.endsWith(".svg"))) throw new Error("This episode still has placeholder panels. Draw it without --placeholder.");

  const dest = path.join(samplesDir, name);
  fs.mkdirSync(samplesDir, { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(publishedDir, dest, { recursive: true });

  // The stable address: the README and the hosted page open samples/, which goes to the newest sample.
  const target = `${name}/index.html`;
  fs.writeFileSync(
    path.join(samplesDir, "index.html"),
    `<!doctype html>\n<html lang="ja">\n<meta charset="utf-8">\n<title>${name}</title>\n<meta http-equiv="refresh" content="0; url=${target}">\n<a href="${target}">${name}</a>\n</html>\n`,
  );
  return path.join(dest, "index.html");
}
