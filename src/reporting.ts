import type { CaptureFileRef } from "./captures.js";
import type { NormalizationFormat } from "./normalization.js";
import type { ToolCallValidationResult } from "./validation.js";

export type Severity = "error" | "warning" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  message: string;
  impact?: string;
  suggestion?: string;
  contractName?: string;
  file?: string;
  path?: string;
}

export type CommandName =
  | "check"
  | "generate"
  | "validate"
  | "redact"
  | "generate-tests"
  | "normalize";

export interface ReportSummary {
  errors: number;
  warnings: number;
  info: number;
  validResults: number;
  invalidResults: number;
}

export interface CommandReport {
  schemaVersion: 1;
  command: CommandName;
  success: boolean;
  summary: ReportSummary;
  findings?: Finding[];
  results?: ToolCallValidationResult[];
  validation?: ValidationReportMetadata;
  redaction?: RedactionReportMetadata;
  generatedTests?: GeneratedTestReportMetadata;
  normalization?: NormalizationReportMetadata;
  artifacts?: {
    created: string[];
    updated: string[];
    unchanged: string[];
    deleted: string[];
  };
}

export interface ValidationReportMetadata {
  suites: Array<{
    name: string;
    files: string[];
    validResults: number;
    invalidResults: number;
  }>;
  files: Array<{
    path: string;
    suiteNames: string[];
    validResults: number;
    invalidResults: number;
  }>;
  contracts: Array<{
    name: string;
    validResults: number;
    invalidResults: number;
    unknownResults: number;
  }>;
}

export interface RedactionReportMetadata {
  checked: boolean;
  dryRun: boolean;
  files: Array<{
    path: string;
    destination?: string;
    changed: boolean;
    replacements: number;
  }>;
}

export interface GeneratedTestReportMetadata {
  outFile: string;
  dryRun: boolean;
  captureFiles: string[];
  created: boolean;
  updated: boolean;
  unchanged: boolean;
}

export interface NormalizationReportMetadata {
  format: NormalizationFormat;
  includeSource: boolean;
  dryRun: boolean;
  checked: boolean;
  files: Array<{
    inputPath: string;
    outputPath?: string;
    callsFound: number;
    callsWritten: number;
    skipped: number;
    changed: boolean;
  }>;
}

export function createCommandReport(input: {
  command: CommandName;
  findings?: readonly Finding[];
  results?: readonly ToolCallValidationResult[];
  success?: boolean;
  validation?: ValidationReportMetadata;
  redaction?: RedactionReportMetadata;
  generatedTests?: GeneratedTestReportMetadata;
  normalization?: NormalizationReportMetadata;
  artifacts?: CommandReport["artifacts"];
}): CommandReport {
  const findings = [...(input.findings ?? [])];
  const results = [...(input.results ?? [])];
  const summary = summarizeReport(findings, results);
  const success = input.success ?? (summary.errors === 0 && summary.invalidResults === 0);

  return {
    schemaVersion: 1,
    command: input.command,
    success,
    summary,
    ...(findings.length > 0 ? { findings } : {}),
    ...(results.length > 0 ? { results } : {}),
    ...(input.validation ? { validation: input.validation } : {}),
    ...(input.redaction ? { redaction: input.redaction } : {}),
    ...(input.generatedTests ? { generatedTests: input.generatedTests } : {}),
    ...(input.normalization ? { normalization: input.normalization } : {}),
    ...(input.artifacts ? { artifacts: input.artifacts } : {}),
  };
}

export function createValidationReportMetadata(input: {
  suites: readonly string[];
  files: readonly CaptureFileRef[];
  results: readonly ToolCallValidationResult[];
}): ValidationReportMetadata {
  const selectedSuites = dedupe(input.suites);
  const files = [...input.files].sort((left, right) => left.path.localeCompare(right.path));
  const resultsByFile = groupResultsByFile(input.results);
  const fileEntries = files.map((file) => {
    const fileResults = resultsByFile.get(file.path) ?? [];
    return {
      path: file.path,
      suiteNames: [...file.suiteNames],
      validResults: countValidResults(fileResults),
      invalidResults: countInvalidResults(fileResults),
    };
  });

  return {
    suites: selectedSuites.map((suite) => {
      const suiteFiles = files.filter((file) => file.suiteNames.includes(suite));
      const suiteResults = suiteFiles.flatMap((file) => resultsByFile.get(file.path) ?? []);

      return {
        name: suite,
        files: suiteFiles.map((file) => file.path),
        validResults: countValidResults(suiteResults),
        invalidResults: countInvalidResults(suiteResults),
      };
    }),
    files: fileEntries,
    contracts: createContractValidationMetadata(input.results),
  };
}

