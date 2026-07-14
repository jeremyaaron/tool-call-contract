import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ArtifactManifest, GeneratedArtifact } from "./artifacts.js";
import {
  planArtifactChanges,
  summarizeArtifactPlan,
  writeArtifactChanges,
  type ArtifactPlanIssue,
} from "./artifact-planner.js";
import type { CommandReport, Finding } from "./reporting.js";

export type ArtifactWriteAction = "create" | "update" | "unchanged";

export interface PlannedArtifactWrite {
  artifact: GeneratedArtifact;
  action: ArtifactWriteAction;
  absolutePath: string;
}

export interface PlannedArtifactDelete {
  path: string;
  absolutePath: string;
}

export interface ArtifactWritePlan {
  entries: PlannedArtifactWrite[];
  deletes: PlannedArtifactDelete[];
  findings: Finding[];
  artifacts: NonNullable<CommandReport["artifacts"]>;
}

export interface ArtifactWriteRoots {
  cwd: string;
  outDir: string;
}

export interface ArtifactWritePlanOptions {
  clean?: boolean;
  previousManifest?: ArtifactManifest;
}

export interface ArtifactManifestLoadResult {
  manifest?: ArtifactManifest;
  findings: Finding[];
}

export async function planArtifactWrites(
  artifacts: readonly GeneratedArtifact[],
  roots: ArtifactWriteRoots,
  options: ArtifactWritePlanOptions = {},
): Promise<ArtifactWritePlan> {
  const plan = await planArtifactChanges({
    artifacts,
    cwd: roots.cwd,
    outDir: roots.outDir,
    previousManifest: options.previousManifest,
    includeCleanable: options.clean,
  });
  const summary = summarizeArtifactPlan(plan);

  return {
    entries: plan.entries,
    deletes: plan.cleanable,
    findings: plan.issues.map(createPlanIssueFinding),
    artifacts: summarizeArtifactEntries(summary),
  };
}

export async function writeArtifactPlan(plan: ArtifactWritePlan): Promise<Finding[]> {
  const issues = await writeArtifactChanges({
    entries: plan.entries,
    cleanable: plan.deletes,
    issues: [],
  });

  return issues.map(createPlanIssueFinding);
}

export async function loadArtifactManifest(
  roots: ArtifactWriteRoots,
): Promise<ArtifactManifestLoadResult> {
  const manifestPath = path.join(path.resolve(roots.outDir), "manifest.json");

  try {
    const content = await readFile(manifestPath, "utf8");
    return {
      manifest: parseArtifactManifest(content),
      findings: [],
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        findings: [],
      };
    }

    return {
      findings: [createManifestFinding(manifestPath, error)],
    };
  }
}

export function collectArtifactFreshnessFindings(plan: ArtifactWritePlan): Finding[] {
  return plan.entries
    .filter((entry) => entry.action !== "unchanged")
    .map((entry) => ({
      id: "artifact.stale",
      severity: "error" as const,
      title:
        entry.action === "create" ? "Generated artifact is missing" : "Generated artifact is stale",
      message:
        entry.action === "create"
          ? `Generated artifact "${entry.artifact.path}" is missing.`
          : `Generated artifact "${entry.artifact.path}" does not match the current contracts.`,
      impact: "Checked-in generated artifacts do not match the configured contracts.",
      suggestion: "Run tool-call-contract generate to update generated artifacts.",
      file: entry.artifact.path,
    }));
}

function summarizeArtifactEntries(input: {
  created: string[];
  updated: string[];
  unchanged: string[];
  cleanable: string[];
}): NonNullable<CommandReport["artifacts"]> {
  return {
    created: input.created,
    updated: input.updated,
    unchanged: input.unchanged,
    deleted: input.cleanable,
  };
}

function createPlanIssueFinding(issue: ArtifactPlanIssue): Finding {
  if (issue.code === "artifact.path-outside-out-dir") {
    return createPathFinding(issue.path);
  }

  if (issue.code === "artifact.delete-failed") {
    return createDeleteFileSystemFinding(issue.path, issue.message);
  }

  return createFileSystemFinding("artifact.write-failed", issue.path, issue.message);
}

function parseArtifactManifest(content: string): ArtifactManifest {
  const parsed = JSON.parse(content) as unknown;

  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    !isRecord(parsed.generator) ||
    parsed.generator.name !== "tool-call-contract" ||
    typeof parsed.generator.version !== "string" ||
    parsed.generatedAt !== null ||
    !Array.isArray(parsed.contracts) ||
    !Array.isArray(parsed.files)
  ) {
    throw new Error("Artifact manifest has an invalid shape.");
  }

  const contracts: ArtifactManifest["contracts"] = parsed.contracts.map((contract, index) => {
    if (
      !isRecord(contract) ||
      typeof contract.name !== "string" ||
      typeof contract.inputHash !== "string" ||
      !Array.isArray(contract.artifacts) ||
      contract.artifacts.some((artifact) => typeof artifact !== "string")
    ) {
      throw new Error(`Artifact manifest contracts[${index}] is invalid.`);
    }

    return {
      name: contract.name,
      inputHash: contract.inputHash,
      artifacts: contract.artifacts,
    };
  });

  const files: ArtifactManifest["files"] = parsed.files.map((file, index) => {
    if (
      !isRecord(file) ||
      typeof file.path !== "string" ||
      !isArtifactKind(file.kind) ||
      typeof file.hash !== "string"
    ) {
      throw new Error(`Artifact manifest files[${index}] is invalid.`);
    }

    return {
      path: file.path,
      kind: file.kind,
      hash: file.hash,
    };
  });

  return {
    schemaVersion: 1,
    generator: {
      name: "tool-call-contract",
      version: parsed.generator.version,
    },
    generatedAt: null,
    contracts,
    files,
  };
}

function isArtifactKind(value: unknown): value is ArtifactManifest["files"][number]["kind"] {
  return value === "fixture" || value === "schema" || value === "doc" || value === "manifest";
}

function createPathFinding(artifactPath: string): Finding {
  return {
    id: "artifact.path-outside-out-dir",
    severity: "error",
    title: "Generated artifact path escapes the output directory",
    message: `Generated artifact path "${artifactPath}" does not stay inside the configured outDir.`,
    impact: "The artifact was not written.",
    suggestion:
      "Use an output directory inside the project and report this as a bug if it persists.",
    file: artifactPath,
  };
}

function createFileSystemFinding(id: string, artifactPath: string, message: string): Finding {
  return {
    id,
    severity: "error",
    title: "Generated artifact could not be written",
    message: `Could not write "${artifactPath}": ${message}`,
    impact: "Generated artifacts on disk may be incomplete or stale.",
    suggestion:
      "Check output directory permissions and remove files that block generated directories.",
    file: artifactPath,
  };
}

function createDeleteFileSystemFinding(artifactPath: string, message: string): Finding {
  return {
    id: "artifact.write-failed",
    severity: "error",
    title: "Generated artifact could not be deleted",
    message: `Could not delete "${artifactPath}": ${message}`,
    impact: "Generated artifacts on disk may include stale files.",
    suggestion: "Check output directory permissions and remove stale generated files manually.",
    file: artifactPath,
  };
}

function createManifestFinding(manifestPath: string, error: unknown): Finding {
  return {
    id: "artifact.stale",
    severity: "error",
    title: "Generated artifact manifest could not be read",
    message: `Could not read generated artifact manifest: ${formatErrorMessage(error)}`,
    impact: "Generated artifact freshness could not be verified.",
    suggestion: "Run tool-call-contract generate to recreate the manifest.",
    file: manifestPath,
  };
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown file system error.";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
