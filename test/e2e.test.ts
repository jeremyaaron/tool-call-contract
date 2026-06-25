import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { runCliCommand } from "../src/cli/app.js";

const exampleFixture = path.resolve("examples/basic");

describe("basic example project", () => {
  it("checks, generates, validates suites, redacts, and generates regression tests", async () => {
    const exampleProject = await mkdtemp(path.join(tmpdir(), "tool-call-contract-example-"));
    const generatedDir = path.join(exampleProject, ".tool-call-contract");
    await cp(exampleFixture, exampleProject, { recursive: true });
    await rewriteExampleConfigImport(exampleProject);

    try {
      await expect(runCliCommand(["check", "--cwd", exampleProject])).resolves.toMatchObject({
        kind: "success",
        exitCode: 0,
      });

      await expect(runCliCommand(["generate", "--cwd", exampleProject])).resolves.toMatchObject({
        kind: "success",
        exitCode: 0,
        report: {
          artifacts: {
            created: expect.arrayContaining([
              ".tool-call-contract/fixtures/search_knowledge_base.valid.json",
              ".tool-call-contract/fixtures/create_issue.valid.json",
              ".tool-call-contract/fixtures/summarize_thread.valid.json",
              ".tool-call-contract/manifest.json",
            ]),
          },
        },
      });

      await expect(
        readFile(path.join(generatedDir, "docs/search_knowledge_base.md"), "utf8"),
      ).resolves.toContain("# search_knowledge_base");

      await expect(runCliCommand(["check", "--cwd", exampleProject])).resolves.toMatchObject({
        kind: "success",
        exitCode: 0,
      });

      await expect(
        runCliCommand(["validate", "--cwd", exampleProject, "--suite", "smoke"]),
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
              },
            ],
          },
        },
      });

      await expect(
        runCliCommand([
          "validate",
          "--cwd",
          exampleProject,
          "captures/valid.json",
          "captures/openai-chat.json",
        ]),
      ).resolves.toMatchObject({
        kind: "success",
        exitCode: 0,
        report: {
          summary: {
            validResults: 4,
            invalidResults: 0,
          },
        },
      });

      await expect(
        runCliCommand(["redact", "--cwd", exampleProject, "--check", "--suite", "regression"]),
      ).resolves.toMatchObject({
        kind: "success",
        exitCode: 0,
        report: {
          redaction: {
            checked: true,
            files: [
              {
                path: "captures/regression/create-issue-redacted.json",
                changed: false,
                replacements: 0,
              },
            ],
          },
        },
      });

      await expect(
        runCliCommand(["generate-tests", "--cwd", exampleProject, "--suite", "regression"]),
      ).resolves.toMatchObject({
        kind: "success",
        exitCode: 0,
        report: {
          generatedTests: {
            outFile: "test/tool-call-contract.generated.test.ts",
            captureFiles: ["captures/regression/create-issue-redacted.json"],
            created: true,
          },
        },
      });
      await expect(
        readFile(path.join(exampleProject, "test/tool-call-contract.generated.test.ts"), "utf8"),
      ).resolves.toContain('label: "captures/regression/create-issue-redacted.json"');

      await expect(
        runCliCommand(["validate", "--cwd", exampleProject, "captures/invalid.json"]),
      ).resolves.toMatchObject({
        kind: "success",
        exitCode: 1,
        report: {
          summary: {
            invalidResults: 1,
          },
        },
      });
    } finally {
      await rm(exampleProject, { recursive: true, force: true });
    }
  });
});

async function rewriteExampleConfigImport(exampleProject: string): Promise<void> {
  const configPath = path.join(exampleProject, "tool-call-contract.config.ts");
  const sourceUrl = pathToFileURL(path.resolve("src/index.ts")).href;
  const zodUrl = pathToFileURL(path.resolve("node_modules/zod/index.js")).href;
  const config = await readFile(configPath, "utf8");

  await writeFile(
    configPath,
    config.replace('"zod"', JSON.stringify(zodUrl)).replace("../../src/index.ts", sourceUrl),
  );
}
