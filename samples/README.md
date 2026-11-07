# Samples

Finished episodes that anyone can open without keys. Each folder is a published page: pictures, balloons in five languages and the speaker's voice, with no server.

Only an episode that has passed the confirmation screen, with a real person's voice and their agreement, comes here. To add one:

```bash
node src/cli.ts sample --ep my-episode --name sushi-rice
```

The command refuses an episode that is not published, still has panels to pass, still has placeholder pictures, or was read by a speech synthesiser. Everything else stays in `episodes/` and `out/`, which are not in the repository.

`samples/index.html` is written by the command and opens the newest sample, so the address stays the same.

## Hosting

`.github/workflows/pages.yml` publishes this folder to GitHub Pages. It runs only when started by hand, and only after Pages is set to "GitHub Actions" in the repository settings.
