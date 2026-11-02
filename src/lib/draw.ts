import OpenAI, { toFile } from "openai";
import fs from "node:fs";
import path from "node:path";
import { PANEL_SIZE, type Panel, type Storyboard } from "./episode.ts";

// Claude plans every panel; the pixels come from GPT-Image-2.5, because Claude does not output images.
const MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2.5-sunburst";
type Quality = "low" | "medium" | "high" | "xhigh" | "max";
const QUALITY = (process.env.OPENAI_IMAGE_QUALITY ?? "high") as Quality;

export const STYLE = `Full-colour vertical webtoon panel in a clean modern Japanese manga style: confident ink line art, flat cel shading with soft gradients, warm natural light, calm and respectful mood. Same art style in every panel.`;
const NO_TEXT = `Absolutely no text, letters, numbers, signs with writing, speech bubbles, captions or sound effects anywhere in the image.`;


let client: OpenAI | undefined;
function getClient(): OpenAI {
  client ??= new OpenAI();
  return client;
}

function save(b64: string | undefined, file: string): void {
  if (!b64) throw new Error("Image API returned no image data");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
}

function logUsage(logFile: string, what: string, usage: unknown): void {
  fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), model: MODEL, quality: QUALITY, what, usage }) + "\n");
}

export async function drawCharacter(board: Storyboard, id: "master" | "apprentice", file: string, logFile: string): Promise<void> {
  const ch = board.characters.find((c) => c.id === id);
  if (!ch) throw new Error(`Storyboard has no character ${id}`);
  const prompt = [
    STYLE,
    `Character reference sheet for a manga: the same person shown full body from the front and as a face close-up, side by side, on a plain light background.`,
    ch.look,
    NO_TEXT,
  ].join("\n");
  const res = await getClient().images.generate({ model: MODEL, prompt, size: "1536x1024", quality: QUALITY, n: 1 });
  save(res.data?.[0]?.b64_json, file);
  logUsage(logFile, `character:${id}`, res.usage);
}

export function panelPrompt(board: Storyboard, panel: Panel): string {
  const cast = board.characters
    .filter((c) => panel.characters.includes(c.id))
    .map((c, i) => `${c.id === "master" ? "The veteran" : "The apprentice"} (reference image ${i + 1}): ${c.look}`);
  return [
    STYLE,
    `Setting, the same in every panel: ${board.setting}`,
    ...cast,
    cast.length ? `Keep each person's face, hair, build and clothes exactly as in their reference image.` : "",
    `This panel: ${panel.image_prompt}`,
    NO_TEXT,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function drawPanel(
  board: Storyboard,
  panel: Panel,
  refs: Record<string, string>,
  file: string,
  logFile: string,
): Promise<void> {
  const prompt = panelPrompt(board, panel);
  const size = PANEL_SIZE[panel.height];
  const refFiles = panel.characters.map((id) => refs[id]).filter((f): f is string => !!f && fs.existsSync(f));
  const res = refFiles.length
    ? await getClient().images.edit({
        model: MODEL,
        prompt,
        size,
        quality: QUALITY,
        n: 1,
        image: await Promise.all(refFiles.map((f) => toFile(fs.createReadStream(f), path.basename(f), { type: "image/png" }))),
      })
    : await getClient().images.generate({ model: MODEL, prompt, size, quality: QUALITY, n: 1 });
  save(res.data?.[0]?.b64_json, file);
  logUsage(logFile, `panel:${panel.id}`, res.usage);
}
