import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "@clawd/core";

let client: Anthropic | undefined;

/** Whether AI features should run at all — both the feature flag and a key must be present. */
export function isAiEnabled(): boolean {
  const cfg = loadConfig();
  return cfg.AI_FEATURES_ENABLED && Boolean(cfg.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  const cfg = loadConfig();
  if (!cfg.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — check isAiEnabled() before calling askClaude.");
  }
  client ??= new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY });
  return client;
}

/** Sends one message to Claude and returns its text response. Callers should check isAiEnabled() first. */
export async function askClaude(system: string, userMessage: string, maxTokens = 1024): Promise<string> {
  const cfg = loadConfig();
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: cfg.ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude response contained no text block");
  }
  return textBlock.text;
}
