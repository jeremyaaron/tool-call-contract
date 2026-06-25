import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { version } from "../src/index.js";
import { parseCliArgs, runCli, runCliCommand } from "../src/cli/app.js";

describe("package scaffold", () => {
  it("exports the package version", () => {
    expect(version).toBe("0.1.1");
  });
});

describe("parseCliArgs", () => {
  it("parses check options", () => {
    expect(
      parseCliArgs([
        "check",
        "--cwd",
        "fixture",
        "--config",
        "tool-call-contract.config.ts",
        "--json",
        "--strict",
        "--ignore",
        "contract.description-missing",
        "schema.fixture-unsupported",
      ]),
    ).toMatchObject({
      command: "check",
      options: {
        cwd: "fixture",
        config: "tool-call-contract.config.ts",
        json: true,
        strict: true,
        ignore: ["contract.description-missing", "schema.fixture-unsupported"],
      },
      files: [],
    });
  });

  it("parses generate options", () => {
    expect(
      parseCliArgs(["generate", "--dry-run", "--clean", "--out-dir", "artifacts"]),
    ).toMatchObject({
      command: "generate",
      options: {
        dryRun: true,
        clean: true,
        outDir: "artifacts",
      },
    });
  });

  it("parses validate files and options", () => {
    expect(
      parseCliArgs([
        "validate",
        "--allow-unknown",
        "--suite",
        "smoke",
        "--suite",
        "regression",
        "one.json",
        "two.json",
      ]),
    ).toMatchObject({
      command: "validate",
      options: {
        allowUnknown: true,
        suites: ["smoke", "regression"],
      },
      files: ["one.json", "two.json"],
    });
  });

  it("parses redact files and options", () => {
    expect(
      parseCliArgs([
        "redact",
        "--check",
        "--dry-run",
        "--suite",
        "regression",
        "captures/raw.json",
      ]),
    ).toMatchObject({
      command: "redact",
      options: {
        check: true,
        dryRun: true,
        suites: ["regression"],
      },
      files: ["captures/raw.json"],
    });
  });

  it("rejects unknown commands", () => {
    expect(parseCliArgs(["nope"])).toEqual({
      message: 'Unknown command "nope". Run tool-call-contract --help for usage.',
    });
  });

  it("rejects missing option values", () => {
    expect(parseCliArgs(["check", "--config"])).toEqual({
      message: "--config requires a value.",
    });
  });

  it("rejects validate without files", () => {
    expect(parseCliArgs(["validate"])).toEqual({
      message: "validate requires at least one file or --suite.",
    });
  });

  it("rejects redact without files or suites", () => {
    expect(parseCliArgs(["redact"])).toEqual({
      message: "redact requires at least one file or --suite.",
    });
  });

  it("rejects invalid redact output options", () => {
    expect(parseCliArgs(["redact", "raw.json", "--out", "safe.json", "--out-dir", "safe"])).toEqual(
      {
        message: "--out and --out-dir cannot be used together.",
      },
    );
    expect(parseCliArgs(["redact", "raw.json", "--check", "--out", "safe.json"])).toEqual({
      message: "--check cannot be used with --out or --out-dir.",
    });
    expect(parseCliArgs(["redact", "--suite", "regression", "--out", "safe.json"])).toEqual({
      message: "--out requires exactly one direct file.",
    });
  });
});

