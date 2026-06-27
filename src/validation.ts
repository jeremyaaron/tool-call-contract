import type * as z from "zod";

import type { ToolContract, ZodSchema } from "./contracts.js";
import { normalizeToolCallCaptures, type NormalizationFormat } from "./normalization.js";

export interface NormalizedToolCall {
  name: string;
  arguments: unknown;
  id?: string;
  source?: ToolCallSource;
}

export type ToolCallSource =
  | "normalized"
  | "openai-chat"
  | "openai-responses"
  | "vercel-ai-sdk"
  | "langchain"
  | "generic"
  | "unknown";

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

interface ValidationNormalizationAttempt {
  format: NormalizationFormat;
  input: unknown;
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
  const attempts = createValidationNormalizationAttempts(input);
  let fallbackIssues: ToolCallIssue[] | undefined;

  for (const attempt of attempts) {
    const normalized = normalizeToolCallCaptures(attempt.input, {
      format: attempt.format,
      includeSource: true,
      allowNonObjectArguments: true,
    });
    const issues = mapNormalizationIssuesForValidation(normalized.issues);

    if (normalized.calls.length > 0) {
      return {
        calls: normalized.calls,
        issues,
      };
    }

    if (!fallbackIssues || hasSpecificValidationIssues(issues)) {
      fallbackIssues = issues;
    }
  }

  return {
    calls: [],
    issues: fallbackIssues ?? [
      {
        code: "call.unsupported-shape",
        message: "Input could not be normalized into a tool call.",
      },
    ],
  };
}

function createValidationNormalizationAttempts(input: unknown): ValidationNormalizationAttempt[] {
  const providerAttempts = createProviderNormalizationAttempts(input);

  return [
    ...providerAttempts,
    {
      format: "normalized",
      input,
    },
    ...createWrapperNormalizationAttempts(input),
    ...createFallbackProviderNormalizationAttempts(providerAttempts, input),
  ];
}

function createProviderNormalizationAttempts(input: unknown): ValidationNormalizationAttempt[] {
  const attempts: ValidationNormalizationAttempt[] = [];

  if (isOpenAIResponsesLike(input)) {
    attempts.push({
      format: "openai-responses",
      input,
    });
  }

  if (isOpenAIChatLike(input)) {
    attempts.push({
      format: "openai-chat",
      input,
    });
  }

  return attempts;
}

function createFallbackProviderNormalizationAttempts(
  providerAttempts: readonly ValidationNormalizationAttempt[],
  input: unknown,
): ValidationNormalizationAttempt[] {
  const attemptedFormats = new Set(providerAttempts.map((attempt) => attempt.format));
  const attempts: ValidationNormalizationAttempt[] = [];

  if (!attemptedFormats.has("openai-responses")) {
    attempts.push({
      format: "openai-responses",
      input,
    });
  }

  if (!attemptedFormats.has("openai-chat")) {
    attempts.push({
      format: "openai-chat",
      input,
    });
  }

  return attempts;
}

function createWrapperNormalizationAttempts(input: unknown): ValidationNormalizationAttempt[] {
  if (!isRecord(input) || !Array.isArray(input.calls)) {
    return [];
  }

  return [
    {
      format: "normalized",
      input: input.calls,
    },
  ];
}

function isOpenAIResponsesLike(input: unknown): boolean {
  if (!isRecord(input)) {
    return false;
  }

  return input.type === "function_call" || Array.isArray(input.output);
}

function isOpenAIChatLike(input: unknown): boolean {
  if (!isRecord(input)) {
    return false;
  }

  return Array.isArray(input.tool_calls) || Array.isArray(input.choices);
}

function mapNormalizationIssuesForValidation(issues: readonly ToolCallIssue[]): ToolCallIssue[] {
  return issues.map((issue) => {
    if (issue.code === "normalize.arguments-missing") {
      return {
        ...issue,
        code: "call.arguments-missing",
        message: "Tool call arguments are missing.",
      };
    }

    if (issue.code === "normalize.arguments-invalid-json") {
      return {
        ...issue,
        code: "call.invalid-json",
        message: "Tool call arguments contain malformed JSON.",
      };
    }

    if (isUnsupportedNormalizationIssue(issue)) {
      return {
        ...issue,
        code: "call.unsupported-shape",
        message: "Input could not be normalized into a supported tool call shape.",
      };
    }

    return issue;
  });
}

function isUnsupportedNormalizationIssue(issue: ToolCallIssue): boolean {
  return (
    issue.code === "normalize.input-unsupported" ||
    issue.code === "normalize.name-missing" ||
    issue.code === "normalize.name-not-string" ||
    issue.code === "normalize.no-tool-calls"
  );
}

function hasSpecificValidationIssues(issues: readonly ToolCallIssue[]): boolean {
  return issues.some((issue) => issue.code !== "call.unsupported-shape");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  return {
    ok: true,
    value,
  };
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
