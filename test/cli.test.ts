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
  it("returns help output", () => {
    const result = runCliCommand(["--help"]);

    expect(result).toMatchObject({
      kind: "output",
      exitCode: 0,
    });
    if (result.kind === "output") {
      expect(result.text).toContain("tool-call-contract <command>");
    }
  });

  it("returns version output", () => {
    expect(runCliCommand(["--version"])).toEqual({
      kind: "output",
      exitCode: 0,
      text: "0.0.0\n",
    });
  });

  it("runs check in placeholder mode", () => {
    expect(runCliCommand(["check"])).toMatchObject({
      kind: "success",
      exitCode: 0,
      report: {
        command: "check",
        success: true,
      },
    });
  });
});

describe("runCli", () => {
  it("prints human command output", () => {
    const output = createCliOutput();
    const exitCode = runCli(["check"], output.io);

    expect(exitCode).toBe(0);
    expect(output.stdout).toContain("tool-call-contract check");
    expect(output.stderr).toBe("");
  });

  it("prints JSON command output", () => {
    const output = createCliOutput();
    const exitCode = runCli(["generate", "--json"], output.io);

    expect(exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "generate",
      success: true,
    });
  });

  it("prints usage errors to stderr", () => {
    const output = createCliOutput();
    const exitCode = runCli(["validate"], output.io);

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
