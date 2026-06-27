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

describe("provider and framework normalization formats", () => {
  it("extracts OpenAI Chat completion tool calls", () => {
    expect(
      normalizeToolCallCaptures(
        {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "call_123",
                    type: "function",
                    function: {
                      name: "create_issue",
                      arguments: '{"title":"Bug"}',
                    },
                  },
                ],
              },
            },
          ],
        },
        { format: "openai-chat", includeSource: true },
      ),
    ).toEqual({
      calls: [
        {
          name: "create_issue",
          arguments: {
            title: "Bug",
          },
          id: "call_123",
          source: "openai-chat",
        },
      ],
      issues: [],
      skipped: 0,
    });
  });

  it("extracts OpenAI Chat message roots and skips non-function calls", () => {
    expect(
      normalizeToolCallCaptures(
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "create_issue",
                arguments: {
                  title: "Bug",
                },
              },
            },
            {
              type: "custom",
            },
          ],
        },
        { format: "openai-chat" },
      ),
    ).toMatchObject({
      calls: [
        {
          name: "create_issue",
          arguments: {
            title: "Bug",
          },
        },
      ],
      issues: [],
      skipped: 1,
    });
  });

  it("extracts OpenAI Responses function calls", () => {
    expect(
      normalizeToolCallCaptures(
        {
          output: [
            {
              type: "message",
              content: [],
            },
            {
              type: "function_call",
              call_id: "call_123",
              name: "create_issue",
              arguments: '{"title":"Bug"}',
            },
          ],
        },
        { format: "openai-responses", includeSource: true },
      ),
    ).toEqual({
      calls: [
        {
          name: "create_issue",
          arguments: {
            title: "Bug",
          },
          id: "call_123",
          source: "openai-responses",
        },
      ],
      issues: [],
      skipped: 1,
    });
  });

  it("extracts direct OpenAI Responses function call items", () => {
    expect(
      normalizeToolCallCaptures(
        {
          type: "function_call",
          call_id: "call_123",
          name: "create_issue",
          arguments: {
            title: "Bug",
          },
        },
        { format: "openai-responses" },
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

  it("extracts Vercel AI SDK toolCalls", () => {
    expect(
      normalizeToolCallCaptures(
        {
          toolCalls: [
            {
              toolCallId: "call_123",
              toolName: "create_issue",
              args: {
                title: "Bug",
              },
            },
          ],
        },
        { format: "vercel-ai-sdk", includeSource: true },
      ).calls,
    ).toEqual([
      {
        name: "create_issue",
        arguments: {
          title: "Bug",
        },
        id: "call_123",
        source: "vercel-ai-sdk",
      },
    ]);
  });

  it("extracts Vercel AI SDK tool parts", () => {
    expect(
      normalizeToolCallCaptures(
        {
          parts: [
            {
              type: "text",
              text: "hello",
            },
            {
              type: "tool-create_issue",
              toolCallId: "call_123",
              input: {
                title: "Bug",
              },
            },
          ],
        },
        { format: "vercel-ai-sdk" },
      ),
    ).toMatchObject({
      calls: [
        {
          name: "create_issue",
          arguments: {
            title: "Bug",
          },
        },
      ],
      issues: [],
      skipped: 1,
    });
  });

  it("extracts LangChain tool calls", () => {
    expect(
      normalizeToolCallCaptures(
        {
          tool_calls: [
            {
              name: "create_issue",
              args: {
                title: "Bug",
              },
              id: "call_123",
            },
          ],
        },
        { format: "langchain", includeSource: true },
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

  it("extracts LangChain arrays of messages in input order", () => {
    const result = normalizeToolCallCaptures(
      [
        {
          tool_calls: [
            {
              name: "search_docs",
              args: {
                query: "billing",
              },
            },
          ],
        },
        {
          tool_calls: [
            {
              name: "create_issue",
              args: {
                title: "Bug",
              },
            },
          ],
        },
      ],
      { format: "langchain" },
    );

    expect(result.calls.map((call) => call.name)).toEqual(["search_docs", "create_issue"]);
    expect(result).toMatchObject({
      issues: [],
      skipped: 0,
    });
  });

  it("extracts generic tool calls from configured paths", () => {
    expect(
      normalizeToolCallCaptures(
        {
          events: [
            {
              toolCall: {
                name: "create_issue",
                arguments: '{"title":"Bug"}',
                id: "call_123",
              },
            },
          ],
        },
        {
          format: "generic",
          includeSource: true,
          generic: {
            callsPath: "events.*.toolCall",
            namePath: "name",
            argumentsPath: "arguments",
            idPath: "id",
          },
        },
      ),
    ).toEqual({
      calls: [
        {
          name: "create_issue",
          arguments: {
            title: "Bug",
          },
          id: "call_123",
          source: "generic",
        },
      ],
      issues: [],
      skipped: 0,
    });
  });

  it("reports missing generic config", () => {
    expect(normalizeToolCallCaptures({}, { format: "generic" })).toMatchObject({
      calls: [],
      issues: [
        {
          code: "normalize.generic-config-missing",
        },
      ],
      skipped: 0,
    });
  });

  it("reports generic path ambiguity", () => {
    expect(
      normalizeToolCallCaptures(
        {
          events: [
            {
              toolCall: {
                names: ["create_issue", "search_docs"],
                arguments: {
                  title: "Bug",
                },
              },
            },
          ],
        },
        {
          format: "generic",
          generic: {
            callsPath: "events.*.toolCall",
            namePath: "names.*",
            argumentsPath: "arguments",
          },
        },
      ),
    ).toMatchObject({
      calls: [],
      issues: [
        {
          code: "normalize.path-ambiguous",
        },
      ],
      skipped: 1,
    });
  });

  it("reports no tool calls for unsupported roots", () => {
    expect(normalizeToolCallCaptures({ choices: [] }, { format: "openai-chat" })).toMatchObject({
      calls: [],
      issues: [
        {
          code: "normalize.no-tool-calls",
        },
      ],
      skipped: 0,
    });
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
