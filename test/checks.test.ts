import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createContractRegistry,
  defineConfig,
  defineToolContract,
  runContractChecks,
} from "../src/index.js";

describe("runContractChecks", () => {
  it("returns no findings for a valid contract", () => {
    const contract = defineToolContract({
      name: "search_docs",
      description: "Search documentation.",
      input: z.object({ query: z.string() }),
      examples: [{ query: "docs" }],
    });
    const { registry, findings } = createContractRegistry(defineConfig({ contracts: [contract] }));

    expect(findings).toEqual([]);
    expect(runContractChecks(registry)).toEqual([]);
  });

  it("reports provider-unsafe names", () => {
    const contract = defineToolContract({
      name: "search docs!",
      description: "Search documentation.",
      input: z.object({ query: z.string() }),
    });
    const { registry } = createContractRegistry(defineConfig({ contracts: [contract] }));

    expect(runContractChecks(registry)).toMatchObject([
      {
        id: "contract.invalid-name",
        severity: "error",
        contractName: "search docs!",
      },
    ]);
  });

  it("reports missing descriptions as warnings", () => {
    const contract = {
      ...defineToolContract({
        name: "search_docs",
        description: "Search documentation.",
        input: z.object({ query: z.string() }),
      }),
      description: "",
    };
    const { registry } = createContractRegistry(defineConfig({ contracts: [contract] }));

    expect(runContractChecks(registry)).toMatchObject([
      {
        id: "contract.description-missing",
        severity: "warning",
        contractName: "search_docs",
      },
    ]);
  });

  it("reports invalid examples", () => {
    const contract = defineToolContract({
      name: "search_docs",
      description: "Search documentation.",
      input: z.object({ query: z.string() }),
      examples: [{ query: 123 }],
    });
    const { registry } = createContractRegistry(defineConfig({ contracts: [contract] }));

    expect(runContractChecks(registry)).toMatchObject([
      {
        id: "schema.example-invalid",
        severity: "error",
        contractName: "search_docs",
        path: "query",
      },
    ]);
  });
});
