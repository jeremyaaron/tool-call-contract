import type { ToolContract } from "./contracts.js";
import {
  synthesizeInvalidValue,
  synthesizeValidValue,
  type JsonSynthesisResult,
} from "./json-schema.js";
import type { ContractRegistry } from "./registry.js";
import type { Finding } from "./reporting.js";
import { analyzeContractSchema } from "./schema.js";
import type { NormalizedToolCall } from "./validation.js";

export type FixtureSource = "generated" | "example" | "unavailable";

export interface ToolCallFixtureSet {
  contractName: string;
  source: FixtureSource;
  valid?: NormalizedToolCall;
  invalid?: NormalizedToolCall;
  findings: Finding[];
}

export function generateToolCallFixtures(
  contract: ToolContract,
  examples: readonly unknown[] = contract.examples,
): ToolCallFixtureSet {
  const exampleResult = selectValidExample(contract, examples);
  const analysis = analyzeContractSchema(contract);
  const findings = [...exampleResult.findings];
  const validArguments =
    exampleResult.valid ??
    (analysis.jsonSchema ? synthesizeValidValue(analysis.jsonSchema) : fixtureUnsupported());
  const invalidArguments = analysis.jsonSchema
    ? synthesizeInvalidValue(analysis.jsonSchema)
    : ({
        ok: true,
        value: null,
      } satisfies JsonSynthesisResult);

  if (!validArguments.ok) {
    findings.push(createFixtureUnsupportedFinding(contract, validArguments.reason));
  }

  if (!invalidArguments.ok) {
    findings.push(createFixtureUnsupportedFinding(contract, invalidArguments.reason));
  }

  const valid = validArguments.ok
    ? {
        name: contract.name,
        arguments: formatFixtureArguments(validArguments.value),
        source: "normalized" as const,
      }
    : undefined;
  const invalid = invalidArguments.ok
    ? {
        name: contract.name,
        arguments: formatFixtureArguments(ensureInvalidArguments(contract, invalidArguments.value)),
        source: "normalized" as const,
      }
    : undefined;

  return {
    contractName: contract.name,
    source: valid ? (exampleResult.valid ? "example" : "generated") : "unavailable",
    ...(valid ? { valid } : {}),
    ...(invalid ? { invalid } : {}),
    findings,
  };
}

export function generateRegistryFixtures(registry: ContractRegistry): ToolCallFixtureSet[] {
  return registry.contracts.map((contract) =>
    generateToolCallFixtures(contract, registry.examplesByName.get(contract.name) ?? []),
  );
}

function selectValidExample(
  contract: ToolContract,
  examples: readonly unknown[],
): {
  valid?: JsonSynthesisResult;
  findings: Finding[];
} {
  const findings: Finding[] = [];

  for (const [index, example] of examples.entries()) {
    const result = contract.input.safeParse(example);

    if (result.success) {
      return {
        valid: {
          ok: true,
          value: result.data,
        },
        findings,
      };
    }

    const firstIssue = result.error.issues[0];
    findings.push({
      id: "schema.example-invalid",
      severity: "error",
      title: "Configured example does not match the contract schema",
      message: `Example ${index + 1} for "${contract.name}" is invalid${
        firstIssue ? `: ${firstIssue.message}` : "."
      }`,
      impact: "Generated fixtures seeded from this example would not validate.",
      suggestion: "Update the example so it satisfies the tool input schema.",
      contractName: contract.name,
      path: firstIssue?.path.join("."),
    });
  }

  return {
    findings,
  };
}

function ensureInvalidArguments(contract: ToolContract, value: unknown): unknown {
  if (!contract.input.safeParse(value).success) {
    return value;
  }

  for (const fallback of [null, "__tool_call_contract_invalid__", 123, false]) {
    if (!contract.input.safeParse(fallback).success) {
      return fallback;
    }
  }

  return value;
}

function formatFixtureArguments(value: unknown): unknown {
  return typeof value === "string" ? JSON.stringify(value) : value;
}

function fixtureUnsupported(): JsonSynthesisResult {
  return {
    ok: false,
    reason: "Schema could not be converted to JSON Schema.",
  };
}

function createFixtureUnsupportedFinding(contract: ToolContract, reason: string): Finding {
  return {
    id: "schema.fixture-unsupported",
    severity: "warning",
    title: "Fixture generation is not supported for this schema",
    message: `Tool contract "${contract.name}" cannot synthesize deterministic fixtures: ${reason}`,
    impact: "Generated fixture artifacts cannot be produced for this contract yet.",
    suggestion: "Add a valid explicit example or simplify the input schema shape.",
    contractName: contract.name,
  };
}
