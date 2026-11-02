import fs from "node:fs";
import path from "node:path";
import { PANEL_SIZE, type Panel } from "./episode.ts";

// Lets the whole pipeline and the reader run before an image key is set: a grey card that shows the plan.
export function drawPlaceholder(panel: Panel, file: string): void {
  const [w, h] = PANEL_SIZE[panel.height].split("x").map(Number);
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const words = panel.image_prompt.split(/\s+/);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines.at(-1);
    if (last && (last + " " + w).length < 58) lines[lines.length - 1] = last + " " + w;
    else lines.push(w);
  }
  const text = lines
    .slice(0, 14)
    .map((l, i) => `<text x="48" y="${120 + i * 34}" font-size="24" fill="#555" font-family="sans-serif">${esc(l)}</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#eceae4"/><text x="48" y="72" font-size="30" font-weight="bold" fill="#333" font-family="sans-serif">${esc(panel.id)} · ${esc(panel.beat)}</text>${text}</svg>`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, svg);
}
