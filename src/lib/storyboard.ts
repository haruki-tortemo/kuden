import { askStructured } from "./claude.ts";
import { z } from "zod";
import { Storyboard, Translations, LANGS, type Transcript } from "./episode.ts";
import { assertMasterWords, checkMasterWords } from "./words.ts";
import { checkRules } from "./rules.ts";

const Proofread = z.object({
  corrections: z.array(z.object({ segment_id: z.number().int(), corrected: z.string(), reason: z.string() })),
});
export type Correction = z.infer<typeof Proofread>["corrections"][number] & { original: string };

const STORYBOARD_SYSTEM = `You are the storyboard artist of a manga textbook that passes a veteran craftsman's judgment on to young workers, including workers who came to Japan from abroad and are still learning Japanese.

You receive the transcript of the veteran talking about their work. Each line has an id and a time. Build ONE episode: one judgment the veteran makes that a newcomer would miss.

Shape of the episode (4 to 8 panels, read top to bottom on a phone):
- The first panel shows the apprentice stuck or about to make the newcomer's mistake (beat "trouble").
- Before the judgment, put a "cue" panel: the small sign only the veteran notices (a sound, a colour, a feel in the hand). Draw it big and close.
- Then the judgment, then the reason in the veteran's own words, then what the apprentice can now do.
- If the recording mentions another option the veteran considered and rejected, show it at the judgment. Once per episode the apprentice may ask why the veteran goes that far, and the veteran answers with recorded words.
- Keep the whole episode in one place.

The veteran's words are the point of this book and must stay theirs:
- Every balloon with speaker "master" must be built only from words the veteran actually said. Copy them from the transcript lines you cite in source_segments, in the same order. You may drop fillers (えー, あの, まあ), repeated words and false starts, and you may cut a long line short. Do not add words, facts or opinions the veteran did not say. Do not polish their dialect or tone.
- If something needs explaining and the veteran never said it, let the apprentice ask a question that leads to a recorded answer. Never put new knowledge in the veteran's mouth, and never add numbers, steps or reasons through the narration or the apprentice either.
- A veteran balloon holds at most about 40 Japanese characters. Split long speech across panels.

The apprentice (lines written by you, source_segments []):
- An ordinary newcomer and the reader's stand-in. They ask what they do not know, plainly, and they get things wrong.
- They never say the veteran's answer first, never sum up the lesson, never deliver an admiring punch line. When they understand, show it with an action or a few plain words.
- At most 25 characters, one thing per balloon. Name the thing they mean instead of leaning on これ/それ.

Narration captions (written by you, source_segments []):
- Only when, where and what happened, in a short plain sentence that ends with a verb or です/だ.
- No feelings, no foreshadowing, no drama. At most 25 characters.

Title and lesson (written by you):
- title_ja names the scene in ordinary words a worker would use, so anyone knows in one second what moment of the work this is. No riddles, poetry, metaphors or English-style titles. At most 20 characters.
- lesson_ja is one spoken sentence: what to look at, and what to do then. Use verbs, not a chain of kanji nouns. Not a motto, not an attitude, no metaphor, no noun ending. At most 50 characters.

Pictures:
- Characters: exactly two, ids "master" and "apprentice". In "look", describe in English how each must be drawn every time: age, face, build, and make their hair colour, hairstyle and main clothing colour all different from each other.
- material: the one food or material the judgment is about (name_ja, in Japanese). In "look", describe in English how it really looks up close in a real workplace, so an illustrator can draw it from your words alone: the shape and size of each piece, grain or fibre, colour, surface, and how the pieces sit together.
- shot: wide, medium, close or hands. Neighbouring panels must not have the same shot. Include at least one "hands" panel (hands, tools or material, no faces).
- image_prompt, in English for an image model: the shot, who is in it and what they do, which hand they use (right or left), where they look or point, their expression, the objects, where the light comes from, and which corner stays empty for the balloon (match the balloon anchor). Describe things, not moods. No text, letters, speech bubbles or sound effects in the image.
- When both people are in a panel, keep the apprentice on the left of the frame and the veteran on the right in every panel (balloons read left to right, and the apprentice usually speaks first), and do not line them up facing the camera; show them at an angle, in profile or over a shoulder.
- height: "tall" for the judgment or a dramatic moment, "short" for a quick beat, otherwise "normal".`;

const CRITIC_SYSTEM = `You review the lines a storyboard writer wrote for a manga textbook read by young workers who are still learning Japanese. Point out problems only; do not rewrite anything.
Check only the apprentice balloons, the narration captions, the title and the lesson. Never comment on the veteran's balloons: those are the craftsman's recorded words.
Report a line when it: sounds like a slogan, poem or advert instead of something a person would say out loud; ends on a noun for effect; uses a metaphor or personification; leaves out who did what; has the apprentice give the answer, sum up the lesson or deliver an admiring punch line; adds a fact, number or step the veteran did not say; or makes the title a riddle instead of the name of the scene.
If nothing is wrong, return an empty list.`;

const Critique = z.object({
  issues: z.array(z.object({ where: z.string(), line: z.string(), problem: z.string() })),
});

