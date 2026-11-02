import fs from "node:fs";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { askStructured } from "./claude.ts";
import type { Panel, Storyboard } from "./episode.ts";

// Claude looks at every drawn panel three times, each pass with one question, the way an editor checks
// pages: the story first, then the people, then the small things. Problems come back per panel.
const Finding = z.object({
  panel_id: z.string(),
  ok: z.boolean(),
  problems: z.array(z.object({ what: z.string(), where: z.string() })),
});
const Pass = z.object({ panels: z.array(Finding) });
type Finding = z.infer<typeof Finding>;

export interface PanelReview {
  panel_id: string;
  verdict: "ok" | "check";
  problems: { pass: "story" | "people" | "detail"; what: string; where: string }[];
}

type Block = Anthropic.Beta.BetaContentBlockParam;

function image(file: string): Block {
  return { type: "image", source: { type: "base64", media_type: "image/png", data: fs.readFileSync(file).toString("base64") } };
}

function plan(p: Panel): string {
  const lines = p.balloons.map((b) => `${b.speaker}: ${b.text_ja}`).join(" / ");
  return `${p.id} (${p.beat}, ${p.shot}, people: ${p.characters.join(", ") || "none"})\nplanned picture: ${p.image_prompt}\nballoons added later: ${lines || "none"}`;
}

const STORY = `You are the editor of a manga textbook. You see every panel of one episode in reading order, with the plan for each.
Read it top to bottom as a reader would. For each panel, say whether the picture shows what its plan says and whether the episode can be followed from one panel to the next. Also check that when both people appear, the veteran stays on the left and the apprentice on the right.
Speech balloons are added later, so their absence is not a problem. Report concrete problems only, with where in the panel they are.`;

const PEOPLE = `You compare a manga panel with the reference sheets of the people in it.
For each person in the panel, compare face, hairstyle, hair colour, build, age and clothes with their sheet, and report every difference you can see. Say which person and where in the panel.
Differences in pose, angle and expression are expected and are not problems.`;

const DETAIL = `You check one manga panel for drawing mistakes, looking closely at one area at a time.
Look at each hand: count what you see and say whether it looks like a natural hand, and which hand is doing the action. Look at where each person is looking or pointing. Look at tools, food and objects for broken shapes, at the background for things that melt into each other, and for any letters, numbers or writing that appear in the picture.
Compare with the plan: the hand used and the direction of gaze should match it. Report concrete problems only, with where they are.`;

export async function reviewEpisode(
  board: Storyboard,
  images: Record<string, string>,
  sheets: Record<string, string>,
  log: (s: string) => void = console.log,
): Promise<PanelReview[]> {
  const panels = board.panels.filter((p) => images[p.id]?.endsWith(".png") && fs.existsSync(images[p.id]));
  if (!panels.length) throw new Error("No drawn panels to review (placeholders are not reviewed)");
  const result = new Map<string, PanelReview>(panels.map((p) => [p.id, { panel_id: p.id, verdict: "ok", problems: [] }]));
  const add = (pass: PanelReview["problems"][number]["pass"], f: Finding) => {
    const r = result.get(f.panel_id);
    if (!r) return;
    for (const p of f.problems) r.problems.push({ pass, ...p });
    if (!f.ok || f.problems.length) r.verdict = "check";
  };

  log("review 1/3: reading the episode as a whole…");
  const story = await askStructured({
    schema: Pass,
    system: STORY,
    user: panels.flatMap((p): Block[] => [{ type: "text", text: plan(p) }, image(images[p.id])]),
    effort: "high",
  });
  story.panels.forEach((f) => add("story", f));

  log("review 2/3: comparing the people with their reference sheets…");
  for (const p of panels.filter((x) => x.characters.length)) {
    const refs = p.characters.flatMap((id): Block[] =>
      sheets[id] && fs.existsSync(sheets[id]) ? [{ type: "text", text: `Reference sheet: ${id === "master" ? "the veteran" : "the apprentice"}` }, image(sheets[id])] : [],
    );
    const people = await askStructured({
      schema: Pass,
      system: PEOPLE,
      user: [...refs, { type: "text", text: `Panel to check:\n${plan(p)}` }, image(images[p.id])],
      effort: "high",
    });
    people.panels.forEach((f) => add("people", { ...f, panel_id: p.id }));
  }

  log("review 3/3: hands, gaze, objects and stray writing…");
  for (const p of panels) {
    const detail = await askStructured({
      schema: Pass,
      system: DETAIL,
      user: [{ type: "text", text: plan(p) }, image(images[p.id])],
      effort: "high",
    });
    detail.panels.forEach((f) => add("detail", { ...f, panel_id: p.id }));
  }
  return [...result.values()];
}
