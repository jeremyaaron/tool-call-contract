import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveCaptureFiles } from "../src/captures.js";

describe("resolveCaptureFiles", () => {
  it("resolves configured suites with deterministic project-relative paths", async () => {
    const project = await createCaptureProject({
      "captures/smoke/b.json": "{}",
      "captures/smoke/a.json": "{}",
      "captures/regression/create.json": "{}",
    });

    await expect(
      resolveCaptureFiles({
        cwd: project,
        captures: {
          smoke: ["captures/smoke/*.json"],
        },
        suites: ["smoke"],
        files: [],
      }),
    ).resolves.toEqual({
      files: [
        {
          path: "captures/smoke/a.json",
          suiteNames: ["smoke"],
        },
        {
          path: "captures/smoke/b.json",
          suiteNames: ["smoke"],
        },
      ],
      findings: [],
    });
  });

  it("dedupes overlapping suites while preserving selected suite order per file", async () => {
    const project = await createCaptureProject({
      "captures/smoke/basic.json": "{}",
      "captures/regression/create.json": "{}",
    });

    await expect(
      resolveCaptureFiles({
        cwd: project,
        captures: {
          all: ["captures/**/*.json"],
          regression: ["captures/regression/*.json"],
        },
        suites: ["all", "regression", "all"],
        files: ["captures/regression/create.json"],
      }),
    ).resolves.toEqual({
      files: [
        {
          path: "captures/regression/create.json",
          suiteNames: ["all", "regression"],
        },
        {
          path: "captures/smoke/basic.json",
          suiteNames: ["all"],
        },
      ],
      findings: [],
    });
  });

  it("includes direct files without suite names", async () => {
    const project = await createCaptureProject({
      "captures/manual.json": "{}",
    });

    await expect(
      resolveCaptureFiles({
        cwd: project,
        captures: undefined,
        suites: [],
        files: ["captures/manual.json"],
      }),
    ).resolves.toEqual({
      files: [
        {
          path: "captures/manual.json",
          suiteNames: [],
        },
      ],
      findings: [],
    });
  });

  it("reports unknown suites", async () => {
    const project = await createCaptureProject({});

    const result = await resolveCaptureFiles({
      cwd: project,
      captures: {
        smoke: ["captures/smoke/*.json"],
      },
      suites: ["regression"],
      files: [],
    });

    expect(result.files).toEqual([]);
    expect(result.findings).toMatchObject([
      {
        id: "capture.suite-unknown",
        severity: "error",
      },
    ]);
  });

  it("reports selected suites with no matching files", async () => {
    const project = await createCaptureProject({});

    const result = await resolveCaptureFiles({
      cwd: project,
      captures: {
        regression: ["captures/regression/*.json"],
      },
      suites: ["regression"],
      files: [],
    });

    expect(result.files).toEqual([]);
    expect(result.findings).toMatchObject([
      {
        id: "capture.suite-empty",
        severity: "error",
      },
    ]);
  });

  it("rejects direct files outside the project root", async () => {
    const project = await createCaptureProject({});

    const result = await resolveCaptureFiles({
      cwd: project,
      captures: undefined,
      suites: [],
      files: ["../outside.json"],
    });

    expect(result.files).toEqual([]);
    expect(result.findings).toMatchObject([
      {
        id: "capture.file-outside-root",
        severity: "error",
        file: "../outside.json",
      },
    ]);
  });
});

async function createCaptureProject(files: Record<string, string>): Promise<string> {
  const project = await mkdtemp(path.join(tmpdir(), "tool-call-contract-captures-"));

  for (const [file, content] of Object.entries(files)) {
    const absoluteFile = path.join(project, file);
    await mkdir(path.dirname(absoluteFile), { recursive: true });
    await writeFile(absoluteFile, content);
  }

  return project;
}
