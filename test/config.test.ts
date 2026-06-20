import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ConfigLoadError,
  createContractRegistry,
  loadConfig,
  type ToolCallContractConfig,
} from "../src/index.js";

describe("loadConfig", () => {
  it("loads the default TypeScript config file", async () => {
    const project = await createConfigProject("tool-call-contract.config.ts");
    const realProject = await realpath(project);

    const loaded = await loadConfig({ cwd: project });

    expect(loaded.config.contracts.map((contract) => contract.name)).toEqual(["search_docs"]);
    expect(loaded.configPath).toBe(path.join(realProject, "tool-call-contract.config.ts"));
    expect(loaded.outDir).toBe(path.join(realProject, ".tool-call-contract"));
  });

  it("loads an explicit JavaScript config file", async () => {
    const project = await createConfigProject("custom.config.mjs");
    const realProject = await realpath(project);

    const loaded = await loadConfig({
      cwd: project,
      configPath: "custom.config.mjs",
      outDir: "generated",
    });

    expect(loaded.config.contracts).toHaveLength(1);
    expect(loaded.outDir).toBe(path.join(realProject, "generated"));
  });

  it("reports a missing config", async () => {
    const project = await createTempDir();

    await expect(loadConfig({ cwd: project })).rejects.toMatchObject({
      code: "config.not-found",
    });
  });

  it("reports invalid config shape", async () => {
    const project = await createTempDir();
    await writeFile(path.join(project, "tool-call-contract.config.mjs"), "export default {};\n");

    await expect(loadConfig({ cwd: project })).rejects.toMatchObject({
      code: "config.invalid",
      message: 'Config field "contracts" must be an array.',
    });
  });

  it("rejects output directories outside the project root", async () => {
    const project = await createConfigProject("tool-call-contract.config.ts");

    await expect(loadConfig({ cwd: project, outDir: "../outside" })).rejects.toMatchObject({
      code: "config.out-dir-escapes-root",
    });
  });

  it("uses ConfigLoadError for expected config failures", async () => {
    const project = await createTempDir();

    await expect(loadConfig({ cwd: project })).rejects.toBeInstanceOf(ConfigLoadError);
  });
});

describe("createContractRegistry", () => {
  it("preserves order, indexes by name, merges examples, and reports duplicates", async () => {
    const project = await createConfigProject("tool-call-contract.config.ts", {
      duplicate: true,
    });
    const loaded = await loadConfig({ cwd: project });

    const { registry, findings } = createContractRegistry(loaded.config);

    expect(registry.contracts.map((contract) => contract.name)).toEqual([
      "search_docs",
      "search_docs",
    ]);
    expect(registry.byName.get("search_docs")?.description).toBe("Search documentation.");
    expect(registry.duplicates.get("search_docs")).toHaveLength(2);
    expect(registry.examplesByName.get("search_docs")).toEqual([
      { query: "local" },
      { query: "config" },
    ]);
    expect(findings).toMatchObject([
      {
        id: "contract.duplicate-name",
        severity: "error",
        contractName: "search_docs",
      },
    ]);
  });

  it("accepts a typed config object", async () => {
    const project = await createConfigProject("tool-call-contract.config.ts");
    const loaded = await loadConfig({ cwd: project });
    const config = loaded.config satisfies ToolCallContractConfig;

    expect(config.contracts).toHaveLength(1);
  });
});

async function createConfigProject(
  configName: string,
  options: {
    duplicate?: boolean;
  } = {},
): Promise<string> {
  const project = await createTempDir();
  const moduleUrl = pathToFileURL(path.resolve("src/index.ts")).href;
  const zodUrl = pathToFileURL(path.resolve("node_modules/zod/index.js")).href;
  const duplicateContract = options.duplicate
    ? `
const duplicateSearchDocs = defineToolContract({
  name: "search_docs",
  description: "Duplicate search documentation.",
  input: z.object({ query: z.string() }),
});
`
    : "";
  const duplicateEntry = options.duplicate ? ", duplicateSearchDocs" : "";

  await writeFile(
    path.join(project, configName),
    `
import { z } from "${zodUrl}";
import { defineConfig, defineToolContract } from "${moduleUrl}";

const searchDocs = defineToolContract({
  name: "search_docs",
  description: "Search documentation.",
  input: z.object({ query: z.string() }),
  examples: [{ query: "local" }],
});
${duplicateContract}

export default defineConfig({
  contracts: [searchDocs${duplicateEntry}],
  examples: {
    search_docs: [{ query: "config" }]
  }
});
`,
  );

  return project;
}

async function createTempDir(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), "tool-call-contract-"));
  const project = path.join(parent, "project");
  await mkdir(project);
  return project;
}
