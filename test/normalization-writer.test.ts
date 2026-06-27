import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { formatJson } from "../src/artifacts.js";
import { planNormalizationWrites } from "../src/normalization-writer.js";

describe("planNormalizationWrites", () => {
  it("plans direct output for one input file", async () => {
    const cwd = await createTempDir();
    const plan = await planNormalizationWrites({
      cwd,
      files: [
        {
          path: "captures/raw/openai.json",
          content: openAiResponseContent("create_issue", { title: "Bug" }),
        },
      ],
      format: "openai-responses",
      out: "captures/regression/create-issue.json",
    });

    expect(plan.findings).toEqual([]);
    expect(plan.entries).toEqual([
      {
        inputPath: "captures/raw/openai.json",
        outputPath: "captures/regression/create-issue.json",
        callsFound: 1,
        callsWritten: 1,
        skipped: 0,
        changed: true,
        content: normalizedContent("create_issue", { title: "Bug" }),
        issues: [],
      },
    ]);
  });

  it("maps output directory entries by input basename", async () => {
    const cwd = await createTempDir();
    const plan = await planNormalizationWrites({
      cwd,
      files: [
        {
          path: "captures/raw/openai.json",
          content: openAiResponseContent("create_issue", { title: "Bug" }),
        },
        {
          path: "captures/raw/langchain.json",
          content: openAiResponseContent("search_docs", { query: "billing" }),
        },
      ],
      format: "openai-responses",
      outDir: "captures/regression",
    });

    expect(plan.findings).toEqual([]);
    expect(plan.entries.map((entry) => entry.outputPath)).toEqual([
      "captures/regression/openai.json",
      "captures/regression/langchain.json",
    ]);
  });

  it("formats multiple calls as an array", async () => {
    const cwd = await createTempDir();
    const plan = await planNormalizationWrites({
      cwd,
      files: [
        {
          path: "captures/raw/openai.json",
          content: JSON.stringify({
            output: [
              {
                type: "function_call",
                name: "search_docs",
                arguments: JSON.stringify({ query: "billing" }),
              },
              {
                type: "function_call",
                name: "create_issue",
                arguments: JSON.stringify({ title: "Bug" }),
              },
            ],
          }),
        },
      ],
      format: "openai-responses",
      out: "captures/regression/openai.json",
    });

    expect(plan.entries[0]?.content).toBe(
      formatJson([
        {
          name: "search_docs",
          arguments: {
            query: "billing",
          },
        },
        {
          name: "create_issue",
          arguments: {
            title: "Bug",
          },
        },
      ]),
    );
  });

  it("marks matching existing output as unchanged", async () => {
    const cwd = await createTempDir();
    await mkdir(path.join(cwd, "captures/regression"), { recursive: true });
    await writeFile(
      path.join(cwd, "captures/regression/create-issue.json"),
      normalizedContent("create_issue", { title: "Bug" }),
    );

    const plan = await planNormalizationWrites({
      cwd,
      files: [
        {
          path: "captures/raw/openai.json",
          content: openAiResponseContent("create_issue", { title: "Bug" }),
        },
      ],
      format: "openai-responses",
      out: "captures/regression/create-issue.json",
    });

    expect(plan.findings).toEqual([]);
    expect(plan.entries).toMatchObject([
      {
        changed: false,
      },
    ]);
    expect(plan.entries[0]).not.toHaveProperty("content");
  });

  it("reports stale output in check mode", async () => {
    const cwd = await createTempDir();
    await mkdir(path.join(cwd, "captures/regression"), { recursive: true });
    await writeFile(path.join(cwd, "captures/regression/create-issue.json"), "{}\n");

    const plan = await planNormalizationWrites({
      cwd,
      files: [
        {
          path: "captures/raw/openai.json",
          content: openAiResponseContent("create_issue", { title: "Bug" }),
        },
      ],
      format: "openai-responses",
      out: "captures/regression/create-issue.json",
      check: true,
    });

    expect(plan.entries).toMatchObject([
      {
        changed: true,
        checkFailure: "stale",
      },
    ]);
    expect(plan.findings).toMatchObject([
      {
        id: "normalize.output-stale",
        severity: "error",
        file: "captures/regression/create-issue.json",
      },
    ]);
  });

  it("reports missing output in check mode", async () => {
    const cwd = await createTempDir();
    const plan = await planNormalizationWrites({
      cwd,
      files: [
        {
          path: "captures/raw/openai.json",
          content: openAiResponseContent("create_issue", { title: "Bug" }),
        },
      ],
      format: "openai-responses",
      out: "captures/regression/create-issue.json",
      check: true,
    });

    expect(plan.entries).toMatchObject([
      {
        changed: true,
        checkFailure: "missing",
      },
    ]);
    expect(plan.findings).toMatchObject([
      {
        id: "normalize.output-missing",
        severity: "error",
        file: "captures/regression/create-issue.json",
      },
    ]);
  });

  it("reports output collisions", async () => {
    const cwd = await createTempDir();
    const plan = await planNormalizationWrites({
      cwd,
      files: [
        {
          path: "captures/raw/one/example.json",
          content: openAiResponseContent("create_issue", { title: "One" }),
        },
        {
          path: "captures/raw/two/example.json",
          content: openAiResponseContent("create_issue", { title: "Two" }),
        },
      ],
      format: "openai-responses",
      outDir: "captures/regression",
    });

    expect(plan.entries).toHaveLength(2);
    expect(plan.findings).toMatchObject([
      {
        id: "normalize.output-collision",
        severity: "error",
        file: "captures/regression/example.json",
      },
    ]);
  });

  it("reports malformed input JSON", async () => {
    const cwd = await createTempDir();
    const plan = await planNormalizationWrites({
      cwd,
      files: [
        {
          path: "captures/raw/bad.json",
          content: "{ nope",
        },
      ],
      format: "openai-responses",
      out: "captures/regression/bad.json",
    });

    expect(plan.entries).toMatchObject([
      {
        inputPath: "captures/raw/bad.json",
        callsFound: 0,
        callsWritten: 0,
        skipped: 0,
        changed: false,
        issues: [
          {
            code: "normalize.input-invalid-json",
          },
        ],
      },
    ]);
    expect(plan.findings).toMatchObject([
      {
        id: "normalize.input-invalid-json",
        severity: "error",
        file: "captures/raw/bad.json",
      },
    ]);
  });

  it("reports inputs with no tool calls", async () => {
    const cwd = await createTempDir();
    const plan = await planNormalizationWrites({
      cwd,
      files: [
        {
          path: "captures/raw/empty.json",
          content: JSON.stringify({ output: [] }),
        },
      ],
      format: "openai-responses",
      out: "captures/regression/empty.json",
    });

    expect(plan.entries).toMatchObject([
      {
        callsFound: 0,
        callsWritten: 0,
        changed: false,
        issues: [
          {
            code: "normalize.no-tool-calls",
          },
        ],
      },
    ]);
    expect(plan.findings).toMatchObject([
      {
        id: "normalize.no-tool-calls",
        severity: "error",
      },
    ]);
  });

  it("supports dry-run style planning without a destination", async () => {
    const cwd = await createTempDir();
    const plan = await planNormalizationWrites({
      cwd,
      files: [
        {
          path: "captures/raw/openai.json",
          content: openAiResponseContent("create_issue", { title: "Bug" }),
        },
      ],
      format: "openai-responses",
    });

    expect(plan.findings).toEqual([]);
    expect(plan.entries).toEqual([
      {
        inputPath: "captures/raw/openai.json",
        callsFound: 1,
        callsWritten: 1,
        skipped: 0,
        changed: true,
        content: normalizedContent("create_issue", { title: "Bug" }),
        issues: [],
      },
    ]);
  });

  it("rejects output paths outside cwd", async () => {
    const cwd = await createTempDir();
    const plan = await planNormalizationWrites({
      cwd,
      files: [
        {
          path: "captures/raw/openai.json",
          content: openAiResponseContent("create_issue", { title: "Bug" }),
        },
      ],
      format: "openai-responses",
      out: "../outside.json",
    });

    expect(plan.entries).toEqual([
      {
        inputPath: "captures/raw/openai.json",
        callsFound: 0,
        callsWritten: 0,
        skipped: 0,
        changed: false,
        issues: [],
      },
    ]);
    expect(plan.findings).toMatchObject([
      {
        id: "normalize.output-outside-root",
        severity: "error",
      },
    ]);
  });
});

function openAiResponseContent(name: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    output: [
      {
        type: "function_call",
        name,
        arguments: JSON.stringify(args),
      },
    ],
  });
}

function normalizedContent(name: string, args: Record<string, unknown>): string {
  return formatJson({ name, arguments: args });
}

async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "tool-call-contract-normalize-"));
}
