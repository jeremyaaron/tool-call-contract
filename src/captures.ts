import path from "node:path";

import { glob } from "tinyglobby";

import type { CaptureSuiteConfig } from "./contracts.js";
import type { Finding } from "./reporting.js";

export interface CaptureFileRef {
  path: string;
  suiteNames: readonly string[];
}

export interface ResolveCaptureFilesOptions {
  cwd: string;
  suites: readonly string[];
  files: readonly string[];
  captures?: CaptureSuiteConfig;
}

export interface ResolveCaptureFilesResult {
  files: CaptureFileRef[];
  findings: Finding[];
}

interface MutableCaptureFileRef {
  path: string;
  suiteNames: string[];
}

export async function resolveCaptureFiles(
  options: ResolveCaptureFilesOptions,
): Promise<ResolveCaptureFilesResult> {
  const filesByPath = new Map<string, MutableCaptureFileRef>();
  const findings: Finding[] = [];
  const selectedSuites = dedupe(options.suites);

  for (const suite of selectedSuites) {
    const suiteResult = await resolveSuiteFiles(options.cwd, options.captures, suite);
    findings.push(...suiteResult.findings);

    for (const file of suiteResult.files) {
      addCaptureFile(filesByPath, file, suite);
    }
  }

  for (const file of options.files) {
    const normalized = normalizeProjectPath(options.cwd, file);

    if (!normalized.ok) {
      findings.push(createOutsideRootFinding(file));
      continue;
    }

    addCaptureFile(filesByPath, normalized.path);
  }

  return {
    files: [...filesByPath.values()]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => ({
        path: file.path,
        suiteNames: file.suiteNames,
      })),
    findings,
  };
}

async function resolveSuiteFiles(
  cwd: string,
  captures: CaptureSuiteConfig | undefined,
  suite: string,
): Promise<{ files: string[]; findings: Finding[] }> {
  const patterns = captures?.[suite];

  if (!patterns) {
    return {
      files: [],
      findings: [
        {
          id: "capture.suite-unknown",
          severity: "error",
          title: "Capture suite is not configured",
          message: `No capture suite named "${suite}" is configured.`,
          suggestion: "Add the suite to config.captures or choose a configured suite.",
        },
      ],
    };
  }

  if (patterns.length === 0) {
    return {
      files: [],
      findings: [createEmptySuiteFinding(suite)],
    };
  }

  const matches = await glob([...patterns], {
    cwd,
    onlyFiles: true,
    absolute: false,
    dot: true,
  });
  const files: string[] = [];
  const findings: Finding[] = [];

  for (const match of matches) {
    const normalized = normalizeProjectPath(cwd, match);

    if (!normalized.ok) {
      findings.push(createOutsideRootFinding(match));
      continue;
    }

    files.push(normalized.path);
  }

  const uniqueFiles = dedupe(files).sort((left, right) => left.localeCompare(right));

  if (uniqueFiles.length === 0) {
    findings.push(createEmptySuiteFinding(suite));
  }

  return {
    files: uniqueFiles,
    findings,
  };
}

function addCaptureFile(
  filesByPath: Map<string, MutableCaptureFileRef>,
  file: string,
  suiteName?: string,
): void {
  const existing = filesByPath.get(file);

  if (existing) {
    if (suiteName && !existing.suiteNames.includes(suiteName)) {
      existing.suiteNames.push(suiteName);
    }
    return;
  }

  filesByPath.set(file, {
    path: file,
    suiteNames: suiteName ? [suiteName] : [],
  });
}

function normalizeProjectPath(
  cwd: string,
  file: string,
): { ok: true; path: string } | { ok: false } {
  const resolved = path.resolve(cwd, file);
  const relative = path.relative(cwd, resolved);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false };
  }

  return {
    ok: true,
    path: toPosixPath(relative),
  };
}

function toPosixPath(file: string): string {
  return file.split(path.sep).join("/");
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function createEmptySuiteFinding(suite: string): Finding {
  return {
    id: "capture.suite-empty",
    severity: "error",
    title: "Capture suite did not match any files",
    message: `Capture suite "${suite}" did not match any files.`,
    suggestion: "Update the suite patterns or choose a suite with captured JSON files.",
  };
}

function createOutsideRootFinding(file: string): Finding {
  return {
    id: "capture.file-outside-root",
    severity: "error",
    title: "Capture file is outside the project root",
    message: `Capture file must stay inside the project root: ${file}`,
    file,
  };
}
