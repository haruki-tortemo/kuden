import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./episode.ts";

// The demo takes one interview all the way to the confirmation screen without a terminal in between:
// after the recording stops, the interview page asks for the episode to be made and shows each step.
// Every step is the same CLI command a person would run by hand, run one after another as a child process.
// A step whose result already exists is skipped, so a run that stopped half way picks up where it was.

export type StepKey = "ingest" | "storyboard" | "draw" | "review" | "redraw" | "voice";

export interface MakeStatus {
  state: "idle" | "running" | "done" | "failed";
  step: StepKey | null;
  steps: StepKey[];
  drawn: number; // panels drawn so far
  panels: number; // panels in the storyboard (0 before it exists)
  sheets: number; // reference sheets drawn so far
  redraw: string[]; // panels the review sent back to be drawn again
  recorded: boolean; // there is a recording to make the episode from
  error: string | null;
  confirm: string | null; // address of the confirmation screen once it is ready
}

export class MakeJob {
  private status: MakeStatus;
  private readonly file: (name: string) => string;
  private readonly opts: { epDir: string; ep: string; craft: string; placeholder: boolean; onDone: () => Promise<string> };

  constructor(opts: MakeJob["opts"]) {
    this.opts = opts;
    this.file = (name) => path.join(opts.epDir, name);
    const steps: StepKey[] = opts.placeholder ? ["ingest", "storyboard", "draw", "voice"] : ["ingest", "storyboard", "draw", "review", "redraw", "voice"];
    this.status = { state: "idle", step: null, steps, drawn: 0, panels: 0, sheets: 0, redraw: [], recorded: false, error: null, confirm: null };
  }

  get recording(): string {
    return this.file("live/recording.webm");
  }

  view(): MakeStatus {
    const panelIds = this.panelIds();
    const exists = (rel: string) => fs.existsSync(this.file(rel));
    return {
      ...this.status,
      panels: panelIds.length,
      drawn: panelIds.filter((id) => exists(`panels/${id}.png`) || exists(`panels/${id}.svg`)).length,
      sheets: ["master", "apprentice", "material"].filter((id) => exists(`characters/${id}.png`)).length,
      recorded: exists("live/recording.webm") || exists("transcript.json"),
    };
  }

  /** Start making the episode, unless it is already being made. */
  start(): void {
    if (this.status.state === "running" || this.status.state === "done") return;
    if (!fs.existsSync(this.recording) && !fs.existsSync(this.file("transcript.json"))) throw new Error("まだ録音がありません。");
    this.status = { ...this.status, state: "running", error: null };
    this.run().catch((err: unknown) => {
      this.status = { ...this.status, state: "failed", error: err instanceof Error ? err.message : String(err) };
    });
  }

  /** When everything was made in an earlier run, go straight to the confirmation screen. */
  async resume(): Promise<void> {
    if (fs.existsSync(this.file("voices.json")) && fs.existsSync(this.file("images.json"))) {
      this.status = { ...this.status, state: "done", step: null, confirm: await this.opts.onDone() };
    }
  }

  private async run(): Promise<void> {
    const { placeholder } = this.opts;
    const has = (name: string) => fs.existsSync(this.file(name));
    for (const step of this.status.steps) {
      this.status.step = step;
      if (step === "ingest" && !has("transcript.json")) await this.cli("ingest", this.recording);
      if (step === "storyboard" && !has("translations.json")) await this.cli("storyboard");
      if (step === "draw") await this.cli("draw", ...(placeholder ? ["--placeholder"] : []));
      if (step === "review" && !has("review.json")) await this.cli("review");
      // One round of redrawing: only the panels the review marked, then they are looked at again.
      if (step === "redraw" && !has("review.round1.json")) {
        this.status.redraw = this.marked();
        if (this.status.redraw.length) {
          fs.copyFileSync(this.file("review.json"), this.file("review.round1.json"));
          await this.cli("draw", "--only", this.status.redraw.join(","));
          await this.cli("review");
        }
      }
      if (step === "voice" && !has("voices.json")) await this.cli("voice");
    }
    this.status = { ...this.status, state: "done", step: null, confirm: await this.opts.onDone() };
  }

  private panelIds(): string[] {
    try {
      return (JSON.parse(fs.readFileSync(this.file("storyboard.json"), "utf8")).panels as { id: string }[]).map((p) => p.id);
    } catch {
      return [];
    }
  }

  private marked(): string[] {
    const reviews = JSON.parse(fs.readFileSync(this.file("review.json"), "utf8")) as { panel_id: string; verdict: string }[];
    return reviews.filter((r) => r.verdict !== "ok").map((r) => r.panel_id);
  }

  private cli(command: string, ...args: string[]): Promise<void> {
    const log = fs.createWriteStream(this.file("make.log"), { flags: "a" });
    log.write(`\n$ ${command} ${args.join(" ")}\n`);
    const child = spawn(process.execPath, [path.join(ROOT, "src/cli.ts"), command, ...args, "--ep", this.opts.ep, "--craft", this.opts.craft], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const keep = (chunk: Buffer) => {
      log.write(chunk);
      tail = (tail + chunk.toString()).slice(-400);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    return new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        log.end();
        if (code === 0) resolve();
        else reject(new Error(`${command} が止まりました: ${tail.trim().split("\n").at(-1) ?? ""}`));
      });
    });
  }
}