const PROOFREAD_SYSTEM = `You check a speech-to-text transcript of a Japanese craftsman talking about their work.
Fix only words the recogniser misheard: homophones written with the wrong kanji, and craft terms turned into nonsense (for example 酢飯 heard as a meaningless phrase). Use the craft and the surrounding lines to decide.
Do not fix grammar, dialect, fillers, word order or anything the speaker plausibly said. Do not shorten or add. When unsure, leave the line alone.
Return only the lines you changed, each with the full corrected line and a short reason in Japanese.`;

export async function proofread(t: Transcript, craft: string): Promise<Transcript & { corrections: Correction[] }> {
  const { corrections } = await askStructured({
    schema: Proofread,
    system: PROOFREAD_SYSTEM,
    user: `Craft: ${craft}\n\nTranscript:\n${transcriptText(t)}`,
    effort: "high",
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

const MAX_TRIES = 3;

// Generate, check in code, have a separate call point out writing problems, and send everything found
// back for another try. The veteran's words are checked last and never relaxed.
export async function makeStoryboard(t: Transcript, craft: string, log: (s: string) => void = console.log): Promise<Storyboard> {
  const base = `The veteran's craft: ${craft}\n\nTranscript:\n${transcriptText(t)}`;
  let feedback = "";
  let board: Storyboard | undefined;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    board = await askStructured({
      schema: Storyboard,
      system: STORYBOARD_SYSTEM,
      user: feedback ? `${base}\n\nYour previous storyboard:\n${JSON.stringify(board)}\n\nFix these problems and return the whole storyboard again:\n${feedback}` : base,
      effort: "high",
    });
    const problems = [...checkMasterWords(board, t), ...checkRules(board)];
    if (!problems.length) {
      const { issues } = await askStructured({ schema: Critique, system: CRITIC_SYSTEM, user: JSON.stringify(board), effort: "medium" });
      problems.push(...issues.map((i) => `${i.where}: "${i.line}" ${i.problem}`));
    }
    if (!problems.length) return board;
    log(`  storyboard try ${attempt}: ${problems.length} problem(s)\n    ${problems.join("\n    ")}`);
    feedback = problems.map((p) => `- ${p}`).join("\n");
  }
  // Out of tries: the craftsman's words must still hold; writing-style issues are left for the review screen.
  assertMasterWords(board!, t);
  const hard = checkRules(board!);
  if (hard.length) throw new Error(`Storyboard still breaks the rules after ${MAX_TRIES} tries:\n${hard.join("\n")}`);
  return board!;
}

const TRANSLATE_SYSTEM = `You translate the balloons of a manga textbook for young workers in Japan.
Targets:
- ja: copy the Japanese exactly as given.
- ja_easy: やさしい日本語 for people still learning Japanese. One thing per sentence, です/ます form, no double negatives, no passive voice, common words. Keep craft words such as シャリ or ネタ as they are and give the reading after hard kanji in parentheses, like 包丁(ほうちょう). Put a space between phrases (分かち書き). Keep the meaning and the veteran's warmth.
- en, vi, pt: natural spoken language a young worker would use; keep the craftsman's tone (gruff, kind) and keep craft terms understandable. Keep each line about as short as the Japanese; in English, at most about 8 words per balloon, split into two short sentences if needed.
For master_name, give the natural way to say this title of respect for a head craftsman in each language (en "Master", not a transliteration).
Return every balloon, in order, with the same panel_id and index.`;

export async function translate(board: Storyboard, kicker: string): Promise<Translations> {
  const lines = board.panels.flatMap((p) =>
    p.balloons.map((b, index) => ({ panel_id: p.id, index, speaker: b.speaker, text_ja: b.text_ja })),
  );
  const result = await askStructured({
    schema: Translations,
    system: TRANSLATE_SYSTEM,
    user: [
      `Languages: ${LANGS.join(", ")}`,
      `Title: ${board.title_ja}`,
      `Kicker (episode number and craft): ${kicker}`,
      `Lesson (one sentence under the title): ${board.lesson_ja}`,
      `How the apprentice addresses the veteran (master_name): ${board.characters.find((c) => c.id === "master")?.name_ja ?? "親方"}`,
      `Balloons:\n${JSON.stringify(lines, null, 1)}`,
    ].join("\n"),
    effort: "medium",
  });
  for (const line of lines) {
    const hit = result.balloons.find((b) => b.panel_id === line.panel_id && b.index === line.index);
    const missing = LANGS.filter((l) => !hit?.text[l]);
    if (missing.length) throw new Error(`Translation missing ${missing.join(",")} for ${line.panel_id}#${line.index}`);
  }
  // The Japanese shown on the page is always the checked original, never the translator's copy of it.
  for (const b of result.balloons) {
    const src = board.panels.find((p) => p.id === b.panel_id)?.balloons[b.index];
    if (src) b.text.ja = src.text_ja;
  }
  result.title.ja = board.title_ja;
  result.lesson.ja = board.lesson_ja;
  result.kicker.ja = kicker;
  return result;
}
