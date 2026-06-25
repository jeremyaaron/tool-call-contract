import type { Finding } from "./reporting.js";
import type { ToolCallIssue } from "./validation.js";

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

interface ParsedRedactionPath {
  source: string;
  segments: string[];
}

type RedactionTarget =
  | {
      kind: "array";
      parent: unknown[];
      key: number;
    }
  | {
      kind: "object";
      parent: Record<string, unknown>;
      key: string;
    };

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
  paths: readonly ParsedRedactionPath[],
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
  paths: ParsedRedactionPath[];
  findings: Finding[];
} {
  const parsedPaths: ParsedRedactionPath[] = [];
  const findings: Finding[] = [];

  for (const path of paths) {
    const parsed = parseRedactionPath(path);

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

    parsedPaths.push(parsed.path);
  }

  return {
    paths: parsedPaths,
    findings,
  };
}

function parseRedactionPath(
  path: string,
): { ok: true; path: ParsedRedactionPath } | { ok: false; message: string } {
  if (path.trim().length === 0) {
    return {
      ok: false,
      message: "Redaction path must be a non-empty dot path.",
    };
  }

  const segments = path.split(".");
  const emptySegmentIndex = segments.findIndex((segment) => segment.length === 0);

  if (emptySegmentIndex !== -1) {
    return {
      ok: false,
      message: `Redaction path "${path}" contains an empty segment at index ${emptySegmentIndex}.`,
    };
  }

  return {
    ok: true,
    path: {
      source: path,
      segments,
    },
  };
}

function applyRedactions(
  value: unknown,
  paths: readonly ParsedRedactionPath[],
  replacement: string,
): number {
  let replacements = 0;

  visitJson(value, (node) => {
    for (const path of paths) {
      replacements += redactAtPath(node, path.segments, replacement);
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

function redactAtPath(
  value: unknown,
  segments: readonly string[],
  replacement: string,
  index = 0,
): number {
  if (index >= segments.length) {
    return 0;
  }

  const segment = segments[index];
  if (!segment) {
    return 0;
  }

  if (index === segments.length - 1) {
    return replaceChild(value, segment, replacement);
  }

  let replacements = 0;

  for (const child of getMatchingChildren(value, segment)) {
    replacements += redactAtPath(child, segments, replacement, index + 1);
  }

  return replacements;
}

function replaceChild(value: unknown, segment: string, replacement: string): number {
  let replacements = 0;

  for (const target of getMatchingTargets(value, segment)) {
    if (Object.is(getTargetValue(target), replacement)) {
      continue;
    }

    setTargetValue(target, replacement);
    replacements += 1;
  }

  return replacements;
}

function getMatchingChildren(value: unknown, segment: string): unknown[] {
  return getMatchingTargets(value, segment).map(getTargetValue);
}

function getMatchingTargets(value: unknown, segment: string): RedactionTarget[] {
  if (Array.isArray(value)) {
    if (segment === "*") {
      return value.map((_, index) => ({
        kind: "array",
        parent: value,
        key: index,
      }));
    }

    const index = parseArrayIndex(segment);
    return index !== undefined && index < value.length
      ? [
          {
            kind: "array",
            parent: value,
            key: index,
          },
        ]
      : [];
  }

  if (!isRecord(value)) {
    return [];
  }

  if (segment === "*") {
    return Object.keys(value).map((key) => ({
      kind: "object",
      parent: value,
      key,
    }));
  }

  return Object.prototype.hasOwnProperty.call(value, segment)
    ? [
        {
          kind: "object",
          parent: value,
          key: segment,
        },
      ]
    : [];
}

function getTargetValue(target: RedactionTarget): unknown {
  if (target.kind === "array") {
    return target.parent[target.key];
  }

  return target.parent[target.key];
}

function setTargetValue(target: RedactionTarget, value: unknown): void {
  if (target.kind === "array") {
    target.parent[target.key] = value;
    return;
  }

  target.parent[target.key] = value;
}

function parseArrayIndex(segment: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(segment)) {
    return undefined;
  }

  return Number(segment);
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
