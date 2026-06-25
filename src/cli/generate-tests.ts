import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { generateTestPlan, type GeneratedTestPlan } from "../test-generation.js";
import type { CaptureSuiteConfig } from "../contracts.js";
import type { Finding, GeneratedTestReportMetadata } from "../reporting.js";

export interface GenerateTestsOptions {
  cwd: string;
  configPath: string;
  captures?: CaptureSuiteConfig;
  suites: readonly string[];
  out?: string;
  dryRun: boolean;
}

export interface GenerateTestsResult {
  findings: Finding[];
  generatedTests: GeneratedTestReportMetadata;
}

type WriteState = "created" | "updated" | "unchanged";

export async function generateTests(options: GenerateTestsOptions): Promise<GenerateTestsResult> {
  const plan = await generateTestPlan({
    cwd: options.cwd,
    configPath: options.configPath,
    captures: options.captures,
    suites: options.suites,
    outFile: options.out,
  });
  const state =
    plan.findings.some((finding) => finding.severity === "error") || plan.content.length === 0
      ? "unchanged"
      : await resolveWriteState(options.cwd, plan);
  const writeFindings =
    options.dryRun || state === "unchanged" || hasErrorFindings(plan.findings)
      ? []
      : await writeGeneratedTest(options.cwd, plan);

  return {
    findings: [...plan.findings, ...writeFindings],
    generatedTests: {
      outFile: plan.outFile,
      dryRun: options.dryRun,
      captureFiles: plan.captureFiles.map((file) => file.path),
      created: state === "created",
      updated: state === "updated",
      unchanged: state === "unchanged",
    },
  };
}

async function resolveWriteState(cwd: string, plan: GeneratedTestPlan): Promise<WriteState> {
  try {
    const existing = await readFile(path.resolve(cwd, plan.outFile), "utf8");
    return existing === plan.content ? "unchanged" : "updated";
  } catch {
    return "created";
  }
}

async function writeGeneratedTest(cwd: string, plan: GeneratedTestPlan): Promise<Finding[]> {
  const destination = path.resolve(cwd, plan.outFile);

  try {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, plan.content);
    return [];
  } catch (error) {
    return [
      {
        id: "generated-test.write-failed",
        severity: "error",
        title: "Generated test file could not be written",
        message: `Could not write generated test file: ${formatErrorMessage(error)}`,
        file: plan.outFile,
      },
    ];
  }
}

function hasErrorFindings(findings: readonly Finding[]): boolean {
  return findings.some((finding) => finding.severity === "error");
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown file error.";
}
