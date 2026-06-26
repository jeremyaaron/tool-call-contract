import path from "node:path";

import { resolveCaptureFiles, type CaptureFileRef } from "./captures.js";
import type { CaptureSuiteConfig } from "./contracts.js";
import type { Finding } from "./reporting.js";

export const defaultGeneratedTestOutFile = "test/tool-call-contract.generated.test.ts";

export interface GenerateTestPlanOptions {
  cwd: string;
  configPath: string;
  captures?: CaptureSuiteConfig;
  suites: readonly string[];
  outFile?: string;
}

export interface GeneratedTestPlan {
  outFile: string;
  content: string;
  captureFiles: readonly CaptureFileRef[];
  findings: Finding[];
}

export async function generateTestPlan(
  options: GenerateTestPlanOptions,
): Promise<GeneratedTestPlan> {
  const outFile = resolveOutFile(options.cwd, options.outFile ?? defaultGeneratedTestOutFile);

  if (!outFile.ok) {
    return {
      outFile: options.outFile ?? defaultGeneratedTestOutFile,
      content: "",
      captureFiles: [],
      findings: [outFile.finding],
    };
  }

  const suites = resolveSelectedSuites(options.captures, options.suites);
  if (!suites.ok) {
    return {
      outFile: outFile.path,
      content: "",
      captureFiles: [],
      findings: [suites.finding],
    };
  }

  const captures = await resolveCaptureFiles({
    cwd: options.cwd,
    captures: options.captures,
    suites: suites.suites,
    files: [],
  });

  return {
    outFile: outFile.path,
    content:
      captures.files.length > 0
        ? renderGeneratedTest({
            cwd: options.cwd,
            configPath: options.configPath,
            outFile: outFile.path,
            captureFiles: captures.files,
          })
        : "",
    captureFiles: captures.files,
    findings: captures.findings,
  };
}

export function renderGeneratedTest(input: {
  cwd: string;
  configPath: string;
  outFile: string;
  captureFiles: readonly CaptureFileRef[];
}): string {
  const outDir = path.dirname(path.resolve(input.cwd, input.outFile));
  const configImport = toImportSpecifier(outDir, stripConfigExtension(input.configPath));
  const captureEntries = [...input.captureFiles]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => renderCaptureFileEntry(outDir, input.cwd, file.path));

  return `${[
    'import { readFile } from "node:fs/promises";',
    'import { describe, expect, it } from "vitest";',
    "",
    'import { validateToolCalls } from "tool-call-contract";',
    "",
    `import config from ${JSON.stringify(configImport)};`,
    "",
    "const captureFiles = [",
    ...captureEntries,
    "] as const;",
    "",
    'describe("tool-call-contract regression captures", () => {',
    "  for (const file of captureFiles) {",
    "    it(`validates ${file.label}`, async () => {",
    '      const capture = JSON.parse(await readFile(file.url, "utf8"));',
    "      const results = validateToolCalls(config.contracts, capture);",
    "      expect(results.every((result) => result.ok)).toBe(true);",
    "    });",
    "  }",
    "});",
  ].join("\n")}\n`;
}

function resolveSelectedSuites(
  captures: CaptureSuiteConfig | undefined,
  suites: readonly string[],
):
  | {
      ok: true;
      suites: readonly string[];
    }
  | {
      ok: false;
      finding: Finding;
    } {
  if (suites.length > 0) {
    return {
      ok: true,
      suites,
    };
  }

  const configuredSuites = Object.keys(captures ?? {});
  if (configuredSuites.length === 0) {
    return {
      ok: false,
      finding: {
        id: "generated-test.no-captures",
        severity: "error",
        title: "No capture suites are configured",
        message: "Generated tests require at least one configured capture suite.",
        suggestion: "Add config.captures or pass --suite for an existing suite.",
      },
    };
  }

  return {
    ok: true,
    suites: configuredSuites,
  };
}

function resolveOutFile(
  cwd: string,
  outFile: string,
):
  | {
      ok: true;
      path: string;
    }
  | {
      ok: false;
      finding: Finding;
    } {
  const resolved = path.resolve(cwd, outFile);
  const relative = path.relative(cwd, resolved);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return {
      ok: false,
      finding: {
        id: "generated-test.outside-root",
        severity: "error",
        title: "Generated test output is outside the project root",
        message: `Generated test output must stay inside the project root: ${outFile}`,
        file: outFile,
      },
    };
  }

  return {
    ok: true,
    path: toPosixPath(relative),
  };
}

function renderCaptureFileEntry(outDir: string, cwd: string, file: string): string {
  const fileUrl = toImportSpecifier(outDir, path.resolve(cwd, file));

  return [
    "  {",
    `    label: ${JSON.stringify(file)},`,
    `    url: new URL(${JSON.stringify(fileUrl)}, import.meta.url),`,
    "  },",
  ].join("\n");
}

function toImportSpecifier(fromDir: string, target: string): string {
  const relative = toPosixPath(path.relative(fromDir, target));
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function stripConfigExtension(configPath: string): string {
  return configPath.replace(/\.(?:c|m)?(?:t|j)s$/, "");
}

function toPosixPath(file: string): string {
  return file.split(path.sep).join("/");
}