describe("runCliCommand", () => {
  it("returns help output", async () => {
    const result = await runCliCommand(["--help"]);

    expect(result).toMatchObject({
      kind: "output",
      exitCode: 0,
    });
    if (result.kind === "output") {
      expect(result.text).toContain("tool-call-contract <command>");
    }
  });

  it("returns version output", async () => {
    await expect(runCliCommand(["--version"])).resolves.toEqual({
      kind: "output",
      exitCode: 0,
      text: "0.1.1\n",
    });
  });

  it("runs check after loading config", async () => {
    const project = await createConfigProject();

    await expect(runCliCommand(["check", "--cwd", project])).resolves.toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        command: "check",
        success: true,
      },
    });
  });

  it("returns exit code 2 for config loading failures", async () => {
    await expect(runCliCommand(["check", "--cwd", tmpdir()])).resolves.toMatchObject({
      kind: "success",
      exitCode: 2,
      report: {
        findings: [
          {
            id: "config.not-found",
          },
        ],
      },
    });
  });

  it("returns exit code 1 for check findings", async () => {
    const project = await createConfigProject({ invalidName: true });

    await expect(runCliCommand(["check", "--cwd", project])).resolves.toMatchObject({
      kind: "success",
      exitCode: 1,
      report: {
        findings: [
          {
            id: "contract.invalid-name",
          },
        ],
      },
    });
  });

  it("suppresses ignored findings", async () => {
    const project = await createConfigProject({ invalidName: true });

    await expect(
      runCliCommand(["check", "--cwd", project, "--ignore", "contract.invalid-name"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        success: true,
      },
    });
  });

  it("upgrades warnings in strict mode", async () => {
    const project = await createConfigProject({ missingDescription: true });

    await expect(runCliCommand(["check", "--cwd", project, "--strict"])).resolves.toMatchObject({
      kind: "success",
      exitCode: 1,
      report: {
        findings: [
          {
            id: "contract.description-missing",
            severity: "error",
          },
        ],
      },
    });
  });

  it("reports schema analysis findings during check", async () => {
    const project = await createConfigProject({ rootStringSchema: true });

    await expect(runCliCommand(["check", "--cwd", project])).resolves.toMatchObject({
      kind: "success",
      exitCode: 1,
      report: {
        findings: [
          {
            id: "schema.root-not-object",
          },
        ],
      },
    });
  });

  it("writes generated artifacts", async () => {
    const project = await createConfigProject();
    const result = await runCliCommand(["generate", "--cwd", project]);

    expect(result).toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        artifacts: {
          created: [
            ".tool-call-contract/fixtures/search_docs.valid.json",
            ".tool-call-contract/fixtures/search_docs.invalid.json",
            ".tool-call-contract/schemas/search_docs.openai.json",
            ".tool-call-contract/docs/search_docs.md",
            ".tool-call-contract/manifest.json",
          ],
          updated: [],
          unchanged: [],
          deleted: [],
        },
      },
    });
    await expect(
      readFile(path.join(project, ".tool-call-contract/docs/search_docs.md"), "utf8"),
    ).resolves.toContain("# search_docs");
    await expect(
      readFile(path.join(project, ".tool-call-contract/manifest.json"), "utf8"),
    ).resolves.toContain('"schemaVersion": 1');
  });

  it("reports unchanged artifacts on a second generate run", async () => {
    const project = await createConfigProject();

    await runCliCommand(["generate", "--cwd", project]);
    await expect(runCliCommand(["generate", "--cwd", project])).resolves.toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        artifacts: {
          created: [],
          updated: [],
          unchanged: [
            ".tool-call-contract/fixtures/search_docs.valid.json",
            ".tool-call-contract/fixtures/search_docs.invalid.json",
            ".tool-call-contract/schemas/search_docs.openai.json",
            ".tool-call-contract/docs/search_docs.md",
            ".tool-call-contract/manifest.json",
          ],
          deleted: [],
        },
      },
    });
  });

  it("reports dry-run changes without writing", async () => {
    const project = await createConfigProject();

    await expect(runCliCommand(["generate", "--cwd", project, "--dry-run"])).resolves.toMatchObject(
      {
        kind: "success",
        exitCode: 0,
        report: {
          artifacts: {
            created: [
              ".tool-call-contract/fixtures/search_docs.valid.json",
              ".tool-call-contract/fixtures/search_docs.invalid.json",
              ".tool-call-contract/schemas/search_docs.openai.json",
              ".tool-call-contract/docs/search_docs.md",
              ".tool-call-contract/manifest.json",
            ],
          },
        },
      },
    );
    await expect(fileExists(path.join(project, ".tool-call-contract/manifest.json"))).resolves.toBe(
      false,
    );
  });

  it("writes to the overridden output directory", async () => {
    const project = await createConfigProject();

    await expect(
      runCliCommand(["generate", "--cwd", project, "--out-dir", "artifacts/contracts"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        artifacts: {
          created: [
            "artifacts/contracts/fixtures/search_docs.valid.json",
            "artifacts/contracts/fixtures/search_docs.invalid.json",
            "artifacts/contracts/schemas/search_docs.openai.json",
            "artifacts/contracts/docs/search_docs.md",
            "artifacts/contracts/manifest.json",
          ],
        },
      },
    });
    await expect(fileExists(path.join(project, "artifacts/contracts/manifest.json"))).resolves.toBe(
      true,
    );
    await expect(fileExists(path.join(project, ".tool-call-contract/manifest.json"))).resolves.toBe(
      false,
    );
  });

  it("reports artifact write failures", async () => {
    const project = await createConfigProject();
    await writeFile(path.join(project, ".tool-call-contract"), "not a directory");

    const result = await runCliCommand(["generate", "--cwd", project]);

    expect(result).toMatchObject({
      kind: "success",
      exitCode: 1,
    });
    expect(result.kind === "success" ? result.report.findings : undefined).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "artifact.write-failed",
          severity: "error",
        }),
      ]),
    );
  });

  it("reports stale generated artifacts during check", async () => {
    const project = await createConfigProject();
    await runCliCommand(["generate", "--cwd", project]);
    await writeFile(path.join(project, ".tool-call-contract/docs/search_docs.md"), "stale\n");

    const result = await runCliCommand(["check", "--cwd", project]);

    expect(result).toMatchObject({
      kind: "success",
      exitCode: 1,
    });
    expect(result.kind === "success" ? result.report.findings : undefined).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "artifact.stale",
          file: ".tool-call-contract/docs/search_docs.md",
        }),
      ]),
    );
  });

  it("reports missing generated artifacts during check", async () => {
    const project = await createConfigProject();
    await runCliCommand(["generate", "--cwd", project]);
    await rm(path.join(project, ".tool-call-contract/fixtures/search_docs.valid.json"));

    const result = await runCliCommand(["check", "--cwd", project]);

    expect(result).toMatchObject({
      kind: "success",
      exitCode: 1,
    });
    expect(result.kind === "success" ? result.report.findings : undefined).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "artifact.stale",
          file: ".tool-call-contract/fixtures/search_docs.valid.json",
        }),
      ]),
    );
  });

  it("reports changed contract output during check", async () => {
    const project = await createConfigProject();
    await runCliCommand(["generate", "--cwd", project]);
    await writeProjectConfig(project, {
      description: "Search product documentation.",
    });

    const result = await runCliCommand(["check", "--cwd", project]);

    expect(result).toMatchObject({
      kind: "success",
      exitCode: 1,
    });
    expect(result.kind === "success" ? result.report.findings : undefined).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "artifact.stale",
          file: ".tool-call-contract/schemas/search_docs.openai.json",
        }),
        expect.objectContaining({
          id: "artifact.stale",
          file: ".tool-call-contract/docs/search_docs.md",
        }),
      ]),
    );
  });

  it("cleans stale manifest-owned files", async () => {
    const project = await createConfigProject({ extraContract: true });
    await runCliCommand(["generate", "--cwd", project]);
    await writeProjectConfig(project);

    const result = await runCliCommand(["generate", "--cwd", project, "--clean"]);

    expect(result).toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        artifacts: {
          deleted: [
            ".tool-call-contract/fixtures/create_issue.valid.json",
            ".tool-call-contract/fixtures/create_issue.invalid.json",
            ".tool-call-contract/schemas/create_issue.openai.json",
            ".tool-call-contract/docs/create_issue.md",
          ],
        },
      },
    });
    await expect(
      fileExists(path.join(project, ".tool-call-contract/docs/create_issue.md")),
    ).resolves.toBe(false);
    await expect(
      fileExists(path.join(project, ".tool-call-contract/docs/search_docs.md")),
    ).resolves.toBe(true);
  });

  it("refuses to clean unsafe manifest paths", async () => {
    const project = await createConfigProject();
    const outsideFile = path.join(project, "..", "tool-call-contract-outside.txt");
    await runCliCommand(["generate", "--cwd", project]);
    await writeFile(outsideFile, "do not delete");
    await writeFile(
      path.join(project, ".tool-call-contract/manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          generator: {
            name: "tool-call-contract",
            version: "0.1.1",
          },
          generatedAt: null,
          contracts: [],
          files: [
            {
              path: "../tool-call-contract-outside.txt",
              kind: "doc",
              hash: "unsafe",
            },
          ],
        },
        null,
        2,
      ),
    );

    const result = await runCliCommand(["generate", "--cwd", project, "--clean"]);

    expect(result).toMatchObject({
      kind: "success",
      exitCode: 1,
    });
    expect(result.kind === "success" ? result.report.findings : undefined).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "artifact.path-outside-out-dir",
          file: "../tool-call-contract-outside.txt",
        }),
      ]),
    );
    await expect(readFile(outsideFile, "utf8")).resolves.toBe("do not delete");
    await rm(outsideFile);
  });

  it("validates captured tool calls", async () => {
    const project = await createConfigProject();
    await writeJson(path.join(project, "valid.json"), {
      name: "search_docs",
      arguments: {
        query: "fixtures",
      },
    });

    await expect(
      runCliCommand(["validate", "--cwd", project, "valid.json"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        results: [
          {
            ok: true,
            contractName: "search_docs",
            file: "valid.json",
            value: {
              query: "fixtures",
            },
          },
        ],
      },
    });
  });

  it("reports invalid captured tool calls", async () => {
    const project = await createConfigProject();
    await writeJson(path.join(project, "invalid.json"), {
      name: "search_docs",
      arguments: {
        limit: 3,
      },
    });

    const result = await runCliCommand(["validate", "--cwd", project, "invalid.json"]);

    expect(result).toMatchObject({
      kind: "success",
      exitCode: 1,
      report: {
        results: [
          {
            ok: false,
            contractName: "search_docs",
            file: "invalid.json",
            issues: [
              {
                code: "schema.required-field-missing",
                path: ["query"],
              },
            ],
          },
        ],
      },
    });
  });

  it("reports malformed capture files", async () => {
    const project = await createConfigProject();
    await writeFile(path.join(project, "malformed.json"), "{ nope");

    await expect(
      runCliCommand(["validate", "--cwd", project, "malformed.json"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 1,
      report: {
        results: [
          {
            ok: false,
            file: "malformed.json",
            issues: [
              {
                code: "file.invalid-json",
              },
            ],
          },
        ],
      },
    });
  });

  it("validates multiple capture files in argument order", async () => {
    const project = await createConfigProject();
    await writeJson(path.join(project, "one.json"), {
      calls: [
        {
          toolName: "search_docs",
          args: {
            query: "schema",
          },
        },
      ],
    });
    await writeJson(path.join(project, "two.json"), [
      {
        name: "search_docs",
        arguments: {
          query: "exports",
        },
      },
    ]);

    const result = await runCliCommand(["validate", "--cwd", project, "two.json", "one.json"]);

    expect(result).toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        summary: {
          validResults: 2,
          invalidResults: 0,
        },
        results: [
          {
            ok: true,
            file: "two.json",
          },
          {
            ok: true,
            file: "one.json",
          },
        ],
      },
    });
  });

  it("reports unknown captured tools", async () => {
    const project = await createConfigProject();
    await writeJson(path.join(project, "unknown.json"), {
      name: "create_issue",
      arguments: {
        title: "Bug",
      },
    });

    await expect(
      runCliCommand(["validate", "--cwd", project, "unknown.json"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 1,
      report: {
        results: [
          {
            ok: false,
            file: "unknown.json",
            call: {
              name: "create_issue",
            },
            issues: [
              {
                code: "call.unknown-tool",
              },
            ],
          },
        ],
      },
    });
  });

  it("allows unknown captured tools when requested", async () => {
    const project = await createConfigProject();
    await writeJson(path.join(project, "unknown.json"), {
      name: "create_issue",
      arguments: {
        title: "Bug",
      },
    });

    await expect(
      runCliCommand(["validate", "--cwd", project, "--allow-unknown", "unknown.json"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        findings: [
          {
            id: "call.unknown-tool",
            severity: "warning",
            file: "unknown.json",
          },
        ],
        summary: {
          warnings: 1,
          invalidResults: 0,
        },
      },
    });
  });

  it("reports unsupported capture shapes", async () => {
    const project = await createConfigProject();
    await writeJson(path.join(project, "unsupported.json"), {
      message: "not a tool call",
    });

    await expect(
      runCliCommand(["validate", "--cwd", project, "unsupported.json"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 1,
      report: {
        results: [
          {
            ok: false,
            file: "unsupported.json",
            issues: [
              {
                code: "call.unsupported-shape",
              },
            ],
          },
        ],
      },
    });
  });

  it("validates OpenAI-style captures", async () => {
    const project = await createConfigProject();
    await writeJson(path.join(project, "openai-chat.json"), {
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: "call_123",
                function: {
                  name: "search_docs",
                  arguments: JSON.stringify({
                    query: "chat completions",
                  }),
                },
              },
            ],
          },
        },
      ],
    });
    await writeJson(path.join(project, "openai-responses.json"), {
      output: [
        {
          type: "function_call",
          call_id: "call_456",
          name: "search_docs",
          arguments: JSON.stringify({
            query: "responses",
          }),
        },
      ],
    });

    const result = await runCliCommand([
      "validate",
      "--cwd",
      project,
      "openai-chat.json",
      "openai-responses.json",
    ]);

    expect(result).toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        results: [
          {
            ok: true,
            file: "openai-chat.json",
            call: {
              id: "call_123",
              source: "openai-chat",
            },
          },
          {
            ok: true,
            file: "openai-responses.json",
            call: {
              id: "call_456",
              source: "openai-responses",
            },
          },
        ],
      },
    });
  });

  it("validates captures from a configured suite", async () => {
    const project = await createConfigProject({
      captures: {
        smoke: ["captures/smoke/*.json"],
      },
    });
    await writeJson(path.join(project, "captures/smoke/search.json"), {
      name: "search_docs",
      arguments: {
        query: "suite",
      },
    });

    await expect(
      runCliCommand(["validate", "--cwd", project, "--suite", "smoke"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        summary: {
          validResults: 1,
          invalidResults: 0,
        },
        validation: {
          suites: [
            {
              name: "smoke",
              files: ["captures/smoke/search.json"],
              validResults: 1,
              invalidResults: 0,
            },
          ],
          files: [
            {
              path: "captures/smoke/search.json",
              suiteNames: ["smoke"],
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
            file: "captures/smoke/search.json",
          },
        ],
      },
    });
  });

  it("validates repeated suites once per resolved file", async () => {
    const project = await createConfigProject({
      captures: {
        all: ["captures/**/*.json"],
        regression: ["captures/regression/*.json"],
      },
    });
    await writeJson(path.join(project, "captures/regression/search.json"), {
      name: "search_docs",
      arguments: {
        query: "dedupe",
      },
    });

    await expect(
      runCliCommand([
        "validate",
        "--cwd",
        project,
        "--suite",
        "all",
        "--suite",
        "regression",
        "--suite",
        "all",
        "captures/regression/search.json",
      ]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        summary: {
          validResults: 1,
          invalidResults: 0,
        },
      },
    });
  });

  it("validates configured suites and direct files together", async () => {
    const project = await createConfigProject({
      captures: {
        smoke: ["captures/smoke/*.json"],
      },
    });
    await writeJson(path.join(project, "captures/smoke/search.json"), {
      name: "search_docs",
      arguments: {
        query: "suite",
      },
    });
    await writeJson(path.join(project, "manual.json"), {
      name: "search_docs",
      arguments: {
        query: "manual",
      },
    });

    await expect(
      runCliCommand(["validate", "--cwd", project, "--suite", "smoke", "manual.json"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        summary: {
          validResults: 2,
          invalidResults: 0,
        },
      },
    });
  });

  it("reports unknown capture suites during validation", async () => {
    const project = await createConfigProject({
      captures: {
        smoke: ["captures/smoke/*.json"],
      },
    });

    await expect(
      runCliCommand(["validate", "--cwd", project, "--suite", "regression"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 1,
      report: {
        findings: [
          {
            id: "capture.suite-unknown",
            severity: "error",
          },
        ],
      },
    });
  });

  it("reports empty capture suites during validation", async () => {
    const project = await createConfigProject({
      captures: {
        regression: ["captures/regression/*.json"],
      },
    });

    await expect(
      runCliCommand(["validate", "--cwd", project, "--suite", "regression"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 1,
      report: {
        findings: [
          {
            id: "capture.suite-empty",
            severity: "error",
          },
        ],
      },
    });
  });

  it("reports missing redaction config", async () => {
    const project = await createConfigProject();
    await writeJson(path.join(project, "raw.json"), {
      arguments: {
        email: "user@example.com",
      },
    });

    await expect(runCliCommand(["redact", "--cwd", project, "raw.json"])).resolves.toMatchObject({
      kind: "success",
      exitCode: 1,
      report: {
        findings: [
          {
            id: "redaction.config-missing",
            severity: "error",
          },
        ],
        redaction: {
          files: [
            {
              path: "raw.json",
              changed: false,
              replacements: 0,
            },
          ],
        },
      },
    });
  });

  it("redacts capture files in place", async () => {
    const project = await createConfigProject({
      redaction: {
        paths: ["arguments.email"],
      },
    });
    await writeJson(path.join(project, "raw.json"), {
      name: "create_issue",
      arguments: {
        email: "user@example.com",
        title: "Bug",
      },
    });

    await expect(runCliCommand(["redact", "--cwd", project, "raw.json"])).resolves.toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        redaction: {
          checked: false,
          dryRun: false,
          files: [
            {
              path: "raw.json",
              destination: "raw.json",
              changed: true,
              replacements: 1,
            },
          ],
        },
      },
    });
    await expect(readFile(path.join(project, "raw.json"), "utf8")).resolves.toContain(
      '"email": "[REDACTED]"',
    );
  });

  it("checks already-redacted capture files without writing", async () => {
    const project = await createConfigProject({
      redaction: {
        paths: ["arguments.email"],
      },
    });
    const safeContent = ["{", '  "arguments": {', '    "email": "[REDACTED]"', "  }", "}", ""].join(
      "\n",
    );
    await writeFile(path.join(project, "safe.json"), safeContent);

    await expect(
      runCliCommand(["redact", "--cwd", project, "--check", "safe.json"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        redaction: {
          checked: true,
          files: [
            {
              path: "safe.json",
              changed: false,
              replacements: 0,
            },
          ],
        },
      },
    });
    await expect(readFile(path.join(project, "safe.json"), "utf8")).resolves.toBe(safeContent);
  });

  it("fails check mode when redaction would change files", async () => {
    const project = await createConfigProject({
      redaction: {
        paths: ["arguments.email"],
      },
    });
    await writeJson(path.join(project, "raw.json"), {
      arguments: {
        email: "user@example.com",
      },
    });

    await expect(
      runCliCommand(["redact", "--cwd", project, "--check", "raw.json"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 1,
      report: {
        findings: [
          {
            id: "redaction.would-change",
            severity: "error",
            file: "raw.json",
          },
        ],
        redaction: {
          checked: true,
          files: [
            {
              path: "raw.json",
              changed: true,
              replacements: 1,
            },
          ],
        },
      },
    });
    await expect(readFile(path.join(project, "raw.json"), "utf8")).resolves.toContain(
      "user@example.com",
    );
  });

  it("previews redaction output with dry run", async () => {
    const project = await createConfigProject({
      redaction: {
        paths: ["arguments.email"],
      },
    });
    await writeJson(path.join(project, "raw.json"), {
      arguments: {
        email: "user@example.com",
      },
    });

    await expect(
      runCliCommand(["redact", "--cwd", project, "--dry-run", "--out-dir", "safe", "raw.json"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        redaction: {
          dryRun: true,
          files: [
            {
              path: "raw.json",
              destination: "safe/raw.json",
              changed: true,
              replacements: 1,
            },
          ],
        },
      },
    });
    await expect(fileExists(path.join(project, "safe/raw.json"))).resolves.toBe(false);
  });

  it("writes a single redacted output file with --out", async () => {
    const project = await createConfigProject({
      redaction: {
        paths: ["arguments.email"],
        replacement: "[SAFE]",
      },
    });
    await writeJson(path.join(project, "raw.json"), {
      arguments: {
        email: "user@example.com",
      },
    });

    await expect(
      runCliCommand(["redact", "--cwd", project, "raw.json", "--out", "safe/raw.json"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        redaction: {
          files: [
            {
              path: "raw.json",
              destination: "safe/raw.json",
              changed: true,
              replacements: 1,
            },
          ],
        },
      },
    });
    await expect(readFile(path.join(project, "safe/raw.json"), "utf8")).resolves.toContain(
      '"email": "[SAFE]"',
    );
    await expect(readFile(path.join(project, "raw.json"), "utf8")).resolves.toContain(
      "user@example.com",
    );
  });

  it("redacts suite captures into an output directory", async () => {
    const project = await createConfigProject({
      captures: {
        regression: ["captures/regression/*.json"],
      },
      redaction: {
        paths: ["arguments.email"],
      },
    });
    await writeJson(path.join(project, "captures/regression/raw.json"), {
      arguments: {
        email: "user@example.com",
      },
    });

    await expect(
      runCliCommand(["redact", "--cwd", project, "--suite", "regression", "--out-dir", "redacted"]),
    ).resolves.toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        redaction: {
          files: [
            {
              path: "captures/regression/raw.json",
              destination: "redacted/captures/regression/raw.json",
              changed: true,
              replacements: 1,
            },
          ],
        },
      },
    });
    await expect(
      readFile(path.join(project, "redacted/captures/regression/raw.json"), "utf8"),
    ).resolves.toContain('"email": "[REDACTED]"');
  });

  it("reports malformed JSON during redaction", async () => {
    const project = await createConfigProject({
      redaction: {
        paths: ["arguments.email"],
      },
    });
    await writeFile(path.join(project, "bad.json"), "{ nope");

    await expect(runCliCommand(["redact", "--cwd", project, "bad.json"])).resolves.toMatchObject({
      kind: "success",
      exitCode: 1,
      report: {
        findings: [
          {
            id: "capture.file-invalid-json",
            severity: "error",
            file: "bad.json",
          },
        ],
        redaction: {
          files: [
            {
              path: "bad.json",
              changed: false,
              replacements: 0,
            },
          ],
        },
      },
    });
  });
});

