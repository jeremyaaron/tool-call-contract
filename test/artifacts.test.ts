import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createContractRegistry,
  defineConfig,
  defineToolContract,
  formatJson,
  generateArtifacts,
  hashContent,
  renderToolMarkdownDoc,
} from "../src/index.js";

describe("formatJson and hashContent", () => {
  it("formats JSON deterministically", () => {
    expect(formatJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n',
    );
  });

  it("hashes final file content", () => {
    expect(hashContent("hello\n")).toHaveLength(64);
    expect(hashContent("hello\n")).toBe(hashContent("hello\n"));
  });
});

describe("renderToolMarkdownDoc", () => {
  it("renders field metadata, fixtures, and provider path", () => {
    const contract = defineToolContract({
      name: "search_docs",
      description: "Search documentation.",
      input: z.object({ query: z.string() }),
    });

    const markdown = renderToolMarkdownDoc({
      contract,
      jsonSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query.",
          },
          limit: {
            type: "number",
            default: 5,
          },
          kind: {
            type: "string",
            enum: ["api", "guide"],
          },
        },
        required: ["query"],
      },
      validFixture: {
        name: "search_docs",
        arguments: {
          query: "docs",
        },
      },
      invalidFixture: {
        name: "search_docs",
        arguments: {},
      },
      openAiSchemaPath: ".tool-call-contract/schemas/search_docs.openai.json",
    });

    expect(markdown).toContain("# search_docs");
    expect(markdown).toContain("| query | yes | string |  |  | Search query. |");
    expect(markdown).toContain("| limit | no | number | 5 |  |  |");
    expect(markdown).toContain('| kind | no | string |  | "api", "guide" |  |');
    expect(markdown).toContain(
      "OpenAI schema: `.tool-call-contract/schemas/search_docs.openai.json`",
    );
    expect(markdown.endsWith("\n")).toBe(true);
  });
});

describe("generateArtifacts", () => {
  it("generates fixtures, OpenAI schema, docs, and manifest in memory", () => {
    const registry = createRegistry();

    const result = generateArtifacts(registry, {
      version: "0.1.0",
    });

    expect(result.findings).toEqual([]);
    expect(result.artifacts.map((artifact) => artifact.path)).toEqual([
      ".tool-call-contract/fixtures/search_docs.valid.json",
      ".tool-call-contract/fixtures/search_docs.invalid.json",
      ".tool-call-contract/schemas/search_docs.openai.json",
      ".tool-call-contract/docs/search_docs.md",
      ".tool-call-contract/fixtures/create_issue.valid.json",
      ".tool-call-contract/fixtures/create_issue.invalid.json",
      ".tool-call-contract/schemas/create_issue.openai.json",
      ".tool-call-contract/docs/create_issue.md",
      ".tool-call-contract/manifest.json",
    ]);
    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      generator: {
        name: "tool-call-contract",
        version: "0.1.0",
      },
      generatedAt: null,
      contracts: [
        {
          name: "search_docs",
        },
        {
          name: "create_issue",
        },
      ],
    });
    expect(result.manifest.files).toHaveLength(8);
    expect(
      result.artifacts.every((artifact) => artifact.hash === hashContent(artifact.content)),
    ).toBe(true);
  });

  it("is deterministic across repeated runs", () => {
    const registry = createRegistry();

    const first = generateArtifacts(registry);
    const second = generateArtifacts(registry);

    expect(second).toEqual(first);
  });

  it("supports a custom output directory", () => {
    const result = generateArtifacts(createRegistry(), {
      outDir: "generated/contracts",
    });

    expect(result.artifacts[0]?.path).toBe("generated/contracts/fixtures/search_docs.valid.json");
    expect(result.artifacts.at(-1)?.path).toBe("generated/contracts/manifest.json");
  });

  it("omits unsupported schema artifacts but still writes docs and manifest", () => {
    const unsupported = defineToolContract({
      name: "custom_input",
      description: "Accept custom input.",
      input: z.custom<string>((value) => typeof value === "string"),
    });
    const { registry } = createContractRegistry(defineConfig({ contracts: [unsupported] }));

    const result = generateArtifacts(registry);

    expect(result.artifacts.map((artifact) => artifact.path)).toEqual([
      ".tool-call-contract/fixtures/custom_input.invalid.json",
      ".tool-call-contract/docs/custom_input.md",
      ".tool-call-contract/manifest.json",
    ]);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "schema.fixture-unsupported",
        }),
        expect.objectContaining({
          id: "schema.json-schema-unsupported",
        }),
      ]),
    );
  });
});

function createRegistry() {
  const searchDocs = defineToolContract({
    name: "search_docs",
    description: "Search documentation.",
    input: z.object({
      query: z.string().describe("Search query."),
    }),
  });
  const createIssue = defineToolContract({
    name: "create_issue",
    description: "Create an issue.",
    input: z.object({
      title: z.string(),
    }),
  });

  return createContractRegistry(defineConfig({ contracts: [searchDocs, createIssue] })).registry;
}
