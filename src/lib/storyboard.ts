import { askStructured } from "./claude.ts";
import { z } from "zod";
import { Storyboard, Translations, LANGS, type Transcript } from "./episode.ts";
import { assertMasterWords } from "./words.ts";

const Proofread = z.object({
  corrections: z.array(z.object({ segment_id: z.number().int(), corrected: z.string(), reason: z.string() })),
});
export type Correction = z.infer<typeof Proofread>["corrections"][number] & { original: string };

const STORYBOARD_SYSTEM = `You are the storyboard artist of a manga textbook that passes a veteran craftsman's judgment on to young workers, including workers who came to Japan from abroad and are still learning Japanese.

You receive the transcript of the veteran talking about their work. Each line has an id and a time. Build ONE episode: one judgment the veteran makes that a newcomer would miss.

Shape of the episode (4 to 8 panels, read top to bottom on a phone):
- The first panel shows the apprentice stuck or about to make the newcomer's mistake.
- Before the panel where the veteran decides, put a "cue" panel: the small sign only the veteran notices (a sound, a colour, a feel in the hand). Draw it big and close.
- Then the judgment, then the reason in the veteran's own words, then what the apprentice can now do.
- At least one panel is not about faces: hands, tools or material in close-up.
- Keep the whole episode in one place.

The veteran's words are the point of this book and must stay theirs:
- Every balloon with speaker "master" must be built only from words the veteran actually said. Copy them from the transcript lines you cite in source_segments, in the same order. You may drop fillers (えー, あの, まあ), repeated words and false starts, and you may cut a long line short. Do not add words, facts or opinions the veteran did not say. Do not polish their dialect or tone.
- If a judgment needs explaining and the veteran never said it, let the apprentice ask a question or use a narration caption instead. Never put new knowledge in the veteran's mouth.
- Apprentice lines and narration are yours. Keep them short and plain; source_segments is [] for them.
- A balloon holds at most about 40 Japanese characters. Split long speech across panels.

Characters: exactly two, ids "master" and "apprentice". In "look", describe in English how each must be drawn every time: age, face, hair, build, clothes, colours. Make them easy to tell apart at a glance.

For each panel write image_prompt in English for an image model: the shot (close-up / medium / wide / hands), who is in it by name and what they are doing, their expression, the objects, the light, and which corner stays empty for the balloon (match the balloon anchor). Describe things concretely. The image must contain no text, no letters, no speech bubbles and no sound effects; those are added later.

height: "tall" for the judgment or a dramatic moment, "short" for a quick beat, otherwise "normal".`;

const PROOFREAD_SYSTEM = `You check a speech-to-text transcript of a Japanese craftsman talking about their work.
Fix only words the recogniser misheard: homophones written with the wrong kanji, and craft terms turned into nonsense (for example 酢飯 heard as a meaningless phrase). Use the craft and the surrounding lines to decide.
Do not fix grammar, dialect, fillers, word order or anything the speaker plausibly said. Do not shorten or add. When unsure, leave the line alone.
Return only the lines you changed, each with the full corrected line and a short reason in Japanese.`;

export async function proofread(t: Transcript, craft: string): Promise<Transcript & { corrections: Correction[] }> {
  const { corrections } = await askStructured({
    schema: Proofread,
    system: PROOFREAD_SYSTEM,
    user: `Craft: ${craft}\n\nTranscript:\n${transcriptText(t)}`,
    effort: "medium",
  });
  const byId = new Map(corrections.map((c) => [c.segment_id, c]));
  return {
    ...t,
    segments: t.segments.map((s) => (byId.has(s.id) ? { ...s, text: byId.get(s.id)!.corrected } : s)),
    corrections: corrections
      .filter((c) => t.segments.some((s) => s.id === c.segment_id))
      .map((c) => ({ ...c, original: t.segments.find((s) => s.id === c.segment_id)!.text })),
  };
}

function transcriptText(t: Transcript): string {
  return t.segments.map((s) => `[${s.id}] (${s.start.toFixed(1)}s) ${s.text}`).join("\n");
}

export async function makeStoryboard(t: Transcript, craft: string): Promise<Storyboard> {
  const board = await askStructured({
    schema: Storyboard,
    system: STORYBOARD_SYSTEM,
    user: `The veteran's craft: ${craft}\n\nTranscript:\n${transcriptText(t)}`,
    effort: "high",
  });
  assertMasterWords(board, t);
  return board;
}

const TRANSLATE_SYSTEM = `You translate the balloons of a manga textbook for young workers in Japan.
Targets:
- ja: copy the Japanese exactly as given.
- ja_easy: やさしい日本語 for people still learning Japanese. Short sentences, common words, polite plain form. Keep the meaning and the veteran's warmth. Add the reading in parentheses after hard kanji words only when needed, like 包丁(ほうちょう).
- en, vi, pt: natural spoken language a young worker would use; keep the craftsman's tone (gruff, kind) and keep craft terms understandable. Keep each line about as short as the Japanese.
Return every balloon, in order, with the same panel_id and index.`;

export async function translate(board: Storyboard): Promise<Translations> {
  const lines = board.panels.flatMap((p) =>
    p.balloons.map((b, index) => ({ panel_id: p.id, index, speaker: b.speaker, text_ja: b.text_ja })),
  );
  const result = await askStructured({
    schema: Translations,
    system: TRANSLATE_SYSTEM,
    user: `Languages: ${LANGS.join(", ")}\nTitle: ${board.title_ja}\nBalloons:\n${JSON.stringify(lines, null, 1)}`,
    effort: "medium",
  });
  for (const line of lines) {
    const hit = result.balloons.find((b) => b.panel_id === line.panel_id && b.index === line.index);
    const missing = LANGS.filter((l) => !hit?.text[l]);
    if (missing.length) throw new Error(`Translation missing ${missing.join(",")} for ${line.panel_id}#${line.index}`);
  }
  return result;
}
