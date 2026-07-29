/** Parses a JSON object out of an LLM response, tolerating ```json code fences. Null on failure. */
export function extractJson<T>(text: string): T | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}
