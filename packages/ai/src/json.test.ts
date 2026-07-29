import { describe, it, expect } from "vitest";
import { extractJson } from "./json.js";

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it("strips ```json code fences", () => {
    expect(extractJson<{ a: number }>('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("strips bare ``` code fences", () => {
    expect(extractJson<{ a: number }>('```\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("returns null for unparseable text", () => {
    expect(extractJson("not json at all")).toBeNull();
  });
});
