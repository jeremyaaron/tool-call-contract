import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PlannedArtifact {
  path: string;
  content: string;
  hash?: string;
  kind?: string;
}

export type PlannedArtifactWriteAction = "create" | "update" | "unchanged";

export interface PlannedArtifactWriteEntry<TArtifact extends PlannedArtifact = PlannedArtifact> {
  artifact: TArtifact;
  action: PlannedArtifactWriteAction;
  absolutePath: string;
}

export interface PlannedArtifactDeleteEntry {
  path: string;
  absolutePath: string;
}

export type ArtifactPlanIssueCode =
  | "artifact.path-outside-out-dir"
  | "artifact.read-failed"
  | "artifact.write-failed"
  | "artifact.delete-failed";

export interface ArtifactPlanIssue {
  code: ArtifactPlanIssueCode;
  path: string;
  message: string;
  cause?: unknown;
}

export interface GenericArtifactManifest {
  files: Array<{
    path: string;
    kind?: string;
    hash?: string;
  }>;
}

export interface ArtifactPlan<TArtifact extends PlannedArtifact = PlannedArtifact> {
  entries: Array<PlannedArtifactWriteEntry<TArtifact>>;
  cleanable: PlannedArtifactDeleteEntry[];
  issues: ArtifactPlanIssue[];
}

export interface ArtifactPlanSummary {
  created: string[];
  updated: string[];
  unchanged: string[];
  cleanable: string[];
}

export async function planArtifactChanges<TArtifact extends PlannedArtifact>(input: {
  artifacts: readonly TArtifact[];
  cwd: string;
  outDir: string;
  previousManifest?: GenericArtifactManifest;
  includeCleanable?: boolean;
}): Promise<ArtifactPlan<TArtifact>> {
  const entries: Array<PlannedArtifactWriteEntry<TArtifact>> = [];
  const issues: ArtifactPlanIssue[] = [];

  for (const artifact of input.artifacts) {
    const resolved = resolveArtifactFilePath(artifact.path, input);

    if (!resolved.ok) {
      issues.push(resolved.issue);
      continue;
    }

    const existing = await readExistingArtifact(artifact.path, resolved.absolutePath);

    if (!existing.ok) {
      issues.push(existing.issue);
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

  const cleanable = input.includeCleanable
    ? planCleanableArtifacts(input.artifacts, input, input.previousManifest, issues)
    : [];

  return {
    entries,
    cleanable,
    issues,
  };
}

export async function writeArtifactChanges(plan: ArtifactPlan): Promise<ArtifactPlanIssue[]> {
  const issues: ArtifactPlanIssue[] = [];

  for (const entry of plan.entries) {
    if (entry.action === "unchanged") {
      continue;
    }

    try {
      await mkdir(path.dirname(entry.absolutePath), { recursive: true });
      await writeFile(entry.absolutePath, entry.artifact.content, "utf8");
    } catch (error) {
      issues.push({
        code: "artifact.write-failed",
        path: entry.artifact.path,
        message: formatErrorMessage(error),
        cause: error,
      });
    }
  }

  for (const entry of plan.cleanable) {
    try {
      await rm(entry.absolutePath, { force: true });
    } catch (error) {
      issues.push({
        code: "artifact.delete-failed",
        path: entry.path,
        message: formatErrorMessage(error),
        cause: error,
      });
    }
  }

  return issues;
}

export function summarizeArtifactPlan(plan: ArtifactPlan): ArtifactPlanSummary {
  return {
    created: plan.entries
      .filter((entry) => entry.action === "create")
      .map((entry) => entry.artifact.path),
    updated: plan.entries
      .filter((entry) => entry.action === "update")
      .map((entry) => entry.artifact.path),
    unchanged: plan.entries
      .filter((entry) => entry.action === "unchanged")
      .map((entry) => entry.artifact.path),
    cleanable: plan.cleanable.map((entry) => entry.path),
  };
}

function planCleanableArtifacts(
  artifacts: readonly PlannedArtifact[],
  roots: { cwd: string; outDir: string },
  previousManifest: GenericArtifactManifest | undefined,
  issues: ArtifactPlanIssue[],
): PlannedArtifactDeleteEntry[] {
  if (!previousManifest) {
    return [];
  }

  const currentPaths = new Set(artifacts.map((artifact) => artifact.path));
  const seenPaths = new Set<string>();
  const cleanable: PlannedArtifactDeleteEntry[] = [];

  for (const file of previousManifest.files) {
    if (currentPaths.has(file.path) || seenPaths.has(file.path)) {
      continue;
    }

    seenPaths.add(file.path);
    const resolved = resolveArtifactFilePath(file.path, roots);

    if (!resolved.ok) {
      issues.push(resolved.issue);
      continue;
    }

    cleanable.push({
      path: file.path,
      absolutePath: resolved.absolutePath,
    });
  }

  return cleanable;
}

function resolveArtifactFilePath(
  artifactPath: string,
  roots: { cwd: string; outDir: string },
): { ok: true; absolutePath: string } | { ok: false; issue: ArtifactPlanIssue } {
  const normalizedArtifactPath = artifactPath.replaceAll("\\", path.sep);

  if (path.isAbsolute(normalizedArtifactPath)) {
    return {
      ok: false,
      issue: createPathIssue(artifactPath),
    };
  }

  const cwd = path.resolve(roots.cwd);
  const outDir = path.resolve(roots.outDir);
  const absolutePath = path.resolve(cwd, normalizedArtifactPath);

  if (!isPathInside(absolutePath, outDir)) {
    return {
      ok: false,
      issue: createPathIssue(artifactPath),
    };
  }

  return {
    ok: true,
    absolutePath,
  };
}

async function readExistingArtifact(
  artifactPath: string,
  absolutePath: string,
): Promise<{ ok: true; content?: string } | { ok: false; issue: ArtifactPlanIssue }> {
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
      issue: {
        code: "artifact.read-failed",
        path: artifactPath,
        message: formatErrorMessage(error),
        cause: error,
      },
    };
  }
}

function createPathIssue(artifactPath: string): ArtifactPlanIssue {
  return {
    code: "artifact.path-outside-out-dir",
    path: artifactPath,
    message: `Generated artifact path "${artifactPath}" does not stay inside the configured outDir.`,
  };
}

function isPathInside(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown file system error.";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
