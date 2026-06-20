import type * as z from "zod";

import type { ToolContract, ZodSchema } from "./contracts.js";

export interface NormalizedToolCall {
  name: string;
  arguments: unknown;
  id?: string;
  source?: ToolCallSource;
}

export type ToolCallSource = "normalized" | "openai-chat" | "openai-responses" | "unknown";

export interface ToolCallIssue {
  code: string;
  message: string;
  path?: Array<string | number>;
}

export type ToolCallValidationResult<T = unknown> =
  | {
      ok: true;
      contractName: string;
      value: T;
      call: NormalizedToolCall;
      file?: string;
    }
  | {
      ok: false;
      contractName?: string;
      call?: NormalizedToolCall;
      issues: ToolCallIssue[];
      file?: string;
    };

interface NormalizeResult {
  calls: NormalizedToolCall[];
  issues: ToolCallIssue[];
}

export function validateToolCall<TSchema extends ZodSchema>(
  contract: ToolContract<TSchema>,
  input: unknown,
): ToolCallValidationResult<z.infer<TSchema>> {
  const normalized = normalizeToolCallInput(input);

  if (normalized.issues.length > 0) {
    return {
      ok: false,
      contractName: contract.name,
      issues: normalized.issues,
    };
  }

  if (normalized.calls.length !== 1) {
    return {
      ok: false,
      contractName: contract.name,
      issues: [
        {
          code: "call.multiple-calls",
          message: "Expected exactly one tool call.",
        },
      ],
    };
  }

  const call = normalized.calls[0];
  if (!call) {
    return {
      ok: false,
      contractName: contract.name,
      issues: [
        {
          code: "call.unsupported-shape",
          message: "Input could not be normalized into a tool call.",
        },
      ],
    };
  }

  if (call.name !== contract.name) {
    return {
      ok: false,
      call,
      issues: [
        {
          code: "call.unknown-tool",
          message: `No matching contract found for tool "${call.name}".`,
        },
      ],
    };
  }

  return validateNormalizedCall(contract, call);
}

export function validateToolCalls(
  contracts: readonly ToolContract[],
  input: unknown,
): ToolCallValidationResult[] {
  const normalized = normalizeToolCallInput(input);

  if (normalized.issues.length > 0) {
    return [
      {
        ok: false,
        issues: normalized.issues,
      },
    ];
  }

  const contractsByName = new Map(contracts.map((contract) => [contract.name, contract]));

  return normalized.calls.map((call) => {
    const contract = contractsByName.get(call.name);

    if (!contract) {
      return {
        ok: false,
        call,
        issues: [
          {
            code: "call.unknown-tool",
            message: `No matching contract found for tool "${call.name}".`,
          },
        ],
      };
    }

    return validateNormalizedCall(contract, call);
  });
}

function validateNormalizedCall<TSchema extends ZodSchema>(
  contract: ToolContract<TSchema>,
  call: NormalizedToolCall,
): ToolCallValidationResult<z.infer<TSchema>> {
  const parsedArguments = parseArguments(call.arguments);

  if (!parsedArguments.ok) {
    return {
      ok: false,
      contractName: contract.name,
      call,
      issues: parsedArguments.issues,
    };
  }

  const result = contract.input.safeParse(parsedArguments.value);

  if (!result.success) {
    return {
      ok: false,
      contractName: contract.name,
      call: {
        ...call,
        arguments: parsedArguments.value,
      },
      issues: result.error.issues.map(mapZodIssue),
    };
  }

  return {
    ok: true,
    contractName: contract.name,
    value: result.data as z.infer<TSchema>,
    call: {
      ...call,
      arguments: parsedArguments.value,
    },
  };
}

function normalizeToolCallInput(input: unknown): NormalizeResult {
  const calls: NormalizedToolCall[] = [];
  const issues: ToolCallIssue[] = [];
  collectToolCalls(input, calls, issues);

  if (calls.length === 0 && issues.length === 0) {
    issues.push({
      code: "call.unsupported-shape",
      message: "Input could not be normalized into a tool call.",
    });
  }

  return { calls, issues };
}

