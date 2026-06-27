import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CaptureFileRef } from "../captures.js";
import type { GenericNormalizationConfig } from "../contracts.js";
import { planNormalizationWrites, type NormalizationInputFile } from "../normalization-writer.js";
import type { NormalizationFormat } from "../normalization.js";
import type { Finding, NormalizationReportMetadata } from "../reporting.js";

export interface NormalizeCaptureOptions {
  cwd: string;
  files: readonly CaptureFileRef[];
  format: NormalizationFormat;
  includeSource: boolean;
  dryRun: boolean;
  check: boolean;
  out?: string;
  outDir?: string;
  generic?: GenericNormalizationConfig;
}

export interface NormalizeCaptureResult {
  findings: Finding[];
  normalization: NormalizationReportMetadata;
}

export async function normalizeCaptureFiles(
  options: NormalizeCaptureOptions,
): Promise<NormalizeCaptureResult> {
  const read = await readNormalizationInputs(options.cwd, options.files);
  const plan = await planNormalizationWrites({
    cwd: options.cwd,
    files: read.inputs,
    format: options.format,
    includeSource: options.includeSource,
    generic: options.generic,
    out: options.out,
    outDir: options.outDir,
    check: options.check,
  });

  return {
    findings: [...read.findings, ...plan.findings],
    normalization: {
      format: options.format,
      includeSource: options.includeSource,
      dryRun: options.dryRun,
      checked: options.check,
      files: plan.entries.map((entry) => ({
        inputPath: entry.inputPath,
        ...(entry.outputPath ? { outputPath: entry.outputPath } : {}),
        callsFound: entry.callsFound,
        callsWritten: entry.callsWritten,
        skipped: entry.skipped,
        changed: entry.changed,
      })),
    },
  };
}

async function readNormalizationInputs(
  cwd: string,
  files: readonly CaptureFileRef[],
): Promise<{
  inputs: NormalizationInputFile[];
  findings: Finding[];
}> {
  const inputs: NormalizationInputFile[] = [];
  const findings: Finding[] = [];

  for (const file of files) {
    try {
      inputs.push({
        path: file.path,
        content: await readFile(path.resolve(cwd, file.path), "utf8"),
      });
    } catch (error) {
      findings.push({
        id: "capture.file-read-failed",
        severity: "error",
        title: "Capture file could not be read",
        message: `Could not read capture file: ${formatErrorMessage(error)}`,
        file: file.path,
      });
    }
  }

  return {
    inputs,
    findings,
  };
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown file error.";
}
