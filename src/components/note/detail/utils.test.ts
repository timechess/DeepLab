import { describe, expect, test } from "vitest";
import { safeJsonParse } from "./utils";

describe("safeJsonParse", () => {
  test("unwraps double-encoded note document", () => {
    const parsed = safeJsonParse(
      "\"{\\\"type\\\":\\\"doc\\\",\\\"content\\\":[{\\\"type\\\":\\\"paragraph\\\",\\\"content\\\":[{\\\"type\\\":\\\"text\\\",\\\"text\\\":\\\"hello\\\"}]}]}\"",
    ) as {
      type?: string;
      content?: Array<{ content?: Array<{ text?: string }> }>;
    };
    expect(parsed.type).toBe("doc");
    expect(parsed.content?.[0]?.content?.[0]?.text).toBe("hello");
  });

  test("converts plain text into doc paragraph", () => {
    const parsed = safeJsonParse("legacy markdown line") as {
      type?: string;
      content?: Array<{ content?: Array<{ text?: string }> }>;
    };
    expect(parsed.type).toBe("doc");
    expect(parsed.content?.[0]?.content?.[0]?.text).toBe("legacy markdown line");
  });

  test("converts non-node object into readable text paragraph", () => {
    const parsed = safeJsonParse("{\"title\":\"legacy\",\"foo\":1}") as {
      type?: string;
      content?: Array<{ content?: Array<{ text?: string }> }>;
    };
    expect(parsed.type).toBe("doc");
    expect(parsed.content?.[0]?.content?.[0]?.text).toContain(
      "\"title\":\"legacy\"",
    );
  });
});
