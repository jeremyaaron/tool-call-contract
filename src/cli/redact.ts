import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CaptureFileRef } from "../captures.js";
import type { RedactionConfig } from "../contracts.js";
import { planRedactions, type RedactionPlanEntry } from "../redaction.js";
import type { Finding, RedactionReportMetadata } from "../reporting.js";

export interface RedactCaptureOptions {
  cwd: string;
  files: readonly CaptureFileRef[];
  redaction?: RedactionConfig;
  check: boolean;
  dryRun: boolean;
  out?: string;
  outDir?: string;
}

export interface RedactCaptureResult {
  findings: Finding[];
  redaction: RedactionReportMetadata;
}

interface RedactionTarget {
  source: string;
  destination: string;
}

export async function redactCaptureFiles(
  options: RedactCaptureOptions,
): Promise<RedactCaptureResult> {
  const metadataFiles = createInitialMetadataFiles(options.files);
  const redaction = options.redaction;

  if (!redaction || redaction.paths.length === 0) {
    return {
      findings: [
        {
          id: "redaction.config-missing",
          severity: "error",
          title: "Redaction config is missing",
          message: 'Config field "redaction.paths" is required to redact captures.',
          suggestion: "Add redaction.paths to tool-call-contract.config.",
        },
      ],
      redaction: {
        checked: options.check,
        dryRun: options.dryRun,
        files: metadataFiles,
      },
    };
  }

  const targets = resolveRedactionTargets(options);
  if (targets.findings.length > 0) {
    return {
      findings: targets.findings,
      redaction: {
        checked: options.check,
        dryRun: options.dryRun,
        files: metadataFiles,
      },
    };
  }

  const read = await readRedactionInputs(options.cwd, targets.targets);
  const plan = planRedactions({
    files: read.inputs,
    paths: redaction.paths,
    replacement: redaction.replacement,
  });
  const destinationBySource = new Map(
    targets.targets.map((target) => [target.source, target.destination]),
  );
  const entryFindings = createEntryFindings(plan.entries);
  const checkFindings = options.check ? createCheckFindings(plan.entries) : [];
  const preWriteFindings = [...read.findings, ...plan.findings, ...entryFindings, ...checkFindings];
  const metadata = createRedactionMetadata(options, plan.entries, destinationBySource);
  const writeFindings =
    options.check || options.dryRun || hasErrorFindings(preWriteFindings)
      ? []
      : await writeRedactedFiles(options.cwd, plan.entries, destinationBySource);

  return {
    findings: [...preWriteFindings, ...writeFindings],
    redaction: metadata,
  };
}

function createInitialMetadataFiles(
  files: readonly CaptureFileRef[],
): RedactionReportMetadata["files"] {
  return files.map((file) => ({
    path: file.path,
    changed: false,
    replacements: 0,
  }));
}

function resolveRedactionTargets(options: RedactCaptureOptions): {
  targets: RedactionTarget[];
  findings: Finding[];
} {
  const outDir = options.outDir ? resolveDirectoryUnderCwd(options.cwd, options.outDir) : undefined;
  const out = options.out ? resolveFileUnderCwd(options.cwd, options.out) : undefined;
  const findings: Finding[] = [];

  if (outDir && !outDir.ok) {
    findings.push(outDir.finding);
  }

  if (out && !out.ok) {
    findings.push(out.finding);
  }

  if (findings.length > 0) {
    return {
      targets: [],
      findings,
    };
  }

  return {
    targets: options.files.map((file) => {
      const destination = resolveDestination(
        file.path,
        out && out.ok ? out.path : undefined,
        outDir && outDir.ok ? outDir.path : undefined,
      );
      return {
        source: file.path,
        destination,
      };
    }),
    findings: [],
  };
}

function resolveDestination(file: string, out?: string, outDir?: string): string {
  if (out) {
    return out;
  }

  if (outDir) {
    return toPosixPath(path.join(outDir, file));
  }

  return file;
}

async function readRedactionInputs(
  cwd: string,
  targets: readonly RedactionTarget[],
): Promise<{
  inputs: Array<{ file: string; content: string }>;
  findings: Finding[];
}> {
  const inputs: Array<{ file: string; content: string }> = [];
  const findings: Finding[] = [];

  for (const target of targets) {
    try {
      inputs.push({
        file: target.source,
        content: await readFile(path.resolve(cwd, target.source), "utf8"),
      });
    } catch (error) {
      findings.push({
        id: "capture.file-read-failed",
        severity: "error",
        title: "Capture file could not be read",
        message: `Could not read capture file: ${formatErrorMessage(error)}`,
        file: target.source,
      });
    }
  }

  return {
    inputs,
    findings,
  };
}

function createEntryFindings(entries: readonly RedactionPlanEntry[]): Finding[] {
  return entries.flatMap((entry) =>
    entry.issues.map((issue) => ({
      id: issue.code === "file.invalid-json" ? "capture.file-invalid-json" : issue.code,
      severity: "error" as const,
      title: "Capture file could not be redacted",
      message: issue.message,
      file: entry.file,
      path: issue.path?.join("."),
    })),
  );
}

function createCheckFindings(entries: readonly RedactionPlanEntry[]): Finding[] {
  return entries
    .filter((entry) => entry.changed)
    .map((entry) => ({
      id: "redaction.would-change",
      severity: "error" as const,
      title: "Capture file would change",
      message: `Redaction would change ${entry.file}.`,
      file: entry.file,
      suggestion: "Run redact without --check to update the capture file.",
    }));
}

function createRedactionMetadata(
  options: RedactCaptureOptions,
  entries: readonly RedactionPlanEntry[],
  destinationBySource: ReadonlyMap<string, string>,
): RedactionReportMetadata {
  return {
    checked: options.check,
    dryRun: options.dryRun,
    files: entries.map((entry) => ({
      path: entry.file,
      destination: destinationBySource.get(entry.file),
      changed: entry.changed,
      replacements: entry.replacements,
    })),
  };
}

async function writeRedactedFiles(
  cwd: string,
  entries: readonly RedactionPlanEntry[],
  destinationBySource: ReadonlyMap<string, string>,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const entry of entries) {
    if (!entry.changed || !entry.content) {
      continue;
    }

    const destination = destinationBySource.get(entry.file) ?? entry.file;
    const destinationPath = path.resolve(cwd, destination);

    try {
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, entry.content);
    } catch (error) {
      findings.push({
        id: "redaction.write-failed",
        severity: "error",
        title: "Redacted capture file could not be written",
        message: `Could not write redacted capture file: ${formatErrorMessage(error)}`,
        file: destination,
      });
    }
  }

  return findings;
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
    id: "capture.file-outside-root",
    severity: "error",
    title: "Redaction output is outside the project root",
    message: `Redaction paths must stay inside the project root: ${file}`,
    file,
  };
}

function hasErrorFindings(findings: readonly Finding[]): boolean {
  return findings.some((finding) => finding.severity === "error");
}

function toPosixPath(file: string): string {
  return file.split(path.sep).join("/");
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown file error.";
}
