import { z } from "zod";
import { askStructured } from "./claude.ts";
import type { Segment } from "./episode.ts";

// The interviewer sits beside the person asking the questions (on a video call or in the room) and,
// from what has been said so far, suggests the one next question. The veteran never talks to the tool.
// The shape of the interview follows the Critical Decision Method (Klein, Calderwood & MacGregor, 1989):
// pick one hard incident, hear it told without interruption, mark the decision points, then probe each.

export const PHASES = [
  "opening", // purpose, how long, consent to use the voice
  "axis", // where newcomers get stuck, what they should be able to do after reading
  "incident", // one hard job a newcomer would get wrong
  "telling", // the veteran tells it start to finish; the interviewer only listens
  "timeline", // read back the order, mark where they decided and where they were least sure
  "probes", // for each decision point: cues, knowledge, similar case, goal, options, deciding factor, what-if
  "newcomer", // what a newcomer would miss there, the usual mistake and what follows
  "lineage", // who taught them, words they still remember
  "confirm", // summary in their words, anything that must not be published
  "done",
] as const;

export const PROBES = ["cues", "knowledge", "similar_case", "goal", "options", "deciding_factor", "what_if"] as const;

const Move = z.object({
  phase: z.enum(PHASES),
  covered: z.object({
    opening: z.boolean(),
    newcomer_struggle: z.boolean(),
    goal_for_reader: z.boolean(),
    incident: z.boolean(),
    telling_finished: z.boolean(),
    decision_points: z.array(
      z.object({
        label_ja: z.string(),
        probes_answered: z.array(z.enum(PROBES)),
      }),
    ),
    newcomer_miss: z.boolean(),
    lineage: z.boolean(),
    confirmed: z.boolean(),
  }),
  listen_only: z.boolean(),
  next_question_ja: z.string(),
  why_ja: z.string(),
  backup_question_ja: z.string(),
  notes_ja: z.array(z.string()),
});
export type Move = z.infer<typeof Move>;

const SYSTEM = `You support a person who is interviewing a veteran craftsman, so that one judgment the veteran makes can be passed on to young workers as a short manga. You never speak to the veteran. You read what has been said so far and suggest the ONE question the interviewer should ask next, in natural spoken Japanese that a person can read out as is.

Shape of the interview, in order:
1. opening: why we are asking (to pass their way of working on to young people), about how long it takes, and permission to use their recorded voice in the manga, with the promise that any part can be removed later.
2. axis: where young people most often get stuck in this work, and what they should be able to do after reading.
3. incident: one hard job they remember, one where someone less experienced would hesitate or do it differently. If nothing comes, offer two or three kinds of moments typical of this craft (a sound, a material or a step that was not as usual).
4. telling: ask them to tell it from start to finish while you only listen. Until they clearly finish, set listen_only to true and suggest only a short nudge such as "それで、どうなりました？".
5. timeline: read back the order of what happened in their words, ask what is missing or out of order, then where they decided what to do and where they were least sure. Keep at most three decision points.
6. probes, for each decision point, asking only what the telling has not already answered:
   cues (what they saw, heard, smelled or felt in the hand), knowledge (what one needs to know to judge it and where they learned it), similar_case (a time before that was like this), goal (what exactly they were protecting; if the answer is general, ask for the concrete thing), options (what else came to mind), deciding_factor (why not the other way), what_if (what they would do if one key condition were different).
7. newcomer: what a newcomer standing there would have missed, the mistake newcomers usually make and what happens then.
8. lineage: who taught them this, and words from that person they still remember.
9. confirm: sum up in the veteran's own words and ask what is wrong; ask whether any name, number or in-house matter must not appear.

Rules:
- One question at a time, short, plain spoken Japanese, polite and warm. Never two questions joined together. The opening may put one or two short sentences of explanation before its one question; the length of the interview is given to you, never guess it.
- Never ask what has already been answered. Never suggest an answer inside the question.
- If the answer is "勘" or "経験", go back to the concrete: what did you actually see, hear or feel at that moment.
- If the talk drifts into old stories, let it finish once, then come back to where young people get stuck.
- Never add facts, numbers or reasons the veteran did not say, not even in a summary. Say "私の想像ですが" before anything that is your guess.
- If the veteran sounds tired, suggest closing for today.
- In notes_ja, write at most three short notes for the interviewer only (for example a cue word worth coming back to), in Japanese.
- In covered, mark only what the veteran has actually said. Name each decision point in a few words (about 12 characters), using the veteran's own words where you can, for example 湯気が消えかけた所.`;

function lines(segments: Segment[]): string {
  return segments.map((s) => `[${s.start.toFixed(0)}s] ${s.text}`).join("\n");
}

export async function nextMove(opts: {
  craft: string;
  minutes?: number;
  segments: Segment[];
  asked: string[];
  model?: string;
}): Promise<Move> {
  return askStructured({
    schema: Move,
    system: SYSTEM,
    user: [
      `Craft: ${opts.craft}`,
      `Planned length of the interview: about ${opts.minutes ?? 30} minutes`,
      `Questions the interviewer has asked so far, in order:\n${opts.asked.map((q, i) => `${i + 1}. ${q}`).join("\n") || "(none yet)"}`,
      `What has been said so far (speech recognition, may contain misheard words):\n${lines(opts.segments) || "(nothing yet)"}`,
    ].join("\n\n"),
    // A suggestion has to arrive while the conversation is still on the same point, so keep thinking short.
    effort: "low",
    maxTokens: 4000,
    model: opts.model,
  });
}
