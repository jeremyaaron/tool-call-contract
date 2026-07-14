import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { generateArtifacts } from "../src/artifacts.js";
import { inspectGeneratedArtifacts } from "../src/artifact-inspection.js";
import { planArtifactWrites, writeArtifactPlan } from "../src/artifact-writer.js";
import { createContractRegistry } from "../src/registry.js";
import { defineConfig, defineToolContract } from "../src/contracts.js";

describe("inspectGeneratedArtifacts", () => {
  it("reports expected creates when no manifest exists", async () => {
    const project = await createProject();

    const inspection = await inspectGeneratedArtifacts({
      cwd: project,
      outDir: path.join(project, ".tool-call-contract"),
      registry: createRegistry(),
    });

    expect(inspection.findings).toEqual([]);
    expect(inspection.manifestFound).toBe(false);
    expect(inspection.fresh).toBe(false);
    expect(inspection.artifacts.created).toEqual([
      ".tool-call-contract/fixtures/search_docs.valid.json",
      ".tool-call-contract/fixtures/search_docs.invalid.json",
      ".tool-call-contract/schemas/search_docs.openai.json",
      ".tool-call-contract/docs/search_docs.md",
      ".tool-call-contract/manifest.json",
    ]);
  });

  it("can skip missing manifests for broad check compatibility", async () => {
    const project = await createProject();

    const inspection = await inspectGeneratedArtifacts({
      cwd: project,
      outDir: path.join(project, ".tool-call-contract"),
      registry: createRegistry(),
      staleSeverity: "error",
      skipIfManifestMissing: true,
    });

    expect(inspection.findings).toEqual([]);
    expect(inspection.fresh).toBe(true);
    expect(inspection.artifacts).toEqual({
      created: [],
      updated: [],
      unchanged: [],
      deleted: [],
    });
  });

  it("reports a fresh state when generated artifacts match the manifest", async () => {
    const project = await createProject();
    const registry = createRegistry();
    await writeGeneratedArtifacts(project, registry);

    const inspection = await inspectGeneratedArtifacts({
      cwd: project,
      outDir: path.join(project, ".tool-call-contract"),
      registry,
      staleSeverity: "error",
    });

    expect(inspection.findings).toEqual([]);
    expect(inspection.manifestFound).toBe(true);
    expect(inspection.fresh).toBe(true);
    expect(inspection.artifacts.updated).toEqual([]);
    expect(inspection.artifacts.created).toEqual([]);
    expect(inspection.artifacts.unchanged).toContain(".tool-call-contract/manifest.json");
  });

  it("reports stale artifacts with the requested severity", async () => {
    const project = await createProject();
    const registry = createRegistry();
    await writeGeneratedArtifacts(project, registry);
    await writeFile(path.join(project, ".tool-call-contract/docs/search_docs.md"), "stale\n");

    const inspection = await inspectGeneratedArtifacts({
      cwd: project,
      outDir: path.join(project, ".tool-call-contract"),
      registry,
      staleSeverity: "error",
    });

    expect(inspection.fresh).toBe(false);
    expect(inspection.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "artifact.stale",
          severity: "error",
          file: ".tool-call-contract/docs/search_docs.md",
        }),
      ]),
    );
  });

  it("reports cleanable manifest-owned files when requested", async () => {
    const project = await createProject();
    await writeGeneratedArtifacts(project, createRegistry({ extraContract: true }));

    const inspection = await inspectGeneratedArtifacts({
      cwd: project,
      outDir: path.join(project, ".tool-call-contract"),
      registry: createRegistry(),
      includeCleanable: true,
    });

    expect(inspection.findings).toEqual([]);
    expect(inspection.cleanable.map((entry) => entry.path)).toEqual([
      ".tool-call-contract/fixtures/create_issue.valid.json",
      ".tool-call-contract/fixtures/create_issue.invalid.json",
      ".tool-call-contract/schemas/create_issue.openai.json",
      ".tool-call-contract/docs/create_issue.md",
    ]);
    expect(inspection.artifacts.deleted).toEqual([
      ".tool-call-contract/fixtures/create_issue.valid.json",
      ".tool-call-contract/fixtures/create_issue.invalid.json",
      ".tool-call-contract/schemas/create_issue.openai.json",
      ".tool-call-contract/docs/create_issue.md",
    ]);
  });
});

async function writeGeneratedArtifacts(
  project: string,
  registry: ReturnType<typeof createRegistry>,
): Promise<void> {
  const generation = generateArtifacts(registry);
  const plan = await planArtifactWrites(generation.artifacts, {
    cwd: project,
    outDir: path.join(project, ".tool-call-contract"),
  });
  const findings = await writeArtifactPlan(plan);

  expect(findings).toEqual([]);
}

function createRegistry(options: { extraContract?: boolean } = {}) {
  const searchDocs = defineToolContract({
    name: "search_docs",
    description: "Search documentation.",
    input: z.object({ query: z.string() }),
  });
  const createIssue = defineToolContract({
    name: "create_issue",
    description: "Create an issue.",
    input: z.object({ title: z.string() }),
  });
  const { registry } = createContractRegistry(
    defineConfig({
      contracts: options.extraContract ? [searchDocs, createIssue] : [searchDocs],
    }),
  );

  return registry;
}

async function createProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "tool-call-contract-inspection-"));
}