describe("runCli", () => {
  it("prints human command output", async () => {
    const project = await createConfigProject();
    const output = createCliOutput();
    const exitCode = await runCli(["check", "--cwd", project], output.io);

    expect(exitCode).toBe(0);
    expect(output.stdout).toContain("tool-call-contract check");
    expect(output.stderr).toBe("");
  });

  it("prints JSON command output", async () => {
    const project = await createConfigProject();
    const output = createCliOutput();
    const exitCode = await runCli(["generate", "--cwd", project, "--json"], output.io);

    expect(exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "generate",
      success: true,
    });
  });

  it("prints human artifact output", async () => {
    const project = await createConfigProject();
    const output = createCliOutput();
    const exitCode = await runCli(["generate", "--cwd", project], output.io);

    expect(exitCode).toBe(0);
    expect(output.stdout).toContain("tool-call-contract generate");
    expect(output.stdout).toContain("Artifacts: 5 created, 0 updated, 0 unchanged, 0 deleted.");
    expect(output.stdout).toContain(".tool-call-contract/manifest.json");
    expect(output.stderr).toBe("");
  });

  it("prints usage errors to stderr", async () => {
    const output = createCliOutput();
    const exitCode = await runCli(["validate"], output.io);

    expect(exitCode).toBe(2);
    expect(output.stdout).toBe("");
    expect(output.stderr).toBe("validate requires at least one file or --suite.\n");
  });

  it("prints deterministic JSON validation output", async () => {
    const project = await createConfigProject();
    const output = createCliOutput();
    await writeJson(path.join(project, "valid.json"), {
      name: "search_docs",
      arguments: {
        query: "json reporter",
      },
    });

    const exitCode = await runCli(
      ["validate", "--cwd", project, "--json", "valid.json"],
      output.io,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "validate",
      success: true,
      summary: {
        validResults: 1,
        invalidResults: 0,
      },
      validation: {
        suites: [],
        files: [
          {
            path: "valid.json",
            suiteNames: [],
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
          file: "valid.json",
          contractName: "search_docs",
        },
      ],
    });
    expect(output.stderr).toBe("");
  });

  it("prints human validation grouping for suite runs", async () => {
    const project = await createConfigProject({
      captures: {
        smoke: ["captures/smoke/*.json"],
      },
    });
    const output = createCliOutput();
    await writeJson(path.join(project, "captures/smoke/search.json"), {
      name: "search_docs",
      arguments: {
        query: "human",
      },
    });

    const exitCode = await runCli(["validate", "--cwd", project, "--suite", "smoke"], output.io);

    expect(exitCode).toBe(0);
    expect(output.stdout).toContain("Validation suites:\n  smoke: 1 file(s), 1 valid, 0 invalid");
    expect(output.stdout).toContain(
      "Validation files:\n  captures/smoke/search.json: smoke, 1 valid, 0 invalid",
    );
    expect(output.stderr).toBe("");
  });

  it("prints human redaction output", async () => {
    const project = await createConfigProject({
      redaction: {
        paths: ["arguments.email"],
      },
    });
    const output = createCliOutput();
    await writeJson(path.join(project, "raw.json"), {
      arguments: {
        email: "user@example.com",
      },
    });

    const exitCode = await runCli(["redact", "--cwd", project, "raw.json"], output.io);

    expect(exitCode).toBe(0);
    expect(output.stdout).toContain("tool-call-contract redact");
    expect(output.stdout).toContain("Redaction: 1 changed, 0 unchanged.");
    expect(output.stdout).toContain("changed raw.json: 1 replacement(s)");
    expect(output.stderr).toBe("");
  });
});

