import type { GenericNormalizationConfig } from "./contracts.js";
import { parsePathSelector, selectPathValues, type ParsedPathSelector } from "./path-selectors.js";
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

interface RawToolCallEntry {
  call: RawToolCall;
  path: Array<string | number>;
}

interface ExtractToolCallsResult {
  entries: RawToolCallEntry[];
  issues: ToolCallIssue[];
  skipped: number;
}

type NormalizeToolCallsRuntimeOptions = NormalizeToolCallsOptions & {
  allowNonObjectArguments?: boolean;
};

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
  const runtimeOptions = options as NormalizeToolCallsRuntimeOptions;
  const extracted = extractToolCalls(input, runtimeOptions);
  return finalizeExtractedToolCalls(extracted, runtimeOptions);
}

function finalizeExtractedToolCalls(
  extracted: ExtractToolCallsResult,
  options: NormalizeToolCallsRuntimeOptions,
): NormalizeToolCallsResult {
  const calls: NormalizedToolCall[] = [];
  const issues: ToolCallIssue[] = [...extracted.issues];
  let skipped = extracted.skipped;

  for (const entry of extracted.entries) {
    const normalized = finalizeToolCall(entry.call, entry.path, options);

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

function extractToolCalls(
  input: unknown,
  options: NormalizeToolCallsRuntimeOptions,
): ExtractToolCallsResult {
  switch (options.format) {
    case "normalized":
      return extractNormalizedToolCalls(input);
    case "openai-chat":
      return extractOpenAIChatToolCalls(input);
    case "openai-responses":
      return extractOpenAIResponsesToolCalls(input);
    case "vercel-ai-sdk":
      return extractVercelAiSdkToolCalls(input);
    case "langchain":
      return extractLangChainToolCalls(input);
    case "generic":
      return extractGenericToolCalls(input, options.generic);
  }
}

function extractNormalizedToolCalls(input: unknown): ExtractToolCallsResult {
  const entries: RawToolCallEntry[] = [];
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

    entries.push({
      call: raw.call,
      path: entry.path,
    });
  }

  return {
    entries,
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

function extractOpenAIChatToolCalls(input: unknown): ExtractToolCallsResult {
  const entries: RawToolCallEntry[] = [];
  let skipped = 0;

  const messages = collectOpenAIChatMessages(input);

  for (const message of messages) {
    const toolCalls = message.value.tool_calls;

    if (!Array.isArray(toolCalls)) {
      continue;
    }

    for (const [index, toolCall] of toolCalls.entries()) {
      const path = [...message.path, "tool_calls", index];

      if (!isRecord(toolCall) || !isRecord(toolCall.function)) {
        skipped += 1;
        continue;
      }

      if (hasOwn(toolCall, "type") && toolCall.type !== "function") {
        skipped += 1;
        continue;
      }

      entries.push({
        call: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
          hasArguments: hasOwn(toolCall.function, "arguments"),
          id: toolCall.id,
          source: "openai-chat",
        },
        path,
      });
    }
  }

  return createExtractionResult(entries, skipped);
}

function collectOpenAIChatMessages(input: unknown): Array<{
  value: Record<string, unknown>;
  path: Array<string | number>;
}> {
  if (Array.isArray(input)) {
    return input.flatMap((item, index) =>
      collectOpenAIChatMessages(item).map((message) => ({
        value: message.value,
        path: [index, ...message.path],
      })),
    );
  }

  if (!isRecord(input)) {
    return [];
  }

  if (Array.isArray(input.choices)) {
    return input.choices.flatMap((choice, index) => {
      if (!isRecord(choice) || !isRecord(choice.message)) {
        return [];
      }

      return [
        {
          value: choice.message,
          path: ["choices", index, "message"],
        },
      ];
    });
  }

  return [
    {
      value: input,
      path: [],
    },
  ];
}

function extractOpenAIResponsesToolCalls(input: unknown): ExtractToolCallsResult {
  const entries: RawToolCallEntry[] = [];
  let skipped = 0;

  const items = collectOpenAIResponseItems(input);

  for (const item of items) {
    if (item.value.type !== "function_call") {
      skipped += 1;
      continue;
    }

    entries.push({
      call: {
        name: item.value.name,
        arguments: item.value.arguments,
        hasArguments: hasOwn(item.value, "arguments"),
        id: item.value.call_id,
        source: "openai-responses",
      },
      path: item.path,
    });
  }

  return createExtractionResult(entries, skipped);
}

function collectOpenAIResponseItems(input: unknown): Array<{
  value: Record<string, unknown>;
  path: Array<string | number>;
}> {
  if (Array.isArray(input)) {
    return input.flatMap((item, index) =>
      collectOpenAIResponseItems(item).map((responseItem) => ({
        value: responseItem.value,
        path: [index, ...responseItem.path],
      })),
    );
  }

  if (!isRecord(input)) {
    return [];
  }

  if (Array.isArray(input.output)) {
    return input.output
      .map((item, index) => ({
        item,
        index,
      }))
      .filter((item): item is { item: Record<string, unknown>; index: number } =>
        isRecord(item.item),
      )
      .map(({ item, index }) => ({
        value: item,
        path: ["output", index],
      }));
  }

  return [
    {
      value: input,
      path: [],
    },
  ];
}

function extractVercelAiSdkToolCalls(input: unknown): ExtractToolCallsResult {
  const entries: RawToolCallEntry[] = [];
  let skipped = 0;

  const nodes = collectVercelAiSdkNodes(input);

  for (const node of nodes) {
    if (Array.isArray(node.value.toolCalls)) {
      for (const [index, toolCall] of node.value.toolCalls.entries()) {
        const path = [...node.path, "toolCalls", index];

        if (!isRecord(toolCall)) {
          skipped += 1;
          continue;
        }

        entries.push({
          call: {
            name: toolCall.toolName,
            arguments: hasOwn(toolCall, "args") ? toolCall.args : toolCall.input,
            hasArguments: hasOwn(toolCall, "args") || hasOwn(toolCall, "input"),
            id: toolCall.toolCallId ?? toolCall.id,
            source: "vercel-ai-sdk",
          },
          path,
        });
      }
    }

    if (Array.isArray(node.value.parts)) {
      for (const [index, part] of node.value.parts.entries()) {
        const path = [...node.path, "parts", index];

        if (!isRecord(part)) {
          skipped += 1;
          continue;
        }

        if (!isVercelToolPart(part)) {
          skipped += 1;
          continue;
        }

        entries.push({
          call: {
            name: part.toolName ?? parseVercelToolNameFromType(part.type),
            arguments: hasOwn(part, "args") ? part.args : part.input,
            hasArguments: hasOwn(part, "args") || hasOwn(part, "input"),
            id: part.toolCallId ?? part.id,
            source: "vercel-ai-sdk",
          },
          path,
        });
      }
    }
  }

  return createExtractionResult(entries, skipped);
}

function collectVercelAiSdkNodes(input: unknown): Array<{
  value: Record<string, unknown>;
  path: Array<string | number>;
}> {
  if (Array.isArray(input)) {
    return input.flatMap((item, index) =>
      collectVercelAiSdkNodes(item).map((node) => ({
        value: node.value,
        path: [index, ...node.path],
      })),
    );
  }

  if (!isRecord(input)) {
    return [];
  }

  return [
    {
      value: input,
      path: [],
    },
  ];
}

function isVercelToolPart(part: Record<string, unknown>): boolean {
  if (typeof part.toolName === "string") {
    return true;
  }

  return typeof part.type === "string" && part.type.startsWith("tool-");
}

function parseVercelToolNameFromType(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("tool-")
    ? value.slice("tool-".length)
    : undefined;
}

function extractLangChainToolCalls(input: unknown): ExtractToolCallsResult {
  const entries: RawToolCallEntry[] = [];
  let skipped = 0;

  const messages = collectLangChainMessages(input);

  for (const message of messages) {
    const toolCalls = message.value.tool_calls;

    if (!Array.isArray(toolCalls)) {
      continue;
    }

    for (const [index, toolCall] of toolCalls.entries()) {
      const path = [...message.path, "tool_calls", index];

      if (!isRecord(toolCall)) {
        skipped += 1;
        continue;
      }

      entries.push({
        call: {
          name: toolCall.name,
          arguments: toolCall.args,
          hasArguments: hasOwn(toolCall, "args"),
          id: toolCall.id,
          source: "langchain",
        },
        path,
      });
    }
  }

  return createExtractionResult(entries, skipped);
}

function collectLangChainMessages(input: unknown): Array<{
  value: Record<string, unknown>;
  path: Array<string | number>;
}> {
  if (Array.isArray(input)) {
    return input.flatMap((item, index) =>
      collectLangChainMessages(item).map((message) => ({
        value: message.value,
        path: [index, ...message.path],
      })),
    );
  }

  if (!isRecord(input)) {
    return [];
  }

  return [
    {
      value: input,
      path: [],
    },
  ];
}

function extractGenericToolCalls(
  input: unknown,
  config: GenericNormalizationConfig | undefined,
): ExtractToolCallsResult {
  if (!config) {
    return {
      entries: [],
      issues: [
        {
          code: "normalize.generic-config-missing",
          message: "Generic normalization requires config.normalization.generic.",
        },
      ],
      skipped: 0,
    };
  }

  const callsPath = parseConfiguredSelector(config.callsPath, "callsPath");
  const namePath = parseConfiguredSelector(config.namePath, "namePath");
  const argumentsPath = parseConfiguredSelector(config.argumentsPath, "argumentsPath");
  const idPath = config.idPath ? parseConfiguredSelector(config.idPath, "idPath") : undefined;

  if (!callsPath.ok || !namePath.ok || !argumentsPath.ok || idPath?.ok === false) {
    const selectorIssues = [
      callsPath.ok ? undefined : callsPath.issue,
      namePath.ok ? undefined : namePath.issue,
      argumentsPath.ok ? undefined : argumentsPath.issue,
      idPath?.ok === false ? idPath.issue : undefined,
    ].filter((issue): issue is ToolCallIssue => issue !== undefined);

    return {
      entries: [],
      issues: selectorIssues,
      skipped: 0,
    };
  }

  const callNodes = selectPathValues(input, callsPath.selector);
  const entries: RawToolCallEntry[] = [];
  const issues: ToolCallIssue[] = [];
  let skipped = 0;

  for (const [index, callNode] of callNodes.entries()) {
    const path = ["callsPath", index];

    if (!isRecord(callNode)) {
      issues.push({
        code: "normalize.input-unsupported",
        message: "Generic normalization call node must be an object.",
        path,
      });
      skipped += 1;
      continue;
    }

    const name = selectSinglePathValue(callNode, namePath.selector, "name", path);
    const args = selectSinglePathValue(callNode, argumentsPath.selector, "arguments", path);
    const id = idPath
      ? selectOptionalSinglePathValue(callNode, idPath.selector, "id", path)
      : { ok: true as const };

    if (!name.ok || !args.ok || !id.ok) {
      if (!name.ok) {
        issues.push(...name.issues);
      }
      if (!args.ok) {
        issues.push(...args.issues);
      }
      if (!id.ok) {
        issues.push(...id.issues);
      }
      skipped += 1;
      continue;
    }

    entries.push({
      call: {
        name: name.value,
        arguments: args.value,
        hasArguments: true,
        id: id.value,
        source: "generic",
      },
      path,
    });
  }

  return createExtractionResult(entries, skipped, issues);
}

function parseConfiguredSelector(
  path: string,
  label: string,
):
  | {
      ok: true;
      selector: ParsedPathSelector;
    }
  | {
      ok: false;
      issue: ToolCallIssue;
    } {
  const parsed = parsePathSelector(path);

  if (!parsed.ok) {
    return {
      ok: false,
      issue: {
        code: "normalize.path-invalid",
        message: `Generic normalization ${label} is invalid: ${parsed.message}`,
      },
    };
  }

  return {
    ok: true,
    selector: parsed.selector,
  };
}

function selectSinglePathValue(
  value: unknown,
  selector: ParsedPathSelector,
  label: string,
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
  const values = selectPathValues(value, selector);

  if (values.length === 0) {
    return {
      ok: false,
      issues: [
        {
          code: `normalize.${label}-missing`,
          message: `Generic normalization did not find ${label}.`,
          path,
        },
      ],
    };
  }

  if (values.length > 1) {
    return {
      ok: false,
      issues: [
        {
          code: "normalize.path-ambiguous",
          message: `Generic normalization ${label} path matched multiple values.`,
          path,
        },
      ],
    };
  }

  return {
    ok: true,
    value: values[0],
  };
}

function selectOptionalSinglePathValue(
  value: unknown,
  selector: ParsedPathSelector,
  label: string,
  path: Array<string | number>,
):
  | {
      ok: true;
      value?: unknown;
    }
  | {
      ok: false;
      issues: ToolCallIssue[];
    } {
  const values = selectPathValues(value, selector);

  if (values.length === 0) {
    return {
      ok: true,
    };
  }

  if (values.length > 1) {
    return {
      ok: false,
      issues: [
        {
          code: "normalize.path-ambiguous",
          message: `Generic normalization ${label} path matched multiple values.`,
          path,
        },
      ],
    };
  }

  return {
    ok: true,
    value: values[0],
  };
}

function createExtractionResult(
  entries: RawToolCallEntry[],
  skipped: number,
  issues: ToolCallIssue[] = [],
): ExtractToolCallsResult {
  if (entries.length === 0 && issues.length === 0) {
    return {
      entries,
      issues: [
        {
          code: "normalize.no-tool-calls",
          message: "Input did not contain any supported tool calls.",
        },
      ],
      skipped,
    };
  }

  return {
    entries,
    issues,
    skipped,
  };
}

function finalizeToolCall(
  raw: RawToolCall,
  path: Array<string | number>,
  options: NormalizeToolCallsRuntimeOptions,
): { ok: true; call: NormalizedToolCall } | { ok: false; issues: ToolCallIssue[] } {
  const issues: ToolCallIssue[] = [];
  const name = normalizeName(raw.name, path);
  const args = normalizeArguments(raw.arguments, raw.hasArguments, path, options);

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
  options: NormalizeToolCallsRuntimeOptions,
):
  | {
      ok: true;
      value: unknown;
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

  if (options.allowNonObjectArguments) {
    return {
      ok: true,
      value: parsed.value,
    };
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
