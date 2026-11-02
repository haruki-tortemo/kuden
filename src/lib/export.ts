import fs from "node:fs";
import path from "node:path";
import { LANG_LABELS, PANEL_SIZE, ROOT, type Storyboard, type Translations } from "./episode.ts";
import type { VoiceClip } from "./voice.ts";

export interface PanelImages {
  [panelId: string]: string; // relative to the episode folder
}

// Writes a static folder (HTML, images, audio) that works with no server and no keys.
export function exportEpisode(opts: {
  epDir: string;
  outDir: string;
  board: Storyboard;
  translations: Translations;
  images: PanelImages;
  voices: VoiceClip[];
  // Where the page loads the voice clips from. Unset: the clips are copied next to the page.
  // Set (a URL or a relative path): the clips are not copied, so a person's voice can live outside
  // this folder and outside the repository, for example on storage the speaker agreed to.
  voiceBase?: string;
}): string {
  const { epDir, outDir, board, translations, images, voices, voiceBase } = opts;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const copy = (rel: string) => {
    const dest = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(epDir, rel), dest);
    return rel;
  };

  const data = {
    title: translations.title,
    kicker: translations.kicker,
    lesson: translations.lesson,
    masterName: translations.master_name,
    langLabels: LANG_LABELS,
    panels: board.panels.map((p) => {
      const [width, height] = PANEL_SIZE[p.height].split("x").map(Number);
      const image = images[p.id];
      if (!image) throw new Error(`No image for panel ${p.id}`);
      return {
        id: p.id,
        beat: p.beat,
        image: copy(image),
        width,
        height,
        balloons: p.balloons.map((b, index) => {
          const t = translations.balloons.find((x) => x.panel_id === p.id && x.index === index);
          const clip = voices.find((v) => v.panel_id === p.id && v.index === index);
          return {
            speaker: b.speaker,
            kind: b.kind,
            anchor: b.anchor,
            text: t?.text ?? { ja: b.text_ja },
            voice: clip ? (voiceBase ? `${voiceBase.replace(/\/+$/, "")}/${clip.file}` : copy(clip.file)) : null,
          };
        }),
      };
    }),
  };

  const tpl = path.join(ROOT, "web/reader");
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const html = fs
    .readFileSync(path.join(tpl, "index.html"), "utf8")
    .replace("__TITLE__", escapeHtml(translations.title.ja))
    .replace("__EPISODE__", () => json);
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  for (const f of ["reader.css", "reader.js"]) fs.copyFileSync(path.join(tpl, f), path.join(outDir, f));
  return path.join(outDir, "index.html");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
