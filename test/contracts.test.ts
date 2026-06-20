import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  defineConfig,
  defineToolContract,
  type DefineToolContractInput,
  type ToolCallContractConfig,
  type ToolContract,
} from "../src/index.js";

describe("defineToolContract", () => {
  it("creates an immutable contract from a Zod schema", () => {
    const schema = z.object({
      title: z.string().min(1),
      labels: z.array(z.string()).default([]),
    });

    const contract = defineToolContract({
      name: "create_issue",
      description: "Create a GitHub issue.",
      input: schema,
    });

    expect(contract).toEqual({
      kind: "tool-call-contract",
      name: "create_issue",
      description: "Create a GitHub issue.",
      input: schema,
      examples: [],
    });
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.examples)).toBe(true);
    expectTypeOf(contract).toEqualTypeOf<ToolContract<typeof schema>>();
    expectTypeOf(contract.input).toEqualTypeOf<typeof schema>();
  });

  it("stores examples without validating their values", () => {
    const examples: unknown[] = [{ query: "billing" }];
    const contract = defineToolContract({
      name: "search_docs",
      description: "Search documentation.",
      input: z.object({ query: z.string() }),
      examples,
    });

    examples.push({ query: 123 });

    expect(contract.examples).toEqual([{ query: "billing" }]);
  });

  it("rejects a missing definition object", () => {
    expect(() =>
      defineToolContract(null as unknown as DefineToolContractInput<z.ZodString>),
    ).toThrow(TypeError);
  });

  it("rejects an empty name", () => {
    expect(() =>
      defineToolContract({
        name: " ",
        description: "Create a GitHub issue.",
        input: z.object({ title: z.string() }),
      }),
    ).toThrow("Tool contract name must be a non-empty string.");
  });

  it("rejects an empty description", () => {
    expect(() =>
      defineToolContract({
        name: "create_issue",
        description: "",
        input: z.object({ title: z.string() }),
      }),
    ).toThrow("Tool contract description must be a non-empty string.");
  });

  it("rejects a non-Zod input schema", () => {
    expect(() =>
      defineToolContract({
        name: "create_issue",
        description: "Create a GitHub issue.",
        input: {} as z.ZodType,
      }),
    ).toThrow("Tool contract input must be a Zod schema.");
  });

  it("rejects non-array examples", () => {
    expect(() =>
      defineToolContract({
        name: "create_issue",
        description: "Create a GitHub issue.",
        input: z.object({ title: z.string() }),
        examples: {} as unknown as unknown[],
      }),
    ).toThrow("Tool contract examples must be an array when provided.");
  });
});

describe("defineConfig", () => {
  it("returns the config object unchanged", () => {
    const contract = defineToolContract({
      name: "create_issue",
      description: "Create a GitHub issue.",
      input: z.object({ title: z.string() }),
    });
    const config = {
      contracts: [contract],
      outDir: ".tool-call-contract",
    } satisfies ToolCallContractConfig;

    expect(defineConfig(config)).toBe(config);
  });

  it("rejects a missing config object", () => {
    expect(() => defineConfig(null as unknown as ToolCallContractConfig)).toThrow(
      "Tool call contract config must be an object.",
    );
  });
});
