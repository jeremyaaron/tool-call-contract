import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  defaultInitPackageScripts,
  planInitProject,
  planInitProjectTestMarker,
} from "../src/cli/init.js";

describe("planInitProject", () => {
  it("plans starter files and package scripts for a fresh project", async () => {
    const cwd = await createTempDir();
    await writePackageJson(cwd, {
      name: "agent-app",
      version: "1.0.0",
    });

    const plan = await planInitProject({
      cwd,
      dryRun: false,
      force: false,
    });

    expect(plan.findings).toEqual([]);
    expect(plan.init).toMatchObject({
      dryRun: false,
      force: false,
      files: [
        {
          path: "tool-call-contract.config.ts",
          action: "created",
        },
        {
          path: "captures/raw/openai-responses.json",
          action: "created",
        },
        {
          path: "captures/regression/openai-responses.json",
          action: "created",
        },
      ],
    });
    expect(plan.packageScripts).toHaveLength(Object.keys(defaultInitPackageScripts).length);
    expect(plan.packageScripts.every((script) => script.action === "created")).toBe(true);
    expect(plan.packageJson).toMatchObject({
      path: "package.json",
      action: "updated",
    });
    expect(JSON.parse(plan.packageJson?.content ?? "{}")).toMatchObject({
      scripts: defaultInitPackageScripts,
    });

    await expect(access(path.join(cwd, "tool-call-contract.config.ts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("skips existing files and scripts without force", async () => {
    const cwd = await createTempDir();
    await writeFile(path.join(cwd, "tool-call-contract.config.ts"), "custom config\n");
    await writePackageJson(cwd, {
      name: "agent-app",
      scripts: {
        "tool-contracts:check": "custom check",
      },
    });

    const plan = await planInitProject({
      cwd,
      dryRun: false,
      force: false,
    });

    expect(plan.findings).toEqual([]);
    expect(plan.init.files.find((file) => file.path === "tool-call-contract.config.ts")).toEqual({
      path: "tool-call-contract.config.ts",
      action: "skipped",
      reason: "file already exists with different content",
    });
    expect(plan.packageScripts.find((script) => script.name === "tool-contracts:check")).toEqual({
      name: "tool-contracts:check",
      value: "tool-call-contract check",
      action: "skipped",
      reason: "script already exists with different content",
    });
    expect(JSON.parse(plan.packageJson?.content ?? "{}")).toMatchObject({
      scripts: {
        "tool-contracts:check": "custom check",
        "tool-contracts:generate": "tool-call-contract generate",
      },
    });
  });

  it("updates existing files and scripts with force", async () => {
    const cwd = await createTempDir();
    await writeFile(path.join(cwd, "tool-call-contract.config.ts"), "custom config\n");
    await writePackageJson(cwd, {
      name: "agent-app",
      scripts: {
        "tool-contracts:check": "custom check",
      },
    });

    const plan = await planInitProject({
      cwd,
      dryRun: true,
      force: true,
    });

    expect(plan.init).toMatchObject({
      dryRun: true,
      force: true,
    });
    expect(plan.init.files.find((file) => file.path === "tool-call-contract.config.ts")).toEqual({
      path: "tool-call-contract.config.ts",
      action: "updated",
    });
    expect(plan.packageScripts.find((script) => script.name === "tool-contracts:check")).toEqual({
      name: "tool-contracts:check",
      value: "tool-call-contract check",
      action: "updated",
    });
    expect(JSON.parse(plan.packageJson?.content ?? "{}")).toMatchObject({
      scripts: {
        "tool-contracts:check": "tool-call-contract check",
      },
    });
    expect(await readFile(path.join(cwd, "tool-call-contract.config.ts"), "utf8")).toBe(
      "custom config\n",
    );
  });

  it("skips package scripts when package.json is missing", async () => {
    const cwd = await createTempDir();

    const plan = await planInitProject({
      cwd,
      dryRun: false,
      force: false,
    });

    expect(plan.findings).toEqual([]);
    expect(plan.packageJson).toBeUndefined();
    expect(plan.init.packageScripts).toHaveLength(Object.keys(defaultInitPackageScripts).length);
    expect(plan.init.packageScripts).toEqual(
      expect.arrayContaining([
        {
          name: "tool-contracts:check",
          action: "skipped",
          reason: "package.json was not found",
        },
      ]),
    );
  });

  it("reports malformed package.json and still plans non-package files", async () => {
    const cwd = await createTempDir();
    await writeFile(path.join(cwd, "package.json"), "{not json", "utf8");

    const plan = await planInitProject({
      cwd,
      dryRun: false,
      force: false,
    });

    expect(plan.findings).toMatchObject([
      {
        id: "init.package-json-invalid",
        severity: "error",
        file: "package.json",
      },
    ]);
    expect(plan.init.files.every((file) => file.action === "created")).toBe(true);
    expect(plan.init.packageScripts).toEqual(
      expect.arrayContaining([
        {
          name: "tool-contracts:check",
          action: "skipped",
          reason: "package.json is malformed",
        },
      ]),
    );
  });

  it("reports init paths outside the project root", async () => {
    const cwd = await createTempDir();

    const plan = await planInitProject(
      {
        cwd,
        dryRun: false,
        force: false,
        templates: [
          {
            path: "../outside.json",
            content: "{}\n",
          },
        ],
      },
      planInitProjectTestMarker,
    );

    expect(plan.fileWrites).toEqual([]);
    expect(plan.findings).toMatchObject([
      {
        id: "init.path-outside-root",
        severity: "error",
        file: "../outside.json",
      },
    ]);
  });
});

async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "tool-call-contract-init-"));
}

async function writePackageJson(cwd: string, value: unknown): Promise<void> {
  await mkdir(cwd, { recursive: true });
  await writeFile(path.join(cwd, "package.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
