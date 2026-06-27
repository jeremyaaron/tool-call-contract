import { describe, expect, it } from "vitest";

import { parsePathSelector, selectPathValues } from "../src/path-selectors.js";

describe("path selectors", () => {
  it("parses valid dot paths", () => {
    expect(parsePathSelector("events.*.toolCall.arguments")).toEqual({
      ok: true,
      selector: {
        source: "events.*.toolCall.arguments",
        segments: ["events", "*", "toolCall", "arguments"],
      },
    });
  });

  it("rejects empty paths", () => {
    expect(parsePathSelector("")).toMatchObject({
      ok: false,
      message: "Path selector must be a non-empty dot path.",
    });
  });

  it("rejects empty path segments", () => {
    expect(parsePathSelector("events..toolCall")).toMatchObject({
      ok: false,
      message: 'Path selector "events..toolCall" contains an empty segment at index 1.',
    });
  });

  it("selects object property values", () => {
    const selector = parseSelector("event.toolCall.name");

    expect(
      selectPathValues(
        {
          event: {
            toolCall: {
              name: "create_issue",
            },
          },
        },
        selector,
      ),
    ).toEqual(["create_issue"]);
  });

  it("selects array index values", () => {
    const selector = parseSelector("choices.1.message.tool_calls.0.id");

    expect(
      selectPathValues(
        {
          choices: [
            {
              message: {
                tool_calls: [{ id: "ignored" }],
              },
            },
            {
              message: {
                tool_calls: [{ id: "call_123" }],
              },
            },
          ],
        },
        selector,
      ),
    ).toEqual(["call_123"]);
  });

  it("selects wildcard object values", () => {
    const selector = parseSelector("metadata.*");

    expect(
      selectPathValues(
        {
          metadata: {
            authorization: "Bearer abc",
            cookie: "session=123",
          },
        },
        selector,
      ),
    ).toEqual(["Bearer abc", "session=123"]);
  });

  it("selects wildcard array values", () => {
    const selector = parseSelector("events.*.toolCall.name");

    expect(
      selectPathValues(
        {
          events: [
            {
              toolCall: {
                name: "search_docs",
              },
            },
            {
              toolCall: {
                name: "create_issue",
              },
            },
          ],
        },
        selector,
      ),
    ).toEqual(["search_docs", "create_issue"]);
  });

  it("returns no values for missing paths", () => {
    const selector = parseSelector("events.0.toolCall.name");

    expect(selectPathValues({ events: [] }, selector)).toEqual([]);
  });
});

function parseSelector(path: string) {
  const parsed = parsePathSelector(path);

  if (!parsed.ok) {
    throw new Error(parsed.message);
  }

  return parsed.selector;
}
