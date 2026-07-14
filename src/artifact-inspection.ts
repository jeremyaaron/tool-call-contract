import path from "node:path";

import { generateArtifacts, type ArtifactGenerationResult } from "./artifacts.js";
import {
  collectArtifactFreshnessFindings,
  loadArtifactManifest,
  planArtifactWrites,
  type ArtifactManifestLoadResult,
  type ArtifactWritePlan,
  type ArtifactWriteRoots,
  type PlannedArtifactDelete,
} from "./artifact-writer.js";
import type { ContractRegistry } from "./registry.js";
import type { CommandReport, Finding, Severity } from "./reporting.js";

export interface ArtifactInspectionOptions extends ArtifactWriteRoots {
  registry: ContractRegistry;
  includeCleanable?: boolean;
  staleSeverity?: Severity;
  skipIfManifestMissing?: boolean;
}

export interface ArtifactInspectionResult {
  generation: ArtifactGenerationResult;
  manifest: ArtifactManifestLoadResult;
  plan?: ArtifactWritePlan;
  artifacts: NonNullable<CommandReport["artifacts"]>;
  cleanable: PlannedArtifactDelete[];
  findings: Finding[];
  fresh: boolean;
  manifestFound: boolean;
}

export async function inspectGeneratedArtifacts(
  options: ArtifactInspectionOptions,
): Promise<ArtifactInspectionResult> {
  const generation = generateArtifacts(options.registry, {
    outDir: path.relative(options.cwd, options.outDir),
  });
  const manifest = await loadArtifactManifest(options);
  const baseFindings = [...manifest.findings];

  if (!manifest.manifest && options.skipIfManifestMissing && baseFindings.length === 0) {
    return {
      generation,
      manifest,
      artifacts: emptyArtifactSummary(),
      cleanable: [],
      findings: [],
      fresh: true,
      manifestFound: false,
    };
  }

  const plan = await planArtifactWrites(generation.artifacts, options, {
    clean: options.includeCleanable,
    previousManifest: manifest.manifest,
  });
  const freshnessFindings = options.staleSeverity
    ? collectArtifactFreshnessFindings(plan).map((finding) => ({
        ...finding,
        severity: options.staleSeverity as Severity,
      }))
    : [];
  const findings = [...baseFindings, ...plan.findings, ...freshnessFindings];

  return {
    generation,
    manifest,
    plan,
    artifacts: plan.artifacts,
    cleanable: plan.deletes,
    findings,
    fresh: plan.entries.every((entry) => entry.action === "unchanged") && findings.length === 0,
    manifestFound: Boolean(manifest.manifest),
  };
}

function emptyArtifactSummary(): NonNullable<CommandReport["artifacts"]> {
  return {
    created: [],
    updated: [],
    unchanged: [],
    deleted: [],
  };
}
