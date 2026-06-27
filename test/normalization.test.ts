import { describe, expect, it } from "vitest";

import {
  normalizeToolCallCapture,
  normalizeToolCallCaptures,
  type NormalizationFormat,
  type NormalizeToolCallsOptions,
  type NormalizeToolCallsResult,
} from "../src/index.js";

describe("normalizeToolCallCaptures", () => {
  it("normalizes a single normalized call", () => {
    expect(
      normalizeToolCallCaptures(
        {
          name: "create_issue",
          arguments: {
            title: "Bug",
          },
        },
        { format: "normalized" },
      ),
    ).toEqual({
      calls: [
        {
          name: "create_issue",
          arguments: {
            title: "Bug",
          },
        },
      ],
      issues: [],
      skipped: 0,
    });
  });

  it("normalizes arrays in input order", () => {
    const result = normalizeToolCallCaptures(
      [
        {
          name: "search_docs",
          arguments: {
            query: "billing exports",
          },
        },
        {
          name: "create_issue",
          arguments: {
            title: "Bug",
          },
        },
      ],
      { format: "normalized" },
    );

    expect(result.calls.map((call) => call.name)).toEqual(["search_docs", "create_issue"]);
    expect(result).toMatchObject({
      issues: [],
      skipped: 0,
    });
  });

  it("supports toolName and args compatibility input", () => {
    expect(
      normalizeToolCallCaptures(
        {
          toolName: "create_issue",
          args: {
            title: "Bug",
          },
        },
        { format: "normalized" },
      ).calls,
    ).toEqual([
      {
        name: "create_issue",
        arguments: {
          title: "Bug",
        },
      },
    ]);
  });

  it("parses JSON string arguments into objects", () => {
    expect(
      normalizeToolCallCaptures(
        {
          name: "create_issue",
          arguments: '{"title":"Bug","priority":"high"}',
        },
        { format: "normalized" },
      ).calls,
    ).toEqual([
      {
        name: "create_issue",
        arguments: {
          title: "Bug",
          priority: "high",
        },
      },
    ]);
  });

  it("omits source metadata by default", () => {
    expect(
      normalizeToolCallCaptures(
        {
          name: "create_issue",
          arguments: {
            title: "Bug",
          },
          id: "call_123",
          source: "langchain",
        },
        { format: "normalized" },
      ).calls,
    ).toEqual([
      {
        name: "create_issue",
        arguments: {
          title: "Bug",
        },
      },
    ]);
  });

  it("includes source metadata when requested", () => {
    expect(
      normalizeToolCallCaptures(
        {
          name: "create_issue",
          arguments: {
            title: "Bug",
          },
          id: "call_123",
          source: "langchain",
        },
        { format: "normalized", includeSource: true },
      ).calls,
    ).toEqual([
      {
        name: "create_issue",
        arguments: {
          title: "Bug",
        },
        id: "call_123",
        source: "langchain",
      },
    ]);
  });

  it("defaults included source metadata to normalized", () => {
    expect(
      normalizeToolCallCaptures(
        {
          name: "create_issue",
          arguments: {
            title: "Bug",
          },
        },
        { format: "normalized", includeSource: true },
      ).calls,
    ).toEqual([
      {
        name: "create_issue",
        arguments: {
          title: "Bug",
        },
        source: "normalized",
      },
    ]);
  });

  it("reports invalid names and arguments", () => {
    expect(
      normalizeToolCallCaptures(
        [
          {
            name: "",
            arguments: {
              title: "Bug",
            },
          },
          {
            name: "create_issue",
          },
          {
            name: "search_docs",
            arguments: "not json",
          },
          {
            name: "summarize_thread",
            arguments: [],
          },
        ],
        { format: "normalized" },
      ),
    ).toMatchObject({
      calls: [],
      issues: [
        {
          code: "normalize.name-missing",
          path: [0, "name"],
        },
        {
          code: "normalize.arguments-missing",
          path: [1],
        },
        {
          code: "normalize.arguments-invalid-json",
          path: [2, "arguments"],
        },
        {
          code: "normalize.arguments-not-object",
          path: [3, "arguments"],
        },
      ],
      skipped: 4,
    });
  });

  it("reports unsupported normalized inputs", () => {
    expect(normalizeToolCallCaptures("nope", { format: "normalized" })).toMatchObject({
      calls: [],
      issues: [
        {
          code: "normalize.input-unsupported",
          path: [],
        },
      ],
      skipped: 1,
    });
  });

  it("reports unsupported formats until provider extractors are implemented", () => {
    expect(normalizeToolCallCaptures({}, { format: "openai-chat" })).toEqual({
      calls: [],
      issues: [
        {
          code: "normalize.format-unsupported",
          message: 'Normalization format "openai-chat" is not implemented yet.',
        },
      ],
      skipped: 0,
    });
  });

  it("exports public normalization types", () => {
    const format: NormalizationFormat = "normalized";
    const options: NormalizeToolCallsOptions = { format };
    const result: NormalizeToolCallsResult = normalizeToolCallCaptures(
      { name: "create_issue", arguments: {} },
      options,
    );

    expect(result.calls).toHaveLength(1);
  });
});

describe("normalizeToolCallCapture", () => {
  it("normalizes a single call without config or file IO", () => {
    expect(
      normalizeToolCallCapture({
        name: "create_issue",
        arguments: {
          title: "Bug",
        },
      }),
    ).toEqual({
      calls: [
        {
          name: "create_issue",
          arguments: {
            title: "Bug",
          },
        },
      ],
      issues: [],
      skipped: 0,
    });
  });

  it("preserves provided source metadata", () => {
    expect(
      normalizeToolCallCapture({
        name: "create_issue",
        arguments: {
          title: "Bug",
        },
        id: "call_123",
        source: "generic",
      }).calls,
    ).toEqual([
      {
        name: "create_issue",
        arguments: {
          title: "Bug",
        },
        id: "call_123",
        source: "generic",
      },
    ]);
  });
});
