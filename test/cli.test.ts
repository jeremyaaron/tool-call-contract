import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { version } from "../src/index.js";
import { parseCliArgs, runCli, runCliCommand } from "../src/cli/app.js";

describe("package scaffold", () => {
  it("exports the package version", () => {
    expect(version).toBe("0.0.0");
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
      text: "0.0.0\n",
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

  it("prints usage errors to stderr", async () => {
    const output = createCliOutput();
    const exitCode = await runCli(["validate"], output.io);

    expect(exitCode).toBe(2);
    expect(output.stdout).toBe("");
    expect(output.stderr).toBe("validate requires at least one file.\n");
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

async function createConfigProject(
  options: {
    invalidName?: boolean;
    missingDescription?: boolean;
  } = {},
): Promise<string> {
  const project = await mkdtemp(path.join(tmpdir(), "tool-call-contract-cli-"));
  const moduleUrl = pathToFileURL(path.resolve("src/index.ts")).href;
  const zodUrl = pathToFileURL(path.resolve("node_modules/zod/index.js")).href;
  const name = options.invalidName ? "search docs!" : "search_docs";
  const description = options.missingDescription ? "" : "Search documentation.";

  await writeFile(
    path.join(project, "tool-call-contract.config.ts"),
    `
import { z } from "${zodUrl}";
import { defineConfig, defineToolContract } from "${moduleUrl}";

const searchDocs = defineToolContract({
  name: ${JSON.stringify(name)},
  description: "Search documentation.",
  input: z.object({ query: z.string() }),
});
const configuredSearchDocs = {
  ...searchDocs,
  description: ${JSON.stringify(description)}
};

export default defineConfig({
  contracts: [configuredSearchDocs],
});
`,
  );

  return project;
}
