import OpenAI, { toFile } from "openai";
import fs from "node:fs";
import path from "node:path";
import { PANEL_SIZE, type Panel, type Storyboard } from "./episode.ts";

// Claude plans every panel; the pixels come from GPT-Image-2.5, because Claude does not output images.
const MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2.5-sunburst";
type Quality = "low" | "medium" | "high" | "xhigh" | "max";
const QUALITY = (process.env.OPENAI_IMAGE_QUALITY ?? "high") as Quality;
// The two reference sheets decide how every panel looks, so they get the top setting.
const SHEET_QUALITY = (process.env.OPENAI_IMAGE_QUALITY_SHEET ?? "max") as Quality;

export const STYLE = `Full-colour vertical webtoon panel in a clean modern Japanese manga style: confident ink line art, flat cel shading with soft gradients, warm natural light, calm and respectful mood. Same art style in every panel.`;
const NO_TEXT = `Absolutely no text, letters, numbers, signs with writing, speech bubbles, captions or sound effects anywhere in the image.`;
const AVOID = `Avoid: malformed or extra hands, extra, missing or fused fingers, twisted wrists, glossy plastic-looking skin, logos and watermarks.`;
const STAGING = `When both people are in the frame, the apprentice is on the left and the veteran on the right. Do not line them up facing the camera; show them at an angle, in profile or over a shoulder.`;

let client: OpenAI | undefined;
function getClient(): OpenAI {
  client ??= new OpenAI();
  return client;
}

// A finished image is never overwritten in place: the previous version moves to _old/ first.
function save(b64: string | undefined, file: string): void {
  if (!b64) throw new Error("Image API returned no image data");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const old = path.join(path.dirname(file), "_old");
    fs.mkdirSync(old, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.renameSync(file, path.join(old, `${path.basename(file, ".png")}-${stamp}.png`));
  }
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
}

function logUsage(logFile: string, what: string, quality: Quality, usage: unknown): void {
  fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), model: MODEL, quality, what, usage }) + "\n");
}

export async function drawCharacter(board: Storyboard, id: "master" | "apprentice", file: string, logFile: string): Promise<void> {
  const ch = board.characters.find((c) => c.id === id);
  if (!ch) throw new Error(`Storyboard has no character ${id}`);
  const prompt = [
    STYLE,
    `Character reference sheet for a manga: the same person shown full body from the front and as a face close-up, side by side, on a plain light background.`,
    ch.look,
    AVOID,
    NO_TEXT,
  ].join("\n");
  const res = await getClient().images.generate({ model: MODEL, prompt, size: "1536x1024", quality: SHEET_QUALITY, n: 1 });
  save(res.data?.[0]?.b64_json, file);
  logUsage(logFile, `character:${id}`, SHEET_QUALITY, res.usage);
}

// Reference images are passed in the order of panel.characters, and the prompt numbers them the same way.
export function panelPrompt(board: Storyboard, panel: Panel): string {
  const cast = panel.characters.map((id, i) => {
    const c = board.characters.find((x) => x.id === id);
    return `${id === "master" ? "The veteran" : "The apprentice"} is reference image ${i + 1}: ${c?.look ?? ""}`;
  });
  return [
    STYLE,
    `Setting, the same in every panel: ${board.setting}`,
    ...cast,
    cast.length
      ? `From each reference sheet take only that person's face, hair, build and clothes, exactly as drawn. Do not copy the sheet's side-by-side layout, its poses, its empty space or its plain background.`
      : "",
    panel.characters.length === 2 ? STAGING : "",
    `This panel: ${panel.image_prompt}`,
    AVOID,
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
  // A missing reference would silently give a stranger's face, so stop instead of drawing without it.
  const refFiles = panel.characters.map((id) => {
    const f = refs[id];
    if (!f || !fs.existsSync(f)) throw new Error(`Reference sheet for ${id} is missing (${f ?? "none"}); draw it before ${panel.id}`);
    return f;
  });
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
  logUsage(logFile, `panel:${panel.id}`, QUALITY, res.usage);
}
