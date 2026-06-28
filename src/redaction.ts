import type { Finding } from "./reporting.js";
import type { ToolCallIssue } from "./validation.js";
import {
  getPathTargetValue,
  parsePathSelector,
  selectPathTargets,
  setPathTargetValue,
  type ParsedPathSelector,
} from "./path-selectors.js";

export const defaultRedactionReplacement = "[REDACTED]";

export interface RedactionFileInput {
  file: string;
  content: string;
}

export interface RedactionPlanEntry {
  file: string;
  changed: boolean;
  content?: string;
  replacements: number;
  issues: ToolCallIssue[];
}

export interface RedactionPlan {
  entries: RedactionPlanEntry[];
  findings: Finding[];
}

export interface PlanRedactionsOptions {
  files: readonly RedactionFileInput[];
  paths: readonly string[];
  replacement?: string;
}

export function planRedactions(options: PlanRedactionsOptions): RedactionPlan {
  const parsedPaths = parseRedactionPaths(options.paths);
  const entries = options.files.map((file) =>
    planFileRedaction(file, parsedPaths.paths, options.replacement ?? defaultRedactionReplacement),
  );

  return {
    entries,
    findings: parsedPaths.findings,
  };
}

export function redactJsonValue(input: {
  value: unknown;
  paths: readonly string[];
  replacement?: string;
}): { value: unknown; replacements: number; findings: Finding[] } {
  const parsedPaths = parseRedactionPaths(input.paths);
  const value = structuredClone(input.value);
  const replacements = applyRedactions(
    value,
    parsedPaths.paths,
    input.replacement ?? defaultRedactionReplacement,
  );

  return {
    value,
    replacements,
    findings: parsedPaths.findings,
  };
}

function planFileRedaction(
  file: RedactionFileInput,
  paths: readonly ParsedPathSelector[],
  replacement: string,
): RedactionPlanEntry {
  const parsed = parseJson(file.content);

  if (!parsed.ok) {
    return {
      file: file.file,
      changed: false,
      replacements: 0,
      issues: [
        {
          code: "file.invalid-json",
          message: `Capture file contains malformed JSON: ${parsed.message}`,
        },
      ],
    };
  }

  const replacements = applyRedactions(parsed.value, paths, replacement);
  const content = formatRedactedJson(parsed.value);
  const changed = content !== file.content;

  return {
    file: file.file,
    changed,
    ...(changed ? { content } : {}),
    replacements,
    issues: [],
  };
}

function parseRedactionPaths(paths: readonly string[]): {
  paths: ParsedPathSelector[];
  findings: Finding[];
} {
  const parsedPaths: ParsedPathSelector[] = [];
  const findings: Finding[] = [];

  for (const path of paths) {
    const parsed = parsePathSelector(path);

    if (!parsed.ok) {
      findings.push({
        id: "redaction.path-invalid",
        severity: "error",
        title: "Redaction path is invalid",
        message: parsed.message,
        path,
      });
      continue;
    }

    parsedPaths.push(parsed.selector);
  }

  return {
    paths: parsedPaths,
    findings,
  };
}

function applyRedactions(
  value: unknown,
  paths: readonly ParsedPathSelector[],
  replacement: string,
): number {
  let replacements = 0;

  visitJson(value, (node) => {
    for (const path of paths) {
      replacements += redactAtPath(node, path, replacement);
    }
  });

  return replacements;
}

function visitJson(value: unknown, visitor: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitJson(item, visitor);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  visitor(value);

  for (const child of Object.values(value)) {
    visitJson(child, visitor);
  }
}

function redactAtPath(value: unknown, path: ParsedPathSelector, replacement: string): number {
  let replacements = 0;

  for (const target of selectPathTargets(value, path)) {
    if (Object.is(getPathTargetValue(target), replacement)) {
      continue;
    }

    setPathTargetValue(target, replacement);
    replacements += 1;
  }

  return replacements;
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

function formatRedactedJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
