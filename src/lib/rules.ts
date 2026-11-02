import type { Storyboard } from "./episode.ts";

// Storyboard rules that can be counted. Asking the model is not enough, so these are checked in code
// and the problems are sent back to Claude for one more try.
export const LIMITS = {
  minPanels: 4,
  maxPanels: 8,
  shortLine: 25, // apprentice and narration balloons, Japanese characters
  title: 20,
  lesson: 50,
};

const visible = (s: string) => [...s.replace(/[\s　]/g, "")].length;

export function checkRules(board: Storyboard): string[] {
  const problems: string[] = [];
  const n = board.panels.length;
  if (n < LIMITS.minPanels || n > LIMITS.maxPanels) problems.push(`${n} panels; use ${LIMITS.minPanels} to ${LIMITS.maxPanels}`);
  if (board.panels[0]?.beat !== "trouble") problems.push(`the first panel must be the apprentice's trouble (beat "trouble")`);

  const judgment = board.panels.findIndex((p) => p.beat === "judgment");
  if (judgment === -1) problems.push(`no panel with beat "judgment"`);
  else if (!board.panels.slice(0, judgment).some((p) => p.beat === "cue")) problems.push(`no "cue" panel before the judgment`);
  if (!board.panels.some((p) => p.shot === "hands")) problems.push(`no "hands" panel (hands, tools or material in close-up)`);

  board.panels.forEach((p, i) => {
    const prev = board.panels[i - 1];
    if (prev && prev.shot === p.shot) problems.push(`${prev.id} and ${p.id} are both "${p.shot}"; change the shot size between neighbours`);
    p.balloons.forEach((b, j) => {
      if (b.speaker !== "master" && visible(b.text_ja) > LIMITS.shortLine) {
        problems.push(`${p.id} balloon ${j} (${b.speaker}) has ${visible(b.text_ja)} characters; keep it within ${LIMITS.shortLine}`);
      }
    });
  });

  if (visible(board.title_ja) > LIMITS.title) problems.push(`title has ${visible(board.title_ja)} characters; keep it within ${LIMITS.title}`);
  if (visible(board.lesson_ja) > LIMITS.lesson) problems.push(`lesson has ${visible(board.lesson_ja)} characters; keep it within ${LIMITS.lesson}`);
  return problems;
}
