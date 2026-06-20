import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GeneratedArtifact } from "./artifacts.js";
import type { CommandReport, Finding } from "./reporting.js";

export type ArtifactWriteAction = "create" | "update" | "unchanged";

export interface PlannedArtifactWrite {
  artifact: GeneratedArtifact;
  action: ArtifactWriteAction;
  absolutePath: string;
}

export interface ArtifactWritePlan {
  entries: PlannedArtifactWrite[];
  findings: Finding[];
  artifacts: NonNullable<CommandReport["artifacts"]>;
}

export interface ArtifactWriteRoots {
  cwd: string;
  outDir: string;
}

export async function planArtifactWrites(
  artifacts: readonly GeneratedArtifact[],
  roots: ArtifactWriteRoots,
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

  return {
    entries,
    findings,
    artifacts: summarizeArtifactEntries(entries),
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

  return findings;
}

function summarizeArtifactEntries(
  entries: readonly PlannedArtifactWrite[],
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
    deleted: [],
  };
}

function resolveArtifactPath(
  artifact: GeneratedArtifact,
  roots: ArtifactWriteRoots,
): { ok: true; absolutePath: string } | { ok: false; finding: Finding } {
  const artifactPath = artifact.path.replaceAll("\\", path.sep);

  if (path.isAbsolute(artifactPath)) {
    return {
      ok: false,
      finding: createPathFinding(artifact.path),
    };
  }

  const cwd = path.resolve(roots.cwd);
  const outDir = path.resolve(roots.outDir);
  const absolutePath = path.resolve(cwd, artifactPath);

  if (!isPathInside(absolutePath, outDir)) {
    return {
      ok: false,
      finding: createPathFinding(artifact.path),
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

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown file system error.";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
