import { describe, expect, it } from "vitest";

import {
  createCommandReport,
  createValidationReportMetadata,
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

describe("validation report metadata", () => {
  it("groups validation results by suites, files, and contracts", () => {
    const metadata = createValidationReportMetadata({
      suites: ["regression", "smoke", "regression"],
      files: [
        {
          path: "captures/regression/create.json",
          suiteNames: ["regression"],
        },
        {
          path: "captures/smoke/search.json",
          suiteNames: ["smoke", "regression"],
        },
      ],
      results: [
        {
          ok: true,
          contractName: "search_docs",
          file: "captures/smoke/search.json",
          value: { query: "docs" },
          call: {
            name: "search_docs",
            arguments: { query: "docs" },
          },
        },
        {
          ok: false,
          contractName: "create_issue",
          file: "captures/regression/create.json",
          issues: [
            {
              code: "schema.required-field-missing",
              message: "Missing title.",
              path: ["title"],
            },
          ],
        },
        {
          ok: false,
          file: "captures/regression/create.json",
          call: {
            name: "send_email",
            arguments: {},
          },
          issues: [
            {
              code: "call.unknown-tool",
              message: "Unknown tool.",
            },
          ],
        },
      ],
    });

    expect(metadata).toEqual({
      suites: [
        {
          name: "regression",
          files: ["captures/regression/create.json", "captures/smoke/search.json"],
          validResults: 1,
          invalidResults: 2,
        },
        {
          name: "smoke",
          files: ["captures/smoke/search.json"],
          validResults: 1,
          invalidResults: 0,
        },
      ],
      files: [
        {
          path: "captures/regression/create.json",
          suiteNames: ["regression"],
          validResults: 0,
          invalidResults: 2,
        },
        {
          path: "captures/smoke/search.json",
          suiteNames: ["smoke", "regression"],
          validResults: 1,
          invalidResults: 0,
        },
      ],
      contracts: [
        {
          name: "create_issue",
          validResults: 0,
          invalidResults: 1,
          unknownResults: 0,
        },
        {
          name: "search_docs",
          validResults: 1,
          invalidResults: 0,
          unknownResults: 0,
        },
        {
          name: "send_email",
          validResults: 0,
          invalidResults: 1,
          unknownResults: 1,
        },
      ],
    });
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

  it("renders validation suite and file summaries", () => {
    const report = createCommandReport({
      command: "validate",
      validation: {
        suites: [
          {
            name: "regression",
            files: ["captures/regression/search.json"],
            validResults: 1,
            invalidResults: 0,
          },
        ],
        files: [
          {
            path: "captures/regression/search.json",
            suiteNames: ["regression"],
            validResults: 1,
            invalidResults: 0,
          },
        ],
        contracts: [
          {
            name: "search_docs",
            validResults: 1,
            invalidResults: 0,
            unknownResults: 0,
          },
        ],
      },
      results: [
        {
          ok: true,
          contractName: "search_docs",
          file: "captures/regression/search.json",
          value: { query: "docs" },
          call: {
            name: "search_docs",
            arguments: { query: "docs" },
          },
        },
      ],
    });

    expect(renderHumanReport(report)).toContain(
      [
        "Validation suites:",
        "  regression: 1 file(s), 1 valid, 0 invalid",
        "",
        "Validation files:",
        "  captures/regression/search.json: regression, 1 valid, 0 invalid",
      ].join("\n"),
    );
  });

  it("renders redaction summaries", () => {
    const report = createCommandReport({
      command: "redact",
      redaction: {
        checked: false,
        dryRun: false,
        files: [
          {
            path: "captures/raw.json",
            destination: "captures/safe/raw.json",
            changed: true,
            replacements: 2,
          },
          {
            path: "captures/safe.json",
            changed: false,
            replacements: 0,
          },
        ],
      },
    });

    expect(renderHumanReport(report)).toContain(
      [
        "Redaction: 1 changed, 1 unchanged.",
        "  changed captures/raw.json -> captures/safe/raw.json: 2 replacement(s)",
        "  unchanged captures/safe.json: 0 replacement(s)",
      ].join("\n"),
    );
  });

  it("renders generated test summaries", () => {
    const report = createCommandReport({
      command: "generate-tests",
      generatedTests: {
        outFile: "test/tool-call-contract.generated.test.ts",
        dryRun: false,
        captureFiles: ["captures/regression/create.json", "captures/smoke/search.json"],
        created: true,
        updated: false,
        unchanged: false,
      },
    });

    expect(renderHumanReport(report)).toContain(
      [
        "Generated test: test/tool-call-contract.generated.test.ts created.",
        "  Captures: 2 file(s)",
      ].join("\n"),
    );
  });

  it("renders normalization summaries", () => {
    const report = createCommandReport({
      command: "normalize",
      normalization: {
        format: "openai-responses",
        includeSource: true,
        dryRun: true,
        checked: false,
        files: [
          {
            inputPath: "captures/raw/openai.json",
            outputPath: "captures/regression/openai.json",
            callsFound: 2,
            callsWritten: 2,
            skipped: 1,
            changed: true,
          },
          {
            inputPath: "captures/raw/current.json",
            outputPath: "captures/regression/current.json",
            callsFound: 1,
            callsWritten: 1,
            skipped: 0,
            changed: false,
          },
        ],
      },
    });

    expect(renderHumanReport(report)).toContain(
      [
        "Normalization dry run: openai-responses, 1 changed, 1 unchanged.",
        "  changed captures/raw/openai.json -> captures/regression/openai.json",
        "    calls found: 2, written: 2, skipped: 1",
        "  unchanged captures/raw/current.json -> captures/regression/current.json",
        "    calls found: 1, written: 1, skipped: 0",
      ].join("\n"),
    );
  });

  it("renders normalization metadata in stable JSON", () => {
    expect(
      JSON.parse(
        renderJsonReport(
          createCommandReport({
            command: "normalize",
            normalization: {
              format: "langchain",
              includeSource: false,
              dryRun: false,
              checked: true,
              files: [
                {
                  inputPath: "captures/raw/langchain.json",
                  outputPath: "captures/regression/langchain.json",
                  callsFound: 1,
                  callsWritten: 1,
                  skipped: 0,
                  changed: false,
                },
              ],
            },
          }),
        ),
      ),
    ).toEqual({
      schemaVersion: 1,
      command: "normalize",
      success: true,
      summary: {
        errors: 0,
        warnings: 0,
        info: 0,
        validResults: 0,
        invalidResults: 0,
      },
      normalization: {
        format: "langchain",
        includeSource: false,
        dryRun: false,
        checked: true,
        files: [
          {
            inputPath: "captures/raw/langchain.json",
            outputPath: "captures/regression/langchain.json",
            callsFound: 1,
            callsWritten: 1,
            skipped: 0,
            changed: false,
          },
        ],
      },
    });
  });

  it("renders init metadata in stable JSON", () => {
    expect(
      JSON.parse(
        renderJsonReport(
          createCommandReport({
            command: "init",
            init: {
              dryRun: true,
              force: false,
              files: [
                {
                  path: "tool-call-contract.config.ts",
                  action: "created",
                },
                {
                  path: "captures/raw/openai-responses.json",
                  action: "skipped",
                  reason: "file already exists",
                },
              ],
              packageScripts: [
                {
                  name: "tool-contracts:check",
                  action: "created",
                },
              ],
            },
          }),
        ),
      ),
    ).toEqual({
      schemaVersion: 1,
      command: "init",
      success: true,
      summary: {
        errors: 0,
        warnings: 0,
        info: 0,
        validResults: 0,
        invalidResults: 0,
      },
      init: {
        dryRun: true,
        force: false,
        files: [
          {
            path: "tool-call-contract.config.ts",
            action: "created",
          },
          {
            path: "captures/raw/openai-responses.json",
            action: "skipped",
            reason: "file already exists",
          },
        ],
        packageScripts: [
          {
            name: "tool-contracts:check",
            action: "created",
          },
        ],
      },
    });
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
