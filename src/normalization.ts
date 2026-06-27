import type { GenericNormalizationConfig } from "./contracts.js";
import type { NormalizedToolCall, ToolCallIssue, ToolCallSource } from "./validation.js";

export type NormalizationFormat =
  | "normalized"
  | "openai-chat"
  | "openai-responses"
  | "vercel-ai-sdk"
  | "langchain"
  | "generic";

export interface NormalizeToolCallsOptions {
  format: NormalizationFormat;
  includeSource?: boolean;
  generic?: GenericNormalizationConfig;
}

export interface NormalizeToolCallsResult {
  calls: NormalizedToolCall[];
  issues: ToolCallIssue[];
  skipped: number;
}

interface RawToolCall {
  name: unknown;
  arguments: unknown;
  hasArguments: boolean;
  id?: unknown;
  source?: unknown;
}

const supportedToolCallSources = new Set<ToolCallSource>([
  "normalized",
  "openai-chat",
  "openai-responses",
  "vercel-ai-sdk",
  "langchain",
  "generic",
  "unknown",
]);

export function normalizeToolCallCapture(input: {
  name: string;
  arguments: unknown;
  id?: string;
  source?: ToolCallSource;
}): NormalizeToolCallsResult {
  return normalizeToolCallCaptures(input, {
    format: "normalized",
    includeSource: input.id !== undefined || input.source !== undefined,
  });
}

export function normalizeToolCallCaptures(
  input: unknown,
  options: NormalizeToolCallsOptions,
): NormalizeToolCallsResult {
  if (options.format !== "normalized") {
    return {
      calls: [],
      issues: [
        {
          code: "normalize.format-unsupported",
          message: `Normalization format "${options.format}" is not implemented yet.`,
        },
      ],
      skipped: 0,
    };
  }

  return normalizeNormalizedCaptures(input, options);
}

function normalizeNormalizedCaptures(
  input: unknown,
  options: NormalizeToolCallsOptions,
): NormalizeToolCallsResult {
  const calls: NormalizedToolCall[] = [];
  const issues: ToolCallIssue[] = [];
  let skipped = 0;

  const values = Array.isArray(input)
    ? input.map((value, index) => ({ value, path: [index] }))
    : [{ value: input, path: [] }];

  for (const entry of values) {
    const raw = readNormalizedCall(entry.value, entry.path);

    if (!raw.ok) {
      issues.push(...raw.issues);
      skipped += 1;
      continue;
    }

    const normalized = finalizeToolCall(raw.call, entry.path, options);

    if (!normalized.ok) {
      issues.push(...normalized.issues);
      skipped += 1;
      continue;
    }

    calls.push(normalized.call);
  }

  if (calls.length === 0 && issues.length === 0) {
    issues.push({
      code: "normalize.no-tool-calls",
      message: "Input did not contain any normalized tool calls.",
    });
  }

  return {
    calls,
    issues,
    skipped,
  };
}

function readNormalizedCall(
  value: unknown,
  path: Array<string | number>,
): { ok: true; call: RawToolCall } | { ok: false; issues: ToolCallIssue[] } {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          code: "normalize.input-unsupported",
          message: "Normalized tool call input must be an object.",
          path,
        },
      ],
    };
  }

  if (hasOwn(value, "name")) {
    return {
      ok: true,
      call: {
        name: value.name,
        arguments: value.arguments,
        hasArguments: hasOwn(value, "arguments"),
        id: value.id,
        source: value.source,
      },
    };
  }

  if (hasOwn(value, "toolName")) {
    return {
      ok: true,
      call: {
        name: value.toolName,
        arguments: value.args,
        hasArguments: hasOwn(value, "args"),
        id: value.id,
        source: value.source,
      },
    };
  }

  return {
    ok: false,
    issues: [
      {
        code: "normalize.name-missing",
        message: 'Normalized tool call must include "name" or "toolName".',
        path,
      },
    ],
  };
}

function finalizeToolCall(
  raw: RawToolCall,
  path: Array<string | number>,
  options: NormalizeToolCallsOptions,
): { ok: true; call: NormalizedToolCall } | { ok: false; issues: ToolCallIssue[] } {
  const issues: ToolCallIssue[] = [];
  const name = normalizeName(raw.name, path);
  const args = normalizeArguments(raw.arguments, raw.hasArguments, path);

  if (!name.ok || !args.ok) {
    if (!name.ok) {
      issues.push(...name.issues);
    }

    if (!args.ok) {
      issues.push(...args.issues);
    }

    return {
      ok: false,
      issues,
    };
  }

  return {
    ok: true,
    call: {
      name: name.value,
      arguments: args.value,
      ...(options.includeSource ? normalizeSourceMetadata(raw) : {}),
    },
  };
}

function normalizeName(
  value: unknown,
  path: Array<string | number>,
):
  | {
      ok: true;
      value: string;
    }
  | {
      ok: false;
      issues: ToolCallIssue[];
    } {
  if (typeof value !== "string") {
    return {
      ok: false,
      issues: [
        {
          code: "normalize.name-not-string",
          message: "Tool call name must be a string.",
          path: [...path, "name"],
        },
      ],
    };
  }

  if (value.trim().length === 0) {
    return {
      ok: false,
      issues: [
        {
          code: "normalize.name-missing",
          message: "Tool call name must be a non-empty string.",
          path: [...path, "name"],
        },
      ],
    };
  }

  return {
    ok: true,
    value,
  };
}

function normalizeArguments(
  value: unknown,
  hasArguments: boolean,
  path: Array<string | number>,
):
  | {
      ok: true;
      value: Record<string, unknown>;
    }
  | {
      ok: false;
      issues: ToolCallIssue[];
    } {
  if (!hasArguments) {
    return {
      ok: false,
      issues: [
        {
          code: "normalize.arguments-missing",
          message: "Tool call arguments are missing.",
          path,
        },
      ],
    };
  }

  const parsed = parseArgumentValue(value, path);
  if (!parsed.ok) {
    return parsed;
  }

  if (!isRecord(parsed.value)) {
    return {
      ok: false,
      issues: [
        {
          code: "normalize.arguments-not-object",
          message: "Tool call arguments must be an object.",
          path: [...path, "arguments"],
        },
      ],
    };
  }

  return {
    ok: true,
    value: parsed.value,
  };
}

function parseArgumentValue(
  value: unknown,
  path: Array<string | number>,
):
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
      issues: ToolCallIssue[];
    } {
  if (typeof value !== "string") {
    return {
      ok: true,
      value,
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(value) as unknown,
    };
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "normalize.arguments-invalid-json",
          message: "Tool call arguments contain malformed JSON.",
          path: [...path, "arguments"],
        },
      ],
    };
  }
}

function normalizeSourceMetadata(raw: RawToolCall): Pick<NormalizedToolCall, "id" | "source"> {
  const id = typeof raw.id === "string" ? raw.id : undefined;
  const source = normalizeSource(raw.source) ?? "normalized";

  return {
    ...(id ? { id } : {}),
    source,
  };
}

function normalizeSource(value: unknown): ToolCallSource | undefined {
  return typeof value === "string" && supportedToolCallSources.has(value as ToolCallSource)
    ? (value as ToolCallSource)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
