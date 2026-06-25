import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  defaultGeneratedTestOutFile,
  generateTestPlan,
  renderGeneratedTest,
} from "../src/test-generation.js";

describe("generateTestPlan", () => {
  it("renders deterministic Vitest content for the default output path", async () => {
    const project = await createCaptureProject({
      "captures/regression/b.json": "{}",
      "captures/regression/a.json": "{}",
    });

    const plan = await generateTestPlan({
      cwd: project,
      configPath: path.join(project, "tool-call-contract.config.ts"),
      captures: {
        regression: ["captures/regression/*.json"],
      },
      suites: ["regression"],
    });

    expect(plan.outFile).toBe(defaultGeneratedTestOutFile);
    expect(plan.findings).toEqual([]);
    expect(plan.captureFiles.map((file) => file.path)).toEqual([
      "captures/regression/a.json",
      "captures/regression/b.json",
    ]);
    expect(plan.content).toContain('import { readFile } from "node:fs/promises";');
    expect(plan.content).toContain('import { describe, expect, it } from "vitest";');
    expect(plan.content).toContain('import { validateToolCalls } from "tool-call-contract";');
    expect(plan.content).toContain('import config from "../tool-call-contract.config";');
    expect(plan.content).toContain('label: "captures/regression/a.json"');
    expect(plan.content).toContain(
      'url: new URL("../captures/regression/a.json", import.meta.url)',
    );
    expect(plan.content.indexOf("captures/regression/a.json")).toBeLessThan(
      plan.content.indexOf("captures/regression/b.json"),
    );
    expect(plan.content).toContain("validateToolCalls(config.contracts, capture)");
    expect(plan.content.endsWith("\n")).toBe(true);
  });

  it("uses all configured suites when no suite is selected", async () => {
    const project = await createCaptureProject({
      "captures/regression/create.json": "{}",
      "captures/smoke/search.json": "{}",
    });

    const plan = await generateTestPlan({
      cwd: project,
      configPath: path.join(project, "tool-call-contract.config.ts"),
      captures: {
        smoke: ["captures/smoke/*.json"],
        regression: ["captures/regression/*.json"],
      },
      suites: [],
    });

    expect(plan.findings).toEqual([]);
    expect(plan.captureFiles.map((file) => file.path)).toEqual([
      "captures/smoke/search.json",
      "captures/regression/create.json",
    ]);
    expect(plan.content).toContain('label: "captures/regression/create.json"');
    expect(plan.content).toContain('label: "captures/smoke/search.json"');
  });

  it("computes config imports and file URLs relative to custom output locations", async () => {
    const project = await createCaptureProject({
      "captures/regression/create.json": "{}",
    });

    const plan = await generateTestPlan({
      cwd: project,
      configPath: path.join(project, "tool-call-contract.config.ts"),
      captures: {
        regression: ["captures/regression/*.json"],
      },
      suites: ["regression"],
      outFile: "tests/contracts/tool-call-contract.generated.test.ts",
    });

    expect(plan.outFile).toBe("tests/contracts/tool-call-contract.generated.test.ts");
    expect(plan.content).toContain('import config from "../../tool-call-contract.config";');
    expect(plan.content).toContain(
      'url: new URL("../../captures/regression/create.json", import.meta.url)',
    );
  });

  it("reports missing capture configuration", async () => {
    const project = await createCaptureProject({});

    const plan = await generateTestPlan({
      cwd: project,
      configPath: path.join(project, "tool-call-contract.config.ts"),
      captures: undefined,
      suites: [],
    });

    expect(plan).toMatchObject({
      outFile: defaultGeneratedTestOutFile,
      content: "",
      captureFiles: [],
      findings: [
        {
          id: "generated-test.no-captures",
          severity: "error",
        },
      ],
    });
  });

  it("passes through capture suite findings", async () => {
    const project = await createCaptureProject({});

    const unknownSuite = await generateTestPlan({
      cwd: project,
      configPath: path.join(project, "tool-call-contract.config.ts"),
      captures: {
        smoke: ["captures/smoke/*.json"],
      },
      suites: ["regression"],
    });
    const emptySuite = await generateTestPlan({
      cwd: project,
      configPath: path.join(project, "tool-call-contract.config.ts"),
      captures: {
        regression: ["captures/regression/*.json"],
      },
      suites: ["regression"],
    });

    expect(unknownSuite.findings).toMatchObject([
      {
        id: "capture.suite-unknown",
        severity: "error",
      },
    ]);
    expect(unknownSuite.content).toBe("");
    expect(emptySuite.findings).toMatchObject([
      {
        id: "capture.suite-empty",
        severity: "error",
      },
    ]);
    expect(emptySuite.content).toBe("");
  });

  it("rejects output paths outside the project root", async () => {
    const project = await createCaptureProject({
      "captures/regression/create.json": "{}",
    });

    const plan = await generateTestPlan({
      cwd: project,
      configPath: path.join(project, "tool-call-contract.config.ts"),
      captures: {
        regression: ["captures/regression/*.json"],
      },
      suites: ["regression"],
      outFile: "../generated.test.ts",
    });

    expect(plan).toMatchObject({
      outFile: "../generated.test.ts",
      content: "",
      captureFiles: [],
      findings: [
        {
          id: "generated-test.outside-root",
          severity: "error",
          file: "../generated.test.ts",
        },
      ],
    });
  });
});

describe("renderGeneratedTest", () => {
  it("renders only public package APIs and runtime JSON reads", () => {
    const content = renderGeneratedTest({
      cwd: "/project",
      configPath: "/project/custom.config.mts",
      outFile: "test/generated.test.ts",
      captureFiles: [
        {
          path: "captures/manual.json",
          suiteNames: [],
        },
      ],
    });

    expect(content).toContain('import { validateToolCalls } from "tool-call-contract";');
    expect(content).toContain('import config from "../custom.config";');
    expect(content).toContain('JSON.parse(await readFile(file.url, "utf8"))');
    expect(content).not.toContain("../src/");
    expect(content).not.toContain("runCli");
  });
});

async function createCaptureProject(files: Record<string, string>): Promise<string> {
  const project = await mkdtemp(path.join(tmpdir(), "tool-call-contract-test-generation-"));

  for (const [file, content] of Object.entries(files)) {
    const absoluteFile = path.join(project, file);
    await mkdir(path.dirname(absoluteFile), { recursive: true });
    await writeFile(absoluteFile, content);
  }

  return project;
}
