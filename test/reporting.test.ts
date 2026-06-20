import { describe, expect, it } from "vitest";

import {
  createCommandReport,
  hasBlockingFailures,
  renderHumanReport,
  renderJsonReport,
  summarizeReport,
  type Finding,
} from "../src/index.js";

const warningFinding: Finding = {
  id: "contract.description-missing",
  severity: "warning",
  title: "Description missing",
  message: "Tool contract has no description.",
  impact: "Generated docs and provider schemas will be less useful.",
  suggestion: "Add a concise tool description.",
  contractName: "search_docs",
};

const errorFinding: Finding = {
  id: "contract.duplicate-name",
  severity: "error",
  title: "Duplicate contract name",
  message: "Two contracts use the same name.",
};

describe("report summaries", () => {
  it("counts severities and validation results", () => {
    expect(
      summarizeReport(
        [warningFinding, errorFinding],
        [
          {
            ok: true,
            contractName: "search_docs",
            value: { query: "docs" },
            call: {
              name: "search_docs",
              arguments: { query: "docs" },
            },
          },
          {
            ok: false,
            issues: [
              {
                code: "call.unsupported-shape",
                message: "Unsupported.",
              },
            ],
          },
        ],
      ),
    ).toEqual({
      errors: 1,
      warnings: 1,
      info: 0,
      validResults: 1,
      invalidResults: 1,
    });
  });

  it("treats warnings as non-blocking by default", () => {
    const report = createCommandReport({
      command: "check",
      findings: [warningFinding],
    });

    expect(report.success).toBe(true);
    expect(hasBlockingFailures(report)).toBe(false);
  });

  it("treats errors as blocking", () => {
    const report = createCommandReport({
      command: "check",
      findings: [errorFinding],
    });

    expect(report.success).toBe(false);
    expect(hasBlockingFailures(report)).toBe(true);
  });
});

describe("reporters", () => {
  it("renders an empty human report", () => {
    expect(renderHumanReport(createCommandReport({ command: "check" }))).toBe(
      "tool-call-contract check\nNo findings.\n",
    );
  });

  it("renders human findings with impact and fix guidance", () => {
    expect(
      renderHumanReport(
        createCommandReport({
          command: "check",
          findings: [warningFinding],
        }),
      ),
    ).toContain("Fix:\n    Add a concise tool description.");
  });

  it("renders validation failures", () => {
    const report = createCommandReport({
      command: "validate",
      results: [
        {
          ok: false,
          contractName: "search_docs",
          issues: [
            {
              code: "schema.invalid-type",
              message: "Expected string.",
              path: ["query"],
            },
          ],
        },
      ],
    });

    expect(renderHumanReport(report)).toContain("schema.invalid-type at query: Expected string.");
  });

  it("renders stable JSON", () => {
    expect(JSON.parse(renderJsonReport(createCommandReport({ command: "generate" })))).toEqual({
      schemaVersion: 1,
      command: "generate",
      success: true,
      summary: {
        errors: 0,
        warnings: 0,
        info: 0,
        validResults: 0,
        invalidResults: 0,
      },
    });
  });
});
