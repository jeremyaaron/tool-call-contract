import type * as z from "zod";

export type ZodSchema = z.ZodType;

export interface DefineToolContractInput<TSchema extends ZodSchema> {
  name: string;
  description: string;
  input: TSchema;
  examples?: readonly unknown[];
}

export interface ToolContract<TSchema extends ZodSchema = ZodSchema> {
  readonly kind: "tool-call-contract";
  readonly name: string;
  readonly description: string;
  readonly input: TSchema;
  readonly examples: readonly unknown[];
}

export interface ToolCallContractConfig {
  contracts: readonly ToolContract[];
  outDir?: string;
  examples?: Record<string, readonly unknown[]>;
  include?: readonly string[];
  exclude?: readonly string[];
}

export function defineToolContract<TSchema extends ZodSchema>(
  input: DefineToolContractInput<TSchema>,
): ToolContract<TSchema> {
  assertPlainObject(input, "Tool contract definition must be an object.");
  assertNonEmptyString(input.name, "Tool contract name must be a non-empty string.");
  assertNonEmptyString(input.description, "Tool contract description must be a non-empty string.");
  assertZodSchema(input.input);

  if (input.examples !== undefined && !Array.isArray(input.examples)) {
    throw new TypeError("Tool contract examples must be an array when provided.");
  }

  return Object.freeze({
    kind: "tool-call-contract",
    name: input.name,
    description: input.description,
    input: input.input,
    examples: Object.freeze([...(input.examples ?? [])]),
  });
}

export function defineConfig(config: ToolCallContractConfig): ToolCallContractConfig {
  assertPlainObject(config, "Tool call contract config must be an object.");
  return config;
}

function assertPlainObject(
  value: unknown,
  message: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(message);
  }
}

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(message);
  }
}

function assertZodSchema(value: unknown): asserts value is ZodSchema {
  if (
    typeof value !== "object" ||
    value === null ||
    !("safeParse" in value) ||
    typeof value.safeParse !== "function"
  ) {
    throw new TypeError("Tool contract input must be a Zod schema.");
  }
}
