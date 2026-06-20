import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { version } from "../src/index.js";
import { parseCliArgs, runCli, runCliCommand } from "../src/cli/app.js";

describe("package scaffold", () => {
  it("exports the package version", () => {
    expect(version).toBe("0.1.0");
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
    expect(parseCliArgs(["validate", "--allow-unknown", "one.json", "two.json"])).toMatchObject({
      command: "validate",
      options: {
        allowUnknown: true,
      },
      files: ["one.json", "two.json"],
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
      message: "validate requires at least one file.",
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
      text: "0.1.0\n",
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
            version: "0.1.0",
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

    const result = await runCliCommand(["validate", "--cwd", project, "one.json", "two.json"]);

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
            file: "one.json",
          },
          {
            ok: true,
            file: "two.json",
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
    expect(output.stderr).toBe("validate requires at least one file.\n");
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
  contracts: [configuredSearchDocs${options.extraContract ? ", createIssue" : ""}],
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
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