function collectToolCalls(
  input: unknown,
  calls: NormalizedToolCall[],
  issues: ToolCallIssue[],
): void {
  if (Array.isArray(input)) {
    for (const item of input) {
      collectToolCalls(item, calls, issues);
    }
    return;
  }

  if (!isRecord(input)) {
    issues.push({
      code: "call.unsupported-shape",
      message: "Tool call input must be an object or an array of objects.",
    });
    return;
  }

  const responseCall = normalizeOpenAIResponseCall(input);
  if (responseCall) {
    calls.push(responseCall);
    return;
  }

  const directCall = normalizeDirectCall(input);
  if (directCall) {
    calls.push(directCall);
    return;
  }

  const chatCalls = normalizeOpenAIChatCalls(input);
  if (chatCalls) {
    calls.push(...chatCalls);
    return;
  }

  if (Array.isArray(input.calls)) {
    collectToolCalls(input.calls, calls, issues);
    return;
  }

  if (Array.isArray(input.output)) {
    collectToolCalls(input.output, calls, issues);
    return;
  }

  const choices = input.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      if (isRecord(choice) && isRecord(choice.message)) {
        collectToolCalls(choice.message, calls, issues);
      }
    }
    return;
  }

  issues.push({
    code: "call.unsupported-shape",
    message: "Input could not be normalized into a supported tool call shape.",
  });
}

function normalizeDirectCall(input: Record<string, unknown>): NormalizedToolCall | null {
  if (typeof input.name === "string") {
    if (!hasOwn(input, "arguments")) {
      return missingArgumentsCall(input.name, input.id, "normalized");
    }

    return {
      name: input.name,
      arguments: input.arguments,
      id: optionalString(input.id),
      source: "normalized",
    };
  }

  if (typeof input.toolName === "string") {
    if (!hasOwn(input, "args")) {
      return missingArgumentsCall(input.toolName, input.id, "normalized");
    }

    return {
      name: input.toolName,
      arguments: input.args,
      id: optionalString(input.id),
      source: "normalized",
    };
  }

  return null;
}

function normalizeOpenAIChatCalls(input: Record<string, unknown>): NormalizedToolCall[] | null {
  if (!Array.isArray(input.tool_calls)) {
    return null;
  }

  const calls: NormalizedToolCall[] = [];

  for (const rawCall of input.tool_calls) {
    if (!isRecord(rawCall) || !isRecord(rawCall.function)) {
      continue;
    }

    if (typeof rawCall.function.name !== "string") {
      continue;
    }

    calls.push({
      name: rawCall.function.name,
      arguments: rawCall.function.arguments,
      id: optionalString(rawCall.id),
      source: "openai-chat",
    });
  }

  return calls;
}

function normalizeOpenAIResponseCall(input: Record<string, unknown>): NormalizedToolCall | null {
  if (input.type !== "function_call" || typeof input.name !== "string") {
    return null;
  }

  if (!hasOwn(input, "arguments")) {
    return missingArgumentsCall(input.name, input.call_id, "openai-responses");
  }

  return {
    name: input.name,
    arguments: input.arguments,
    id: optionalString(input.call_id),
    source: "openai-responses",
  };
}

function missingArgumentsCall(
  name: string,
  id: unknown,
  source: ToolCallSource,
): NormalizedToolCall {
  return {
    name,
    arguments: undefined,
    id: optionalString(id),
    source,
  };
}

function parseArguments(value: unknown):
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
      issues: ToolCallIssue[];
    } {
  if (value === undefined) {
    return {
      ok: false,
      issues: [
        {
          code: "call.arguments-missing",
          message: "Tool call arguments are missing.",
        },
      ],
    };
  }

  if (typeof value !== "string") {
    return {
      ok: true,
      value,
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(value),
    };
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "call.invalid-json",
          message: "Tool call arguments contain malformed JSON.",
        },
      ],
    };
  }
}

function mapZodIssue(issue: z.core.$ZodIssue): ToolCallIssue {
  return {
    code: mapZodIssueCode(issue),
    message: issue.message,
    path: issue.path.filter((part) => typeof part === "string" || typeof part === "number"),
  };
}

function mapZodIssueCode(issue: z.core.$ZodIssue): string {
  if (issue.code === "invalid_type") {
    const path = issue.path.join(".");
    if (path.length > 0 && issue.message.toLowerCase().includes("undefined")) {
      return "schema.required-field-missing";
    }

    return "schema.invalid-type";
  }

  if (issue.code === "invalid_value") {
    return "schema.invalid-enum-value";
  }

  return `schema.${issue.code.replaceAll("_", "-")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