export function summarizeReport(
  findings: readonly Finding[],
  results: readonly ToolCallValidationResult[] = [],
): ReportSummary {
  return {
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    info: findings.filter((finding) => finding.severity === "info").length,
    validResults: results.filter((result) => result.ok).length,
    invalidResults: results.filter((result) => !result.ok).length,
  };
}

export function renderHumanReport(report: CommandReport): string {
  const lines = [`tool-call-contract ${report.command}`];
  const findings = report.findings ?? [];
  const results = report.results ?? [];
  const validation = report.validation;
  const redaction = report.redaction;
  const generatedTests = report.generatedTests;
  const normalization = report.normalization;
  const artifacts = report.artifacts;

  if (
    findings.length === 0 &&
    results.length === 0 &&
    !validation &&
    !redaction &&
    !generatedTests &&
    !normalization &&
    !artifacts
  ) {
    lines.push("No findings.");
    return `${lines.join("\n")}\n`;
  }

  if (findings.length > 0) {
    lines.push(
      `Findings: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.info} info.`,
    );

    for (const finding of findings) {
      lines.push("");
      lines.push(`${finding.severity} ${finding.id}`);
      lines.push(`  ${finding.title}`);
      if (finding.contractName) {
        lines.push(`  Contract: ${finding.contractName}`);
      }
      if (finding.file || finding.path) {
        lines.push(`  Location: ${[finding.file, finding.path].filter(Boolean).join(" ")}`);
      }
      lines.push(`  ${finding.message}`);
      if (finding.impact) {
        lines.push("");
        lines.push("  Impact:");
        lines.push(`    ${finding.impact}`);
      }
      if (finding.suggestion) {
        lines.push("");
        lines.push("  Fix:");
        lines.push(`    ${finding.suggestion}`);
      }
    }
  }

  if (results.length > 0) {
    if (validation) {
      pushValidationMetadata(lines, validation);
    }

    lines.push(
      `Validation results: ${report.summary.validResults} valid, ${report.summary.invalidResults} invalid.`,
    );

    for (const result of results) {
      lines.push("");
      if (result.ok) {
        lines.push(`valid ${result.contractName}`);
        if (result.file) {
          lines.push(`  File: ${result.file}`);
        }
        continue;
      }

      lines.push(`invalid ${result.contractName ?? result.call?.name ?? "unknown"}`);
      if (result.file) {
        lines.push(`  File: ${result.file}`);
      }
      for (const issue of result.issues) {
        const path = issue.path && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
        lines.push(`  ${issue.code}${path}: ${issue.message}`);
      }
    }
  }

  if (artifacts) {
    lines.push(
      `Artifacts: ${artifacts.created.length} created, ${artifacts.updated.length} updated, ${artifacts.unchanged.length} unchanged, ${artifacts.deleted.length} deleted.`,
    );

    pushArtifactPaths(lines, "Created", artifacts.created);
    pushArtifactPaths(lines, "Updated", artifacts.updated);
    pushArtifactPaths(lines, "Unchanged", artifacts.unchanged);
    pushArtifactPaths(lines, "Deleted", artifacts.deleted);
  }

  if (redaction) {
    pushRedactionMetadata(lines, redaction);
  }

  if (generatedTests) {
    pushGeneratedTestMetadata(lines, generatedTests);
  }

  if (normalization) {
    pushNormalizationMetadata(lines, normalization);
  }

  return `${lines.join("\n")}\n`;
}

