import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ArtifactManifest, GeneratedArtifact } from "./artifacts.js";
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
  const entries: PlannedArtifactWrite[] = [];
  const findings: Finding[] = [];

  for (const artifact of artifacts) {
    const resolved = resolveArtifactPath(artifact, roots);

    if (!resolved.ok) {
      findings.push(resolved.finding);
      continue;
    }

    const existing = await readExistingArtifact(artifact, resolved.absolutePath);

    if (!existing.ok) {
      findings.push(existing.finding);
      continue;
    }

    entries.push({
      artifact,
      absolutePath: resolved.absolutePath,
      action:
        existing.content === undefined
          ? "create"
          : existing.content === artifact.content
            ? "unchanged"
            : "update",
    });
  }

  const deletePlan = options.clean
    ? planArtifactDeletes(artifacts, roots, options.previousManifest)
    : {
        deletes: [],
        findings: [],
      };

  findings.push(...deletePlan.findings);

  return {
    entries,
    deletes: deletePlan.deletes,
    findings,
    artifacts: summarizeArtifactEntries(entries, deletePlan.deletes),
  };
}

export async function writeArtifactPlan(plan: ArtifactWritePlan): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const entry of plan.entries) {
    if (entry.action === "unchanged") {
      continue;
    }

    try {
      await mkdir(path.dirname(entry.absolutePath), { recursive: true });
      await writeFile(entry.absolutePath, entry.artifact.content, "utf8");
    } catch (error) {
      findings.push(createFileSystemFinding("artifact.write-failed", entry.artifact.path, error));
    }
  }

  for (const entry of plan.deletes) {
    try {
      await rm(entry.absolutePath, { force: true });
    } catch (error) {
      findings.push(createDeleteFileSystemFinding(entry.path, error));
    }
  }

  return findings;
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

function summarizeArtifactEntries(
  entries: readonly PlannedArtifactWrite[],
  deletes: readonly PlannedArtifactDelete[],
): NonNullable<CommandReport["artifacts"]> {
  return {
    created: entries
      .filter((entry) => entry.action === "create")
      .map((entry) => entry.artifact.path),
    updated: entries
      .filter((entry) => entry.action === "update")
      .map((entry) => entry.artifact.path),
    unchanged: entries
      .filter((entry) => entry.action === "unchanged")
      .map((entry) => entry.artifact.path),
    deleted: deletes.map((entry) => entry.path),
  };
}

function resolveArtifactPath(
  artifact: GeneratedArtifact,
  roots: ArtifactWriteRoots,
): { ok: true; absolutePath: string } | { ok: false; finding: Finding } {
  return resolveArtifactFilePath(artifact.path, roots);
}

function resolveArtifactFilePath(
  artifactPath: string,
  roots: ArtifactWriteRoots,
): { ok: true; absolutePath: string } | { ok: false; finding: Finding } {
  const normalizedArtifactPath = artifactPath.replaceAll("\\", path.sep);

  if (path.isAbsolute(normalizedArtifactPath)) {
    return {
      ok: false,
      finding: createPathFinding(artifactPath),
    };
  }

  const cwd = path.resolve(roots.cwd);
  const outDir = path.resolve(roots.outDir);
  const absolutePath = path.resolve(cwd, normalizedArtifactPath);

  if (!isPathInside(absolutePath, outDir)) {
    return {
      ok: false,
      finding: createPathFinding(artifactPath),
    };
  }

  return {
    ok: true,
    absolutePath,
  };
}

async function readExistingArtifact(
  artifact: GeneratedArtifact,
  absolutePath: string,
): Promise<{ ok: true; content?: string } | { ok: false; finding: Finding }> {
  try {
    return {
      ok: true,
      content: await readFile(absolutePath, "utf8"),
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        ok: true,
      };
    }

    return {
      ok: false,
      finding: createFileSystemFinding("artifact.write-failed", artifact.path, error),
    };
  }
}

function planArtifactDeletes(
  artifacts: readonly GeneratedArtifact[],
  roots: ArtifactWriteRoots,
  previousManifest: ArtifactManifest | undefined,
): {
  deletes: PlannedArtifactDelete[];
  findings: Finding[];
} {
  if (!previousManifest) {
    return {
      deletes: [],
      findings: [],
    };
  }

  const currentPaths = new Set(artifacts.map((artifact) => artifact.path));
  const seenPaths = new Set<string>();
  const deletes: PlannedArtifactDelete[] = [];
  const findings: Finding[] = [];

  for (const file of previousManifest.files) {
    if (currentPaths.has(file.path) || seenPaths.has(file.path)) {
      continue;
    }

    seenPaths.add(file.path);
    const resolved = resolveArtifactFilePath(file.path, roots);

    if (!resolved.ok) {
      findings.push(resolved.finding);
      continue;
    }

    deletes.push({
      path: file.path,
      absolutePath: resolved.absolutePath,
    });
  }

  return {
    deletes,
    findings,
  };
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

function isPathInside(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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

function createFileSystemFinding(id: string, artifactPath: string, error: unknown): Finding {
  return {
    id,
    severity: "error",
    title: "Generated artifact could not be written",
    message: `Could not write "${artifactPath}": ${formatErrorMessage(error)}`,
    impact: "Generated artifacts on disk may be incomplete or stale.",
    suggestion:
      "Check output directory permissions and remove files that block generated directories.",
    file: artifactPath,
  };
}

function createDeleteFileSystemFinding(artifactPath: string, error: unknown): Finding {
  return {
    id: "artifact.write-failed",
    severity: "error",
    title: "Generated artifact could not be deleted",
    message: `Could not delete "${artifactPath}": ${formatErrorMessage(error)}`,
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
