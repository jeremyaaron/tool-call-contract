import { z } from "zod";

import type { ToolContract } from "./contracts.js";
import type { ContractRegistry } from "./registry.js";
import type { Finding } from "./reporting.js";
import { getFixtureCapabilityForJsonSchema, type JsonObject } from "./json-schema.js";

export interface SchemaAnalysis {
  contractName: string;
  jsonSchema?: JsonObject;
  capabilities: {
    validate: true;
    fixture: "supported" | "example-only" | "unsupported";
    openai: "supported" | "unsupported";
    docs: "supported" | "partial" | "unsupported";
  };
  findings: Finding[];
}

export interface OpenAIToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: JsonObject;
  strict: false;
}

export interface OpenAIToolExport {
  contractName: string;
  tool?: OpenAIToolDefinition;
  findings: Finding[];
}

const providerSafeNamePattern = /^[a-zA-Z0-9_-]{1,64}$/;

export function analyzeRegistrySchemas(registry: ContractRegistry): SchemaAnalysis[] {
  return registry.contracts.map((contract) => analyzeContractSchema(contract));
}

export function analyzeContractSchema(contract: ToolContract): SchemaAnalysis {
  const conversion = convertToJsonSchema(contract);

  if (!conversion.ok) {
    return {
      contractName: contract.name,
      capabilities: {
        validate: true,
        fixture: "unsupported",
        openai: "unsupported",
        docs: "unsupported",
      },
      findings: [
        {
          id: "schema.json-schema-unsupported",
          severity: "error",
          title: "Schema cannot be converted to JSON Schema",
          message: `Tool contract "${contract.name}" uses a schema feature that cannot be represented as JSON Schema: ${conversion.message}`,
          impact:
            "Provider export, generated docs, and generated fixtures cannot use this contract yet.",
          suggestion:
            "Use Zod schema features that can be represented by JSON Schema or split this contract into a supported input schema.",
          contractName: contract.name,
        },
      ],
    };
  }

  const rootObjectFinding =
    conversion.schema.type === "object"
      ? undefined
      : {
          id: "schema.root-not-object",
          severity: "error" as const,
          title: "Tool input schema root is not an object",
          message: `Tool contract "${contract.name}" must use an object input schema for OpenAI export.`,
          impact: "OpenAI-compatible tool definitions require object parameters.",
          suggestion: "Wrap the tool input in z.object({ ... }).",
          contractName: contract.name,
        };

  return {
    contractName: contract.name,
    jsonSchema: conversion.schema,
    capabilities: {
      validate: true,
      fixture: getFixtureCapabilityForJsonSchema(conversion.schema),
      openai: rootObjectFinding ? "unsupported" : "supported",
      docs: "partial",
    },
    findings: rootObjectFinding ? [rootObjectFinding] : [],
  };
}

export function exportOpenAITool(contract: ToolContract): OpenAIToolExport {
  const analysis = analyzeContractSchema(contract);
  const findings = [...analysis.findings];

  if (!providerSafeNamePattern.test(contract.name)) {
    findings.push({
      id: "contract.invalid-name",
      severity: "error",
      title: "Contract name is not provider-safe",
      message: `Tool contract "${contract.name}" does not match /^[a-zA-Z0-9_-]{1,64}$/.`,
      impact: "OpenAI tool schemas may reject this name or fail to map calls back to a contract.",
      suggestion: "Use only letters, numbers, underscores, or hyphens, up to 64 characters.",
      contractName: contract.name,
    });
  }

  if (contract.description.trim().length === 0) {
    findings.push({
      id: "contract.description-missing",
      severity: "warning",
      title: "Contract description is missing",
      message: `Tool contract "${contract.name}" has no description.`,
      impact: "The exported OpenAI tool schema will give the model less guidance.",
      suggestion: "Add a concise description that tells the model when to call this tool.",
      contractName: contract.name,
    });
  }

  if (!analysis.jsonSchema || analysis.capabilities.openai === "unsupported") {
    return {
      contractName: contract.name,
      findings,
    };
  }

  return {
    contractName: contract.name,
    tool: {
      type: "function",
      name: contract.name,
      description: contract.description,
      parameters: analysis.jsonSchema,
      strict: false,
    },
    findings,
  };
}

export function exportOpenAITools(registry: ContractRegistry): OpenAIToolExport[] {
  return registry.contracts.map((contract) => exportOpenAITool(contract));
}

function convertToJsonSchema(contract: ToolContract):
  | {
      ok: true;
      schema: JsonObject;
    }
  | {
      ok: false;
      message: string;
    } {
  try {
    const rawSchema = z.toJSONSchema(contract.input, {
      io: "input",
      cycles: "throw",
      reused: "inline",
      unrepresentable: "throw",
    });
    const jsonSchema = JSON.parse(JSON.stringify(rawSchema)) as unknown;

    if (!isJsonObject(jsonSchema)) {
      return {
        ok: false,
        message: "Converted schema was not a JSON object.",
      };
    }

    return {
      ok: true,
      schema: jsonSchema,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unknown conversion error.",
    };
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
