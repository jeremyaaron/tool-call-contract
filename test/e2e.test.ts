import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCliCommand } from "../src/cli/app.js";

const exampleProject = path.resolve("examples/basic");
const generatedDir = path.join(exampleProject, ".tool-call-contract");

describe("basic example project", () => {
  it("checks, generates, checks freshness, and validates captures", async () => {
    await rm(generatedDir, { recursive: true, force: true });

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
      await rm(generatedDir, { recursive: true, force: true });
    }
  });
});
