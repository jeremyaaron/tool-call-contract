import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  defineToolContract,
  validateToolCall,
  validateToolCalls,
  type ToolCallValidationResult,
} from "../src/index.js";

const createIssue = defineToolContract({
  name: "create_issue",
  description: "Create a GitHub issue.",
  input: z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    labels: z.array(z.string()).default([]),
    priority: z.enum(["low", "high"]).optional(),
  }),
});

const searchDocs = defineToolContract({
  name: "search_docs",
  description: "Search documentation.",
  input: z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).default(5),
  }),
});

describe("validateToolCall", () => {
  it("validates a normalized tool call and returns parsed defaults", () => {
    const result = validateToolCall(createIssue, {
      name: "create_issue",
      arguments: {
        title: "Bug in billing export",
        body: "The CSV contains duplicate rows.",
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        title: "Bug in billing export",
        body: "The CSV contains duplicate rows.",
        labels: [],
      });
      expect(result.call.source).toBe("normalized");
      expectTypeOf(result.value).toEqualTypeOf<z.infer<typeof createIssue.input>>();
    }
  });

  it("validates a toolName/args shaped call", () => {
    const result = validateToolCall(searchDocs, {
      toolName: "search_docs",
      args: { query: "rate limits" },
    });

    expect(result).toMatchObject({
      ok: true,
      contractName: "search_docs",
      value: {
        query: "rate limits",
        limit: 5,
      },
    });
  });

  it("parses JSON-encoded arguments", () => {
    const result = validateToolCall(searchDocs, {
      name: "search_docs",
      arguments: JSON.stringify({ query: "billing", limit: 3 }),
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        query: "billing",
        limit: 3,
      },
    });
  });

  it("reports malformed JSON arguments", () => {
    const result = validateToolCall(searchDocs, {
      name: "search_docs",
      arguments: "{ nope",
    });

    expect(result).toMatchObject({
      ok: false,
      contractName: "search_docs",
      issues: [
        {
          code: "call.invalid-json",
        },
      ],
    });
  });

  it("reports missing arguments", () => {
    const result = validateToolCall(searchDocs, {
      name: "search_docs",
    });

    expect(result).toMatchObject({
      ok: false,
      contractName: "search_docs",
      issues: [
        {
          code: "call.arguments-missing",
        },
      ],
    });
  });

  it("reports a mismatched tool name as unknown", () => {
    const result = validateToolCall(searchDocs, {
      name: "create_issue",
      arguments: { title: "Bug", body: "Details" },
    });

    expect(result).toMatchObject({
      ok: false,
      call: {
        name: "create_issue",
      },
      issues: [
        {
          code: "call.unknown-tool",
        },
      ],
    });
  });

  it("maps required field, invalid type, and enum failures to stable issue codes", () => {
    const result = validateToolCall(createIssue, {
      name: "create_issue",
      arguments: {
        body: 42,
        labels: ["bug"],
        priority: "urgent",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "schema.required-field-missing",
            path: ["title"],
          }),
          expect.objectContaining({
            code: "schema.invalid-type",
            path: ["body"],
          }),
          expect.objectContaining({
            code: "schema.invalid-enum-value",
            path: ["priority"],
          }),
        ]),
      );
    }
  });

  it("normalizes one OpenAI Chat Completions-style tool call", () => {
    const result = validateToolCall(createIssue, {
      tool_calls: [
        {
          id: "call_123",
          function: {
            name: "create_issue",
            arguments: JSON.stringify({
              title: "Bug",
              body: "Details",
              labels: ["bug"],
            }),
          },
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      call: {
        id: "call_123",
        source: "openai-chat",
      },
    });
  });

  it("normalizes one OpenAI Responses-style function call", () => {
    const result = validateToolCall(searchDocs, {
      type: "function_call",
      call_id: "call_456",
      name: "search_docs",
      arguments: JSON.stringify({ query: "exports" }),
    });

    expect(result).toMatchObject({
      ok: true,
      call: {
        id: "call_456",
        source: "openai-responses",
      },
      value: {
        query: "exports",
        limit: 5,
      },
    });
  });
});

describe("validateToolCalls", () => {
  it("validates arrays of calls against multiple contracts", () => {
    const results = validateToolCalls(
      [createIssue, searchDocs],
      [
        {
          name: "create_issue",
          arguments: { title: "Bug", body: "Details" },
        },
        {
          name: "search_docs",
          arguments: { query: "publishing" },
        },
      ],
    );

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it("validates calls from a capture object", () => {
    const results = validateToolCalls([searchDocs], {
      calls: [
        {
          toolName: "search_docs",
          args: { query: "schema" },
        },
      ],
    });

    expect(results).toMatchObject([
      {
        ok: true,
        contractName: "search_docs",
      },
    ]);
  });

  it("validates OpenAI Responses calls nested under output", () => {
    const results = validateToolCalls([createIssue, searchDocs], {
      output: [
        {
          type: "message",
          content: [],
        },
        {
          type: "function_call",
          call_id: "call_search",
          name: "search_docs",
          arguments: JSON.stringify({ query: "responses" }),
        },
        {
          type: "function_call",
          call_id: "call_issue",
          name: "create_issue",
          arguments: JSON.stringify({
            title: "Fixture",
            body: "From Responses output.",
          }),
        },
      ],
    });

    expect(results).toHaveLength(2);
    expect(results).toMatchObject([
      {
        ok: true,
        contractName: "search_docs",
        call: {
          id: "call_search",
          source: "openai-responses",
        },
      },
      {
        ok: true,
        contractName: "create_issue",
        call: {
          id: "call_issue",
          source: "openai-responses",
        },
      },
    ]);
  });

  it("validates OpenAI calls nested under choices", () => {
    const results = validateToolCalls([searchDocs], {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: "search_docs",
                  arguments: JSON.stringify({ query: "fixtures" }),
                },
              },
            ],
          },
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      call: {
        source: "openai-chat",
      },
    });
  });

  it("reports unknown tools", () => {
    const results = validateToolCalls([searchDocs], {
      name: "create_issue",
      arguments: { title: "Bug", body: "Details" },
    });

    expect(results).toMatchObject([
      {
        ok: false,
        call: {
          name: "create_issue",
        },
        issues: [
          {
            code: "call.unknown-tool",
          },
        ],
      },
    ]);
  });

  it("reports unsupported shapes without throwing", () => {
    const results = validateToolCalls([searchDocs], "not a call");

    expect(results).toMatchObject([
      {
        ok: false,
        issues: [
          {
            code: "call.unsupported-shape",
          },
        ],
      },
    ]);
  });

  it("exposes the validation result type", () => {
    expectTypeOf<ToolCallValidationResult>().toMatchTypeOf<
      | {
          ok: true;
          contractName: string;
        }
      | {
          ok: false;
          issues: unknown[];
        }
    >();
  });
});