function createCliOutput() {
  const output = {
    stdout: "",
    stderr: "",
    io: {
      stdout(text: string) {
        output.stdout += text;
      },
      stderr(text: string) {
        output.stderr += text;
      },
    },
  };

  return output;
}

interface ConfigProjectOptions {
  invalidName?: boolean;
  missingDescription?: boolean;
  rootStringSchema?: boolean;
  description?: string;
  extraContract?: boolean;
  captures?: Record<string, readonly string[]>;
  redaction?: {
    paths: readonly string[];
    replacement?: string;
  };
}

async function createConfigProject(options: ConfigProjectOptions = {}): Promise<string> {
  const project = await mkdtemp(path.join(tmpdir(), "tool-call-contract-cli-"));
  await writeProjectConfig(project, options);
  return project;
}

async function writeProjectConfig(
  project: string,
  options: ConfigProjectOptions = {},
): Promise<void> {
  const moduleUrl = pathToFileURL(path.resolve("src/index.ts")).href;
  const zodUrl = pathToFileURL(path.resolve("node_modules/zod/index.js")).href;
  const name = options.invalidName ? "search docs!" : "search_docs";
  const description = options.missingDescription
    ? ""
    : (options.description ?? "Search documentation.");
  const schema = options.rootStringSchema ? "z.string()" : "z.object({ query: z.string() })";
  const captures = options.captures
    ? `,
  captures: ${JSON.stringify(options.captures, null, 2)}`
    : "";
  const redaction = options.redaction
    ? `,
  redaction: ${JSON.stringify(options.redaction, null, 2)}`
    : "";

  await writeFile(
    path.join(project, "tool-call-contract.config.ts"),
    `
import { z } from "${zodUrl}";
import { defineConfig, defineToolContract } from "${moduleUrl}";

const searchDocs = defineToolContract({
  name: ${JSON.stringify(name)},
  description: "Search documentation.",
  input: ${schema},
});
const configuredSearchDocs = {
  ...searchDocs,
  description: ${JSON.stringify(description)}
};
const createIssue = defineToolContract({
  name: "create_issue",
  description: "Create an issue.",
  input: z.object({ title: z.string() }),
});

export default defineConfig({
  contracts: [configuredSearchDocs${options.extraContract ? ", createIssue" : ""}]${captures}${redaction},
});
`,
  );
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
