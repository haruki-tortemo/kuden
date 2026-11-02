import type { Storyboard, Transcript } from "./episode.ts";

// The veteran's balloons may only use words from the recording. The prompt asks for this; this check enforces it.
// A balloon passes when its characters appear in the cited lines in the same order: cutting fillers and
// trimming is allowed, adding or reordering words is not.
export function checkMasterWords(board: Storyboard, t: Transcript): string[] {
  const byId = new Map(t.segments.map((s) => [s.id, s]));
  const problems: string[] = [];
  for (const panel of board.panels) {
    panel.balloons.forEach((b, i) => {
      if (b.speaker !== "master") return;
      const where = `${panel.id} balloon ${i}`;
      if (b.source_segments.length === 0) return problems.push(`${where}: no source lines`);
      const missing = b.source_segments.filter((id) => !byId.has(id));
      if (missing.length) return problems.push(`${where}: unknown lines ${missing.join(",")}`);
      const source = normalize(b.source_segments.map((id) => byId.get(id)!.text).join(""));
      const unsaid = notInOrder(normalize(b.text_ja), source);
      if (unsaid.length > 0) problems.push(`${where}: not in the recording: ${unsaid.join("")}`);
    });
  }
  return problems;
}

export function assertMasterWords(board: Storyboard, t: Transcript): void {
  const problems = checkMasterWords(board, t);
  if (problems.length) throw new Error(`Storyboard changed the veteran's words:\n${problems.join("\n")}`);
}

export function normalize(s: string): string {
  return s.normalize("NFKC").replace(/[\s、。，．,.!?！？「」『』…ー〜~・]/g, "");
}

function notInOrder(text: string, source: string): string[] {
  const out: string[] = [];
  let j = 0;
  for (const ch of text) {
    const k = source.indexOf(ch, j);
    if (k === -1) out.push(ch);
    else j = k + 1;
  }
  return out;
}
