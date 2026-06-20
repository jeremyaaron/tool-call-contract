import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  analyzeContractSchema,
  createContractRegistry,
  defineConfig,
  defineToolContract,
  exportOpenAITool,
  exportOpenAITools,
} from "../src/index.js";

describe("analyzeContractSchema", () => {
  it("converts supported object schemas to JSON Schema", () => {
    const contract = defineToolContract({
      name: "create_issue",
      description: "Create an issue.",
      input: z.object({
        title: z.string().min(1),
        count: z.number().min(0).default(1),
        enabled: z.boolean(),
        labels: z.array(z.string()),
        kind: z.enum(["bug", "feature"]),
        pinned: z.literal(false),
        maybe: z.string().nullable().optional(),
      }),
    });

    const analysis = analyzeContractSchema(contract);

    expect(analysis.findings).toEqual([]);
    expect(analysis.capabilities).toEqual({
      validate: true,
      fixture: "unsupported",
      openai: "supported",
      docs: "partial",
    });
    expect(analysis.jsonSchema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        title: {
          type: "string",
          minLength: 1,
        },
        count: {
          type: "number",
          minimum: 0,
          default: 1,
        },
        enabled: {
          type: "boolean",
        },
        labels: {
          type: "array",
          items: {
            type: "string",
          },
        },
        kind: {
          type: "string",
          enum: ["bug", "feature"],
        },
        pinned: {
          type: "boolean",
          const: false,
        },
      },
      required: ["title", "enabled", "labels", "kind", "pinned"],
    });
  });

  it("reports schemas that cannot be converted to JSON Schema", () => {
    const contract = defineToolContract({
      name: "schedule_reminder",
      description: "Schedule a reminder.",
      input: z.object({
        when: z.date(),
      }),
    });

    expect(analyzeContractSchema(contract)).toMatchObject({
      capabilities: {
        validate: true,
        fixture: "unsupported",
        openai: "unsupported",
        docs: "unsupported",
      },
      findings: [
        {
          id: "schema.json-schema-unsupported",
          severity: "error",
          contractName: "schedule_reminder",
        },
      ],
    });
  });

  it("reports non-object root schemas as unsupported for OpenAI export", () => {
    const contract = defineToolContract({
      name: "search_docs",
      description: "Search docs.",
      input: z.string(),
    });

    expect(analyzeContractSchema(contract)).toMatchObject({
      jsonSchema: {
        type: "string",
      },
      capabilities: {
        openai: "unsupported",
      },
      findings: [
        {
          id: "schema.root-not-object",
          severity: "error",
          contractName: "search_docs",
        },
      ],
    });
  });
});

describe("OpenAI export", () => {
  it("exports a supported contract as an OpenAI-compatible function tool", () => {
    const contract = defineToolContract({
      name: "search_docs",
      description: "Search documentation.",
      input: z.object({
        query: z.string().describe("Search query."),
      }),
    });

    expect(exportOpenAITool(contract)).toMatchObject({
      contractName: "search_docs",
      tool: {
        type: "function",
        name: "search_docs",
        description: "Search documentation.",
        strict: false,
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query.",
            },
          },
          required: ["query"],
        },
      },
      findings: [],
    });
  });

  it("returns findings instead of a tool for unsupported contracts", () => {
    const contract = defineToolContract({
      name: "search_docs",
      description: "Search documentation.",
      input: z.string(),
    });

    const exported = exportOpenAITool(contract);

    expect(exported.tool).toBeUndefined();
    expect(exported).toMatchObject({
      contractName: "search_docs",
      findings: [
        {
          id: "schema.root-not-object",
        },
      ],
    });
  });

  it("exports every contract in registry order", () => {
    const first = defineToolContract({
      name: "search_docs",
      description: "Search documentation.",
      input: z.object({ query: z.string() }),
    });
    const second = defineToolContract({
      name: "create_issue",
      description: "Create an issue.",
      input: z.object({ title: z.string() }),
    });
    const { registry } = createContractRegistry(defineConfig({ contracts: [first, second] }));

    expect(exportOpenAITools(registry).map((entry) => entry.contractName)).toEqual([
      "search_docs",
      "create_issue",
    ]);
  });
});
