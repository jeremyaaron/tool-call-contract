import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createContractRegistry,
  defineConfig,
  defineToolContract,
  generateRegistryFixtures,
  generateToolCallFixtures,
  validateToolCall,
} from "../src/index.js";

describe("generateToolCallFixtures", () => {
  it("generates deterministic valid and invalid normalized calls", () => {
    const contract = defineToolContract({
      name: "create_issue",
      description: "Create an issue.",
      input: z.object({
        title: z.string().min(1),
        count: z.number().min(1),
        enabled: z.boolean(),
        labels: z.array(z.string()).min(1),
        kind: z.enum(["bug", "feature"]),
        pinned: z.literal(false),
        optionalDefault: z.string().default("defaulted"),
      }),
    });

    const fixtures = generateToolCallFixtures(contract);

    expect(fixtures).toMatchObject({
      contractName: "create_issue",
      source: "generated",
      valid: {
        name: "create_issue",
        arguments: {
          title: "x",
          count: 1,
          enabled: true,
          labels: ["x"],
          kind: "bug",
          pinned: false,
          optionalDefault: "defaulted",
        },
      },
      invalid: {
        name: "create_issue",
      },
      findings: [],
    });
    expect(validateToolCall(contract, fixtures.valid).ok).toBe(true);
    expect(validateToolCall(contract, fixtures.invalid).ok).toBe(false);
  });

  it("uses the first valid explicit example", () => {
    const contract = defineToolContract({
      name: "search_docs",
      description: "Search documentation.",
      input: z.object({
        query: z.string(),
        limit: z.number().default(5),
      }),
      examples: [{ query: "local", limit: 2 }],
    });

    expect(generateToolCallFixtures(contract)).toMatchObject({
      source: "example",
      valid: {
        arguments: {
          query: "local",
          limit: 2,
        },
      },
    });
  });

  it("reports invalid examples and still synthesizes when the schema is supported", () => {
    const contract = defineToolContract({
      name: "search_docs",
      description: "Search documentation.",
      input: z.object({
        query: z.string(),
      }),
      examples: [{ query: 123 }],
    });

    const fixtures = generateToolCallFixtures(contract);

    expect(fixtures.source).toBe("generated");
    expect(fixtures.findings).toMatchObject([
      {
        id: "schema.example-invalid",
        severity: "error",
        path: "query",
      },
    ]);
    expect(validateToolCall(contract, fixtures.valid).ok).toBe(true);
    expect(validateToolCall(contract, fixtures.invalid).ok).toBe(false);
  });

  it("uses example-only generation for schemas unsupported by JSON Schema conversion", () => {
    const contract = defineToolContract({
      name: "custom_input",
      description: "Accept custom input.",
      input: z.custom<string>((value) => typeof value === "string"),
      examples: ["known-good"],
    });

    const fixtures = generateToolCallFixtures(contract);

    expect(fixtures).toMatchObject({
      source: "example",
      valid: {
        arguments: JSON.stringify("known-good"),
      },
      findings: [],
    });
    expect(validateToolCall(contract, fixtures.valid).ok).toBe(true);
    expect(validateToolCall(contract, fixtures.invalid).ok).toBe(false);
  });

  it("reports unsupported fixture generation when no valid example exists", () => {
    const contract = defineToolContract({
      name: "custom_input",
      description: "Accept custom input.",
      input: z.custom<string>((value) => typeof value === "string"),
    });

    const fixtures = generateToolCallFixtures(contract);

    expect(fixtures.valid).toBeUndefined();
    expect(fixtures).toMatchObject({
      source: "unavailable",
      findings: [
        {
          id: "schema.fixture-unsupported",
          severity: "warning",
        },
      ],
    });
  });
});

describe("generateRegistryFixtures", () => {
  it("generates fixtures in registry order with merged config examples", () => {
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
    const { registry } = createContractRegistry(
      defineConfig({
        contracts: [first, second],
        examples: {
          create_issue: [{ title: "from config" }],
        },
      }),
    );

    const fixtures = generateRegistryFixtures(registry);

    expect(fixtures.map((fixture) => fixture.contractName)).toEqual([
      "search_docs",
      "create_issue",
    ]);
    expect(fixtures[1]?.source).toBe("example");
    expect(fixtures[1]?.valid?.arguments).toEqual({ title: "from config" });
  });
});
