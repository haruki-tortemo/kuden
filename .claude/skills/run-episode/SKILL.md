---
name: run-episode
description: Turn one recording of a craftsman into a finished episode page, step by step, with the check that belongs to each step. Use when asked to make, redo or debug an episode (ingest, storyboard, draw, review, voice, export), or when a step's output looks wrong.
---

# Run one episode

Each step writes into `episodes/<id>/` and can be run again on its own. Steps that call an API need keys in `~/.secrets/` or the environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`); `ingest`, `voice` and `export` run locally with no keys.

| Step | Command | Look at before going on |
|---|---|---|
| 1. Transcribe | `node src/cli.ts ingest <audio> --ep <id>` | `transcript.json` has the times; skim for misheard craft words |
| 2. Storyboard and translate | `node src/cli.ts storyboard --ep <id> --craft <職種>` | The printed proofread corrections (are they right?), then every `master` balloon against what was said. The word check only proves the balloon matches the transcript, not that the transcript is right |
| 3. Draw | `node src/cli.ts draw --ep <id>` | The two people sheets and the material sheet first: every panel copies them. Panels already drawn are kept; redraw one with `--only p3` (the old one moves to `panels/_old/`) |
| 4. Review | `node src/cli.ts review --ep <id>` | Only `redraw` problems mark a panel. Open each marked panel yourself before redrawing; for a second, independent read use the `panel-inspector` subagent |
| 5. Voice | `node src/cli.ts voice --ep <id>` | Play two or three clips: each should hold exactly the craftsman's words of its balloon |
| 6. Export | `node src/cli.ts export --ep <id>` | Open `out/<id>/index.html` at phone width; switch every language and turn the voice on and off |

## When a step goes wrong

- The same drawing defect survives a prompt change: stop editing the words and change what the model sees (a reference image, a separate sheet). That is how the material sheet came about (`docs/devlog.md` §1).
- The review marks almost everything: check whether the problems are real but harmless; severity decides what blocks (`docs/devlog.md` §2).
- A craftsman's balloon reads wrong but the word check passed: the transcript is wrong. Fix it in the confirmation step with the craftsman, never by editing their balloon by hand (`docs/devlog.md` §3).

## Before every commit

The `staged-check` hook stops a commit that stages working data (`episodes/`, `out/`, design drafts, `.env`), something that looks like a key, an absolute home path, or a word from `.claude/blocked-words.local.txt`. Stage files by name; never `git add -A`.
