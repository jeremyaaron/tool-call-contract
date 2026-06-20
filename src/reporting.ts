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

export type CommandName = "check" | "generate" | "validate";

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
  artifacts?: {
    created: string[];
    updated: string[];
    unchanged: string[];
    deleted: string[];
  };
}

export function createCommandReport(input: {
  command: CommandName;
  findings?: readonly Finding[];
  results?: readonly ToolCallValidationResult[];
  success?: boolean;
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
    ...(input.artifacts ? { artifacts: input.artifacts } : {}),
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
  const artifacts = report.artifacts;

  if (findings.length === 0 && results.length === 0 && !artifacts) {
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
    lines.push(
      `Validation results: ${report.summary.validResults} valid, ${report.summary.invalidResults} invalid.`,
    );

    for (const result of results) {
      lines.push("");
      if (result.ok) {
        lines.push(`valid ${result.contractName}`);
        continue;
      }

      lines.push(`invalid ${result.contractName ?? result.call?.name ?? "unknown"}`);
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
