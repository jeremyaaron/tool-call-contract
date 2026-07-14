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
import type {
  ArtifactInspectionReportMetadata,
  CommandReport,
  Finding,
  Severity,
} from "./reporting.js";

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
  report: ArtifactInspectionReportMetadata;
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
    const report = createInspectionReport({
      options,
      manifestFound: false,
      manifestValid: false,
      fresh: true,
      cleanable: [],
    });

    return {
      generation,
      manifest,
      artifacts: emptyArtifactSummary(),
      cleanable: [],
      report,
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
  const fresh =
    plan.entries.every((entry) => entry.action === "unchanged") && findings.length === 0;
  const cleanable = plan.deletes;
  const report = createInspectionReport({
    options,
    manifestFound: Boolean(manifest.manifest),
    manifestValid: manifest.findings.length === 0 && Boolean(manifest.manifest),
    fresh,
    cleanable: cleanable.map((entry) => entry.path),
  });

  return {
    generation,
    manifest,
    plan,
    artifacts: plan.artifacts,
    cleanable,
    report,
    findings,
    fresh,
    manifestFound: Boolean(manifest.manifest),
  };
}

function createInspectionReport(input: {
  options: ArtifactInspectionOptions;
  manifestFound: boolean;
  manifestValid: boolean;
  fresh: boolean;
  cleanable: string[];
}): ArtifactInspectionReportMetadata {
  return {
    checked: input.options.staleSeverity === "error",
    fresh: input.fresh,
    manifest: {
      path: toProjectPath(
        input.options.cwd,
        path.join(path.resolve(input.options.outDir), "manifest.json"),
      ),
      found: input.manifestFound,
      valid: input.manifestValid,
    },
    cleanable: input.cleanable,
  };
}

function toProjectPath(cwd: string, absolutePath: string): string {
  return path.relative(path.resolve(cwd), absolutePath).replaceAll(path.sep, "/");
}

function emptyArtifactSummary(): NonNullable<CommandReport["artifacts"]> {
  return {
    created: [],
    updated: [],
    unchanged: [],
    deleted: [],
  };
}
