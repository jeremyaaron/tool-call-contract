import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ContractRegistry } from "../registry.js";
import type { Finding } from "../reporting.js";
import { validateToolCalls, type ToolCallValidationResult } from "../validation.js";

export interface ValidateCaptureOptions {
  cwd: string;
  files: readonly string[];
  allowUnknown: boolean;
}

export interface ValidateCaptureResult {
  results: ToolCallValidationResult[];
  findings: Finding[];
}

export async function validateCaptureFiles(
  registry: ContractRegistry,
  options: ValidateCaptureOptions,
): Promise<ValidateCaptureResult> {
  const results: ToolCallValidationResult[] = [];
  const findings: Finding[] = [];

  for (const file of options.files) {
    const fileResult = await validateCaptureFile(registry, options.cwd, file, options.allowUnknown);
    results.push(...fileResult.results);
    findings.push(...fileResult.findings);
  }

  return {
    results,
    findings,
  };
}

async function validateCaptureFile(
  registry: ContractRegistry,
  cwd: string,
  file: string,
  allowUnknown: boolean,
): Promise<ValidateCaptureResult> {
  const content = await readCaptureFile(cwd, file);

  if (!content.ok) {
    return {
      results: [content.result],
      findings: [],
    };
  }

  const parsed = parseCaptureJson(content.content, file);

  if (!parsed.ok) {
    return {
      results: [parsed.result],
      findings: [],
    };
  }

  const rawResults = validateToolCalls(registry.contracts, parsed.value).map((result) =>
    withFile(result, file),
  );

  if (!allowUnknown) {
    return {
      results: rawResults,
      findings: [],
    };
  }

  const findings = rawResults.filter(isUnknownToolResult).map(createUnknownToolFinding);
  const results = rawResults.filter((result) => !isUnknownToolResult(result));

  return {
    results,
    findings,
  };
}

async function readCaptureFile(
  cwd: string,
  file: string,
): Promise<{ ok: true; content: string } | { ok: false; result: ToolCallValidationResult }> {
  try {
    return {
      ok: true,
      content: await readFile(path.resolve(cwd, file), "utf8"),
    };
  } catch (error) {
    return {
      ok: false,
      result: {
        ok: false,
        file,
        issues: [
          {
            code: "file.read-failed",
            message: `Could not read capture file: ${formatErrorMessage(error)}`,
          },
        ],
      },
    };
  }
}

function parseCaptureJson(
  content: string,
  file: string,
): { ok: true; value: unknown } | { ok: false; result: ToolCallValidationResult } {
  try {
    return {
      ok: true,
      value: JSON.parse(content),
    };
  } catch (error) {
    return {
      ok: false,
      result: {
        ok: false,
        file,
        issues: [
          {
            code: "file.invalid-json",
            message: `Capture file contains malformed JSON: ${formatErrorMessage(error)}`,
          },
        ],
      },
    };
  }
}

function withFile(result: ToolCallValidationResult, file: string): ToolCallValidationResult {
  return {
    ...result,
    file,
  };
}

function isUnknownToolResult(result: ToolCallValidationResult): boolean {
  return !result.ok && result.issues.some((issue) => issue.code === "call.unknown-tool");
}

function createUnknownToolFinding(result: ToolCallValidationResult): Finding {
  const name = result.call?.name ?? "unknown";

  return {
    id: "call.unknown-tool",
    severity: "warning",
    title: "Captured tool call does not match a configured contract",
    message: `No matching contract found for tool "${name}".`,
    impact: "This captured call was skipped because --allow-unknown is enabled.",
    suggestion: "Add a matching contract or remove --allow-unknown to fail on unknown tools.",
    contractName: name,
    file: result.file,
  };
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown file error.";
}
