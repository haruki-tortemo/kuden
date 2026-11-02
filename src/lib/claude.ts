import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

let client: Anthropic | undefined;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// One structured call. Server-side fallback is on so a rare safety decline is retried on another model
// inside the same request instead of failing the whole episode.
export async function askStructured<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  user: Anthropic.Beta.BetaContentBlockParam[] | string;
  effort?: Effort;
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "high", format: betaZodOutputFormat(opts.schema) },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined: ${response.stop_details?.category ?? "unknown"} ${response.stop_details?.explanation ?? ""}`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("Claude ran out of output tokens; raise maxTokens");
  if (response.parsed_output == null) throw new Error("Claude returned output that did not match the schema");
  return response.parsed_output;
}
