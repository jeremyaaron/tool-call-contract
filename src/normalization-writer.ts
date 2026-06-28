import { readFile } from "node:fs/promises";
import path from "node:path";

import { formatJson } from "./artifacts.js";
import type { GenericNormalizationConfig } from "./contracts.js";
import {
  normalizeToolCallCaptures,
  type NormalizationFormat,
  type NormalizeToolCallsOptions,
} from "./normalization.js";
import type { Finding } from "./reporting.js";
import type { NormalizedToolCall, ToolCallIssue } from "./validation.js";

export interface NormalizationInputFile {
  path: string;
  content: string;
}

export interface NormalizationWritePlanEntry {
  inputPath: string;
  outputPath?: string;
  callsFound: number;
  callsWritten: number;
  skipped: number;
  changed: boolean;
  checkFailure?: "missing" | "stale";
  content?: string;
  issues: ToolCallIssue[];
}

export interface NormalizationWritePlan {
  entries: NormalizationWritePlanEntry[];
  findings: Finding[];
}

export interface NormalizationWritePlanOptions {
  cwd: string;
  files: readonly NormalizationInputFile[];
  format: NormalizationFormat;
  includeSource?: boolean;
  generic?: GenericNormalizationConfig;
  out?: string;
  outDir?: string;
  check?: boolean;
}

interface NormalizationDestination {
  inputPath: string;
  outputPath?: string;
}

export async function planNormalizationWrites(
  options: NormalizationWritePlanOptions,
): Promise<NormalizationWritePlan> {
  const destinations = resolveNormalizationDestinations(options);

  if (destinations.findings.length > 0) {
    return {
      entries: createInitialEntries(options.files),
      findings: destinations.findings,
    };
  }

  const entries: NormalizationWritePlanEntry[] = [];
  const findings: Finding[] = [];
  const destinationByInput = new Map(
    destinations.destinations.map((destination) => [destination.inputPath, destination.outputPath]),
  );

  for (const file of options.files) {
    const outputPath = destinationByInput.get(file.path);
    const entry = await planNormalizationFile(file, outputPath, options);
    entries.push(entry);
    findings.push(...createEntryFindings(entry, options.check ?? false));
  }

  return {
    entries,
    findings,
  };
}

function createInitialEntries(
  files: readonly NormalizationInputFile[],
): NormalizationWritePlanEntry[] {
  return files.map((file) => ({
    inputPath: file.path,
    callsFound: 0,
    callsWritten: 0,
    skipped: 0,
    changed: false,
    issues: [],
  }));
}

async function planNormalizationFile(
  file: NormalizationInputFile,
  outputPath: string | undefined,
  options: NormalizationWritePlanOptions,
): Promise<NormalizationWritePlanEntry> {
  const parsed = parseJson(file.content);

  if (!parsed.ok) {
    return {
      inputPath: file.path,
      ...(outputPath ? { outputPath } : {}),
      callsFound: 0,
      callsWritten: 0,
      skipped: 0,
      changed: false,
      issues: [
        {
          code: "normalize.input-invalid-json",
          message: `Input file contains malformed JSON: ${parsed.message}`,
        },
      ],
    };
  }

  const result = normalizeToolCallCaptures(parsed.value, createNormalizeOptions(options));
  const content = result.calls.length > 0 ? formatNormalizedCalls(result.calls) : undefined;
  const outputState = content
    ? await compareOutputContent(options.cwd, outputPath, content, options.check ?? false)
    : { changed: false as const };
  const checkFailure =
    "checkFailure" in outputState &&
    (outputState.checkFailure === "missing" || outputState.checkFailure === "stale")
      ? outputState.checkFailure
      : undefined;

  return {
    inputPath: file.path,
    ...(outputPath ? { outputPath } : {}),
    callsFound: result.calls.length + result.skipped,
    callsWritten: result.calls.length,
    skipped: result.skipped,
    changed: outputState.changed,
    ...(checkFailure ? { checkFailure } : {}),
    ...(content && outputState.changed ? { content } : {}),
    issues: result.issues,
  };
}

function createNormalizeOptions(options: NormalizationWritePlanOptions): NormalizeToolCallsOptions {
  return {
    format: options.format,
    includeSource: options.includeSource,
    generic: options.generic,
  };
}

function formatNormalizedCalls(calls: readonly NormalizedToolCall[]): string {
  return formatJson(calls.length === 1 ? calls[0] : calls);
}

async function compareOutputContent(
  cwd: string,
  outputPath: string | undefined,
  content: string,
  check: boolean,
): Promise<
  | {
      changed: boolean;
    }
  | {
      changed: true;
      checkFailure: "missing" | "stale";
    }
