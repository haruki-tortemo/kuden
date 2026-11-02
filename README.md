# claude-japan-2026 (working title)

**Turns a veteran's spoken judgment into a manga textbook the next person can learn from.** The veteran talks about one call they make at work that a newcomer would miss, and it becomes a vertical manga episode for young workers, including those who came to Japan from abroad. Tap a panel and you hear the veteran say those words in their own voice; switch the balloons between Japanese, easy Japanese, English, Vietnamese and Portuguese.

Built during Built with Claude: Japan 2026, theme ①: depth only you have. A Japanese version of this README will follow.

> Status: work in progress. The recording → manga → page pipeline runs end to end on a sample recording. The interviewer AI and the confirmation screen are being built.

## How it works

```
recording ─▶ transcript ─▶ storyboard ─▶ panels ─▶ review ─▶ voice clips ─▶ static page
 (local)      + proofread     + translations   (images)   (3 passes)    (local)       (no keys)
```

1. **Transcribe** the recording locally, with a time for every word.
2. **Proofread** the transcript for misheard craft words, then **storyboard** one episode of 4–8 panels. It starts with the apprentice stuck, shows the small cue only the veteran notices, then the judgment, the reason and what the apprentice can now do. Every balloon the veteran speaks is built only from their recorded words, and code checks it word by word against the transcript.
3. **Draw** reference sheets for the two people and for the material the judgment is about, then every panel from those sheets. No text is drawn into the pictures.
4. **Review** every drawn panel three times, one question each: story, people, details. Only problems that would mislead a reader mark a panel for redrawing.
5. **Cut the voice** for each of the veteran's balloons from the recording, using the word times.
6. **Export** a static page that works offline, with no server and no keys.

## The core: three jobs Claude does

| | Job | What Claude does | Status |
|---|---|---|---|
| 1 | **Interviewer** | Asks the veteran about one judgment, without interrupting. It follows the timeline, finds the moment of decision and what they noticed, and asks what a newcomer would miss. | being built |
| 2 | **Storyboard** | Turns the recording into one episode: the apprentice stuck, the cue only the veteran notices, the judgment and the reason. The veteran's balloons use only their recorded words, checked word by word in code. | working |
| 3 | **Three-pass review** | Looks at every drawn panel three times: the story, the people against their sheets, then hands, gaze, objects and stray writing. Only real problems mark a panel for redrawing. | working |

Everything else (transcription, drawing, cutting the voice, the page) supports these three.

## Claude decides and checks, the image model draws

Claude does not output images, so drawing goes to GPT-Image-2.5. Everything around the drawing stays with Claude: what each panel must show, and whether the result really shows it.

| | Claude (Opus 5.5) | GPT-Image-2.5 |
|---|---|---|
| **Decides** | The one judgment the episode teaches, the panels and the order they come in, who stands where, which hand does the work, and how the people and the key material look (written as reference descriptions) | |
| **Hands over** | One picture prompt per panel and per reference sheet. Each prompt names the reference images to use and what not to copy from them, and forbids any text in the picture | Draws the reference sheets for the two people and the material once, then every panel from them |
| **Checks** | Looks at every drawn panel three times (story, people, details), sorts problems into "redraw" and "note", and prints the command that redraws only the marked panels | Redraws only what Claude marked |
| **Never** | Draws pixels | Writes words: every balloon is a separate layer, so the veteran's words and the five languages stay exact |

## How Claude is used, and why each model and setting

| Step | Model | Setting | Why |
|---|---|---|---|
| Proofread the transcript | Claude Opus 5.5 | effort high | Deciding whether a word was misheard needs craft knowledge and context. At medium it missed 米 heard as 目 (`docs/devlog.md` §3). |
| Storyboard | Claude Opus 5.5 | effort high, structured output, up to 3 tries | The hardest step: one teachable judgment, a fixed shape, and the veteran's words kept exactly. Each try is checked in code (veteran's words, balloon lengths, shot variety) before anything else. |
| Critic of the storyboard | Claude Opus 5.5 | effort medium, a separate call | Generation and evaluation are kept apart. The critic only points out slogans, metaphors and lines that add facts, and never touches the veteran's words. |
| Translate | Claude Opus 5.5 | effort medium | Five languages in one call, including easy Japanese with readings. The Japanese shown on the page is always the checked original, never the translator's copy. |
| Review drawn panels | Claude Opus 5.5 (vision) | effort high, 3 passes | Reads the episode as a story, compares people with their sheets, then checks hands, gaze, objects and stray writing. |
| Draw | GPT-Image-2.5 | sheets at max, panels at high | Claude does not output images. Claude writes every picture prompt; the image model draws. The sheets decide how every panel looks, so they get the top setting. |
| Transcribe | whisper.cpp (local) | | The craftsman's voice does not leave the machine at this step. |

We also measured whether translation and the critic could run on Claude Sonnet 5.5, on the same episode. Sonnet was twice as fast, but it put 7 of 19 English balloons over the length rule, garbled one Portuguese line and raised one false alarm as critic, so both steps stay on Opus 5.5 ([`docs/devlog.md`](docs/devlog.md) §4). The model for these two steps is a setting (`CLAUDE_MODEL_LIGHT`), so the comparison (`tools/compare-light-model.ts`) can be run again when models change.

All Claude calls use adaptive thinking and server-side fallback, so a rare decline is retried on another model inside the same request.

## Built with Claude Code

Claude Code was the main developer of this repository. What it used is in `.claude/`:

| | What it does |
|---|---|
| `.claude/hooks/staged-check.mjs` | Before every `git commit`, stops the commit if working data (interviews, generated episodes, design drafts, `.env`), a key, an absolute home path or a private word is staged. Tested in `test/staged-check.test.ts`. |
| `.claude/agents/panel-inspector.md` | A subagent that looks at drawn panels with its own eyes, as a second, independent read next to the API review. |
| `.claude/skills/run-episode/SKILL.md` | The step-by-step way to make an episode, with what to check after each step and what to do when a step goes wrong. |

What broke along the way and how it was fixed, with before and after pictures: [`docs/devlog.md`](docs/devlog.md).

## Run it

Requirements: Node.js 24 or later (developed on 26; TypeScript runs natively, no build step), ffmpeg, whisper.cpp (`whisper-cli`) with a Japanese-capable model.

```bash
npm install
node src/cli.ts all path/to/recording.m4a --ep my-episode --craft 寿司職人
```

Keys for the API steps go in the environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) or in `~/.secrets/anthropic.env` and `~/.secrets/openai.env`. To try the flow without image costs, add `--placeholder`: panels are drawn as labelled boxes.

The finished page is in `out/<episode>/index.html` and opens in any browser.

A person's voice is theirs. By default the voice clips are copied next to the page. With `export --voice-base <url>` they are not copied: the page loads them from storage the speaker agreed to, so the voice never has to be in this repository.

## Data brought in

None yet. The sample craftsman is fictional; his talk was recorded during the hackathon.
