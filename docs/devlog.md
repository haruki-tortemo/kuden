# Development log

What broke while building this, what we tried, and what finally worked. Every image here comes from the sample episode recorded during the hackathon: a fictional sushi chef, played by a team member. It is not real testimony.

## 1. Rice drawn as beads and stars → a material reference sheet

**Problem.** The craft in the sample episode is judging vinegared rice, so the rice has to look like rice. In the first full run, Claude's three-pass panel review flagged the rice in several panels: "drawn as round, pearl-like beads (tapioca-like)" and "small multi-lobed star or flower shapes … reads like popcorn or petals".

**Tried first: better wording.** We added a line to every panel prompt telling the image model to draw food true to life, with separate grains and never beads, stars or flowers. The redrawn panel still had star-shaped grains (picture 2 below).

**What worked: change the input, not the wording.** The wording fix had not touched the defect, so instead of writing more words we changed what the image model sees. The people already had reference sheets, so the material got one too:

1. The storyboard step now asks Claude to name the one material the judgment is about and describe how it really looks up close: piece size, grain, colour, surface, how the pieces sit together.
2. A close-up "material sheet" is drawn once per episode from that description.
3. Every panel that shows the material gets the sheet as an extra reference image, with an instruction to keep its shape and texture but not its framing.

![The same panel: first draw, after the wording fix, after the material sheet](devlog/rice-before-after.jpg)

![The material sheet and a panel drawn with it](devlog/material-sheet.jpg)

**Still open.** In an extreme close-up of a hand on the rice (episode 2, panel 4) the grains are still slightly round. The review now passes it, but to our eye it is borderline.

Code: `src/lib/draw.ts` (`drawMaterial`, the material reference in `panelPrompt`), `src/lib/episode.ts` (`Material`), `src/lib/storyboard.ts` (the `material` instruction).

## 2. The review flagged almost everything → severity

**Problem.** Claude reviews every drawn panel in three passes, one question each: does the episode read as a story, do the people match their reference sheets, and are hands, gaze, objects and stray writing right. The first version marked a panel "check" for any problem it found. In the first run, 7 of 8 panels were marked. Most of the problems were real but harmless: a slightly different angle, a busy corner where a balloon was planned. A redraw list that long is useless, and redrawing costs money.

**What worked.** Every problem now carries a severity. "redraw" is only for what would mislead or put off a reader:

- a person who does not match their sheet
- malformed or extra fingers
- writing in the picture
- the two people on the wrong sides
- the panel's action not shown
- the key material reading as something else

Everything else is a "note", kept for the human but not blocking. Balloons were moved off the picture (see the reader), so empty space for balloons became a note too.

| | Panels marked | What they were |
|---|---|---|
| First run, no severity | 7 of 8 | mostly angle, framing and balloon space |
| Second run, with severity | 3 of 8 | rice in a close-up, digits on a thermometer, a paddle that read as a board. We checked all three by eye, and all three were real. |
| After one redraw of those 3 | 0 of the 3 | |

![A flagged panel and the same panel after one redraw](devlog/review-redraw-p5.jpg)

**Still open.** The review is not fully repeatable. Re-running it on unchanged panels can raise a new valid note, or occasionally a new redraw. We treat the review as a strong first reader, not a final gate.

Code: `src/lib/review.ts` (`SEVERITY`, the three passes), `src/cli.ts` (`review` prints the redraw command).

## 3. 米 heard as 目 → the craftsman confirms their own words

**Problem.** Speech recognition runs locally (whisper.cpp), then Claude proofreads the transcript for misheard craft words before anything else uses it. In the second run, the proofreading fixed four lines, for example 覚まし→冷まし, 内輪→団扇 and 足→端. It missed this one:

> 目が固くなって、口の中でほどけないんだ。 (recorded: **米**が固くなって…)

So the craftsman's balloon in panel 2 says "the *eyes* go hard" instead of "the *rice* goes hard". Raising the proofreading effort from medium to high is in the code now, but this kind of error cannot be fully caught by checking. Every balloon the craftsman speaks is checked word by word against the transcript, and that check passes, because the transcript itself is wrong.

**What we are building.** The craftsman's words are the point of the book, so a person has to confirm them. The confirmation screen (build step 3) shows each of the craftsman's balloons next to the seconds of audio it came from, with the proofreader's corrections marked. The craftsman, or whoever interviewed them, accepts or fixes each line before the episode is drawn and published.

Status: open. The before and after of this screen will be added here when it is built.

Code so far: `src/lib/storyboard.ts` (`PROOFREAD_SYSTEM`, effort `high`), `src/lib/words.ts` (the word-by-word check).