export function renderJsonReport(report: CommandReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function hasBlockingFailures(report: CommandReport): boolean {
  return report.summary.errors > 0 || report.summary.invalidResults > 0 || !report.success;
}

function pushArtifactPaths(lines: string[], label: string, paths: readonly string[]): void {
  if (paths.length === 0) {
    return;
  }

  lines.push("");
  lines.push(`${label}:`);
  for (const file of paths) {
    lines.push(`  ${file}`);
  }
}

function groupResultsByFile(
  results: readonly ToolCallValidationResult[],
): Map<string, ToolCallValidationResult[]> {
  const resultsByFile = new Map<string, ToolCallValidationResult[]>();

  for (const result of results) {
    if (!result.file) {
      continue;
    }

    const existing = resultsByFile.get(result.file) ?? [];
    existing.push(result);
    resultsByFile.set(result.file, existing);
  }

  return resultsByFile;
}

function createContractValidationMetadata(
  results: readonly ToolCallValidationResult[],
): ValidationReportMetadata["contracts"] {
  const contracts = new Map<
    string,
    {
      name: string;
      validResults: number;
      invalidResults: number;
      unknownResults: number;
    }
  >();

  for (const result of results) {
    const name = getResultContractName(result);
    const entry = contracts.get(name) ?? {
      name,
      validResults: 0,
      invalidResults: 0,
      unknownResults: 0,
    };

    if (result.ok) {
      entry.validResults += 1;
    } else {
      entry.invalidResults += 1;
      if (isUnknownToolResult(result)) {
        entry.unknownResults += 1;
      }
    }

    contracts.set(name, entry);
  }

  return [...contracts.values()].sort(compareContractEntries);
}

function getResultContractName(result: ToolCallValidationResult): string {
  if (result.ok) {
    return result.contractName;
  }

  return result.contractName ?? result.call?.name ?? "unknown";
}

function compareContractEntries(
  left: ValidationReportMetadata["contracts"][number],
  right: ValidationReportMetadata["contracts"][number],
): number {
  if (left.name === "unknown" && right.name !== "unknown") {
    return 1;
  }

  if (right.name === "unknown" && left.name !== "unknown") {
    return -1;
  }

  return left.name.localeCompare(right.name);
}

function isUnknownToolResult(result: ToolCallValidationResult): boolean {
  return !result.ok && result.issues.some((issue) => issue.code === "call.unknown-tool");
}

function countValidResults(results: readonly ToolCallValidationResult[]): number {
  return results.filter((result) => result.ok).length;
}

function countInvalidResults(results: readonly ToolCallValidationResult[]): number {
  return results.filter((result) => !result.ok).length;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function pushValidationMetadata(lines: string[], validation: ValidationReportMetadata): void {
  if (validation.suites.length > 0) {
    lines.push("Validation suites:");
    for (const suite of validation.suites) {
      lines.push(
        `  ${suite.name}: ${suite.files.length} file(s), ${suite.validResults} valid, ${suite.invalidResults} invalid`,
      );
    }
  }

  if (validation.files.length > 0) {
    if (validation.suites.length > 0) {
      lines.push("");
    }

    lines.push("Validation files:");
    for (const file of validation.files) {
      const suites = file.suiteNames.length > 0 ? file.suiteNames.join(", ") : "direct";
      lines.push(
        `  ${file.path}: ${suites}, ${file.validResults} valid, ${file.invalidResults} invalid`,
      );
    }

    lines.push("");
  }
}

function pushRedactionMetadata(lines: string[], redaction: RedactionReportMetadata): void {
  const changed = redaction.files.filter((file) => file.changed).length;
  const unchanged = redaction.files.length - changed;
  const mode = redaction.checked ? " check" : redaction.dryRun ? " dry run" : "";

  lines.push(`Redaction${mode}: ${changed} changed, ${unchanged} unchanged.`);

  for (const file of redaction.files) {
    const state = file.changed ? "changed" : "unchanged";
    const destination =
      file.destination && file.destination !== file.path ? ` -> ${file.destination}` : "";
    lines.push(`  ${state} ${file.path}${destination}: ${file.replacements} replacement(s)`);
  }
}

function pushGeneratedTestMetadata(
  lines: string[],
  generatedTests: GeneratedTestReportMetadata,
): void {
  const state = generatedTests.created
    ? "created"
    : generatedTests.updated
      ? "updated"
      : "unchanged";
  const suffix = generatedTests.dryRun ? " (dry run)" : "";

  lines.push(`Generated test: ${generatedTests.outFile} ${state}${suffix}.`);
  lines.push(`  Captures: ${generatedTests.captureFiles.length} file(s)`);
}

function pushNormalizationMetadata(
  lines: string[],
  normalization: NormalizationReportMetadata,
): void {
  const changed = normalization.files.filter((file) => file.changed).length;
  const unchanged = normalization.files.length - changed;
  const mode = normalization.checked ? " check" : normalization.dryRun ? " dry run" : "";

  lines.push(
    `Normalization${mode}: ${normalization.format}, ${changed} changed, ${unchanged} unchanged.`,
  );

  for (const file of normalization.files) {
    const state = file.changed ? "changed" : "unchanged";
    const destination = file.outputPath ? ` -> ${file.outputPath}` : "";
    lines.push(`  ${state} ${file.inputPath}${destination}`);
    lines.push(
      `    calls found: ${file.callsFound}, written: ${file.callsWritten}, skipped: ${file.skipped}`,
    );
  }
}