> {
  if (!outputPath) {
    return {
      changed: true,
    };
  }

  try {
    const existing = await readFile(path.resolve(cwd, outputPath), "utf8");
    if (existing === content) {
      return {
        changed: false,
      };
    }

    return check
      ? {
          changed: true,
          checkFailure: "stale",
        }
      : {
          changed: true,
        };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return check
        ? {
            changed: true,
            checkFailure: "missing",
          }
        : {
            changed: true,
          };
    }

    return check
      ? {
          changed: true,
          checkFailure: "stale",
        }
      : {
          changed: true,
        };
  }
}

function createEntryFindings(entry: NormalizationWritePlanEntry, check: boolean): Finding[] {
  const findings: Finding[] = entry.issues.map((issue) => ({
    id: issue.code,
    severity: "error",
    title: "Capture file could not be normalized",
    message: issue.message,
    file: entry.inputPath,
    path: issue.path?.join("."),
  }));

  if (check && entry.outputPath && entry.callsWritten > 0 && entry.checkFailure) {
    const missing = entry.checkFailure === "missing";
    findings.push({
      id: missing ? "normalize.output-missing" : "normalize.output-stale",
      severity: "error",
      title: missing ? "Normalized output is missing" : "Normalized output is stale",
      message: missing
        ? `Normalized output for ${entry.inputPath} is missing: ${entry.outputPath}.`
        : `Normalized output for ${entry.inputPath} does not match ${entry.outputPath}.`,
      file: entry.outputPath,
      suggestion: "Run normalize without --check to update normalized captures.",
    });
  }

  return findings;
}

function resolveNormalizationDestinations(options: NormalizationWritePlanOptions): {
  destinations: NormalizationDestination[];
  findings: Finding[];
} {
  const findings: Finding[] = [];
  const out = options.out ? resolveFileUnderCwd(options.cwd, options.out) : undefined;
  const outDir = options.outDir ? resolveDirectoryUnderCwd(options.cwd, options.outDir) : undefined;

  if (out && !out.ok) {
    findings.push(out.finding);
  }

  if (outDir && !outDir.ok) {
    findings.push(outDir.finding);
  }

  if (findings.length > 0) {
    return {
      destinations: [],
      findings,
    };
  }

  const destinations = options.files.map((file) => ({
    inputPath: file.path,
    outputPath: resolveDestination(
      file.path,
      out && out.ok ? out.path : undefined,
      outDir && outDir.ok ? outDir.path : undefined,
    ),
  }));
  const collisions = findOutputCollisions(destinations);

  return {
    destinations,
    findings: collisions,
  };
}

function resolveDestination(file: string, out?: string, outDir?: string): string | undefined {
  if (out) {
    return out;
  }

  if (outDir) {
    return toPosixPath(path.join(outDir, path.basename(file)));
  }

  return undefined;
}

function findOutputCollisions(destinations: readonly NormalizationDestination[]): Finding[] {
  const inputPathsByOutput = new Map<string, string[]>();

  for (const destination of destinations) {
    if (!destination.outputPath) {
      continue;
    }

    inputPathsByOutput.set(destination.outputPath, [
      ...(inputPathsByOutput.get(destination.outputPath) ?? []),
      destination.inputPath,
    ]);
  }

  return [...inputPathsByOutput.entries()]
    .filter(([, inputPaths]) => inputPaths.length > 1)
    .map(([outputPath, inputPaths]) => ({
      id: "normalize.output-collision",
      severity: "error" as const,
      title: "Multiple inputs map to the same normalized output",
      message: `Multiple input files would write ${outputPath}: ${inputPaths.join(", ")}.`,
      file: outputPath,
      suggestion: "Use unique input basenames or normalize one file with --out.",
    }));
}

function resolveFileUnderCwd(
  cwd: string,
  file: string,
):
  | {
      ok: true;
      path: string;
    }
  | {
      ok: false;
      finding: Finding;
    } {
  const resolved = path.resolve(cwd, file);
  const relative = path.relative(cwd, resolved);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return {
      ok: false,
      finding: createOutsideRootFinding(file),
    };
  }

  return {
    ok: true,
    path: toPosixPath(relative),
  };
}

function resolveDirectoryUnderCwd(
  cwd: string,
  directory: string,
):
  | {
      ok: true;
      path: string;
    }
  | {
      ok: false;
      finding: Finding;
    } {
  const resolved = path.resolve(cwd, directory);
  const relative = path.relative(cwd, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return {
      ok: false,
      finding: createOutsideRootFinding(directory),
    };
  }

  return {
    ok: true,
    path: relative === "" ? "." : toPosixPath(relative),
  };
}

function createOutsideRootFinding(file: string): Finding {
  return {
    id: "normalize.output-outside-root",
    severity: "error",
    title: "Normalization output is outside the project root",
    message: `Normalization output paths must stay inside the project root: ${file}`,
    file,
  };
}

function parseJson(content: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return {
      ok: true,
      value: JSON.parse(content) as unknown,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unknown JSON parse error.",
    };
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function toPosixPath(file: string): string {
  return file.split(path.sep).join("/");
}
