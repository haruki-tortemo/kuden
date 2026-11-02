import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export const EPISODES_DIR = path.join(ROOT, "episodes");

export const LANGS = ["ja", "ja_easy", "en", "vi", "pt"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_LABELS: Record<Lang, string> = {
  ja: "日本語",
  ja_easy: "やさしい日本語",
  en: "English",
  vi: "Tiếng Việt",
  pt: "Português",
};

export const Token = z.object({ text: z.string(), start: z.number(), end: z.number() });
export type Token = z.infer<typeof Token>;

export const Segment = z.object({
  id: z.number().int(),
  start: z.number(), // seconds
  end: z.number(),
  text: z.string(),
  tokens: z.array(Token).default([]), // as recognised, before proofreading
});
export type Segment = z.infer<typeof Segment>;

export const Transcript = z.object({
  audio: z.string(),
  duration: z.number(),
  segments: z.array(Segment),
});
export type Transcript = z.infer<typeof Transcript>;

// What Claude returns for the storyboard ("name" in manga terms).
export const Balloon = z.object({
  speaker: z.enum(["master", "apprentice", "narration"]),
  kind: z.enum(["speech", "thought", "caption"]),
  text_ja: z.string(),
  source_segments: z.array(z.number().int()),
  anchor: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "top", "bottom"]),
});
export type Balloon = z.infer<typeof Balloon>;

export const Panel = z.object({
  id: z.string(),
  beat: z.enum(["trouble", "cue", "judgment", "reason", "result", "summary"]),
  height: z.enum(["short", "normal", "tall"]),
  characters: z.array(z.enum(["master", "apprentice"])),
  image_prompt: z.string(),
  balloons: z.array(Balloon),
});
export type Panel = z.infer<typeof Panel>;

// Every panel is 1024 px wide so the page scrolls as one column; only the height changes.
export const PANEL_SIZE: Record<Panel["height"], string> = {
  short: "1024x640",
  normal: "1024x1024",
  tall: "1024x1536",
};

export const Character = z.object({
  id: z.enum(["master", "apprentice"]),
  name_ja: z.string(),
  look: z.string(),
});

export const Storyboard = z.object({
  title_ja: z.string(),
  lesson_ja: z.string(),
  setting: z.string(),
  characters: z.array(Character),
  panels: z.array(Panel),
});
export type Storyboard = z.infer<typeof Storyboard>;

// Explicit keys rather than a record: structured outputs need a closed object.
const PerLang = z.object({ ja: z.string(), ja_easy: z.string(), en: z.string(), vi: z.string(), pt: z.string() });

export const Translations = z.object({
  title: PerLang,
  balloons: z.array(
    z.object({
      panel_id: z.string(),
      index: z.number().int(),
      text: PerLang,
    }),
  ),
});
export type Translations = z.infer<typeof Translations>;

export function episodeDir(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Episode id must be lowercase letters, digits and dashes: ${id}`);
  return path.join(EPISODES_DIR, id);
}

export function readJson<T>(file: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
