import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  planArtifactChanges,
  summarizeArtifactPlan,
  type PlannedArtifact,
} from "../src/artifact-planner.js";

describe("planArtifactChanges", () => {
  it("plans missing artifacts as creates", async () => {
    const project = await createProject();
    const plan = await planArtifactChanges({
      artifacts: [artifact("generated/search.json", "{}\n")],
      cwd: project,
      outDir: path.join(project, "generated"),
    });

    expect(plan.issues).toEqual([]);
    expect(plan.entries).toMatchObject([
      {
        action: "create",
        artifact: {
          path: "generated/search.json",
        },
      },
    ]);
    expect(summarizeArtifactPlan(plan)).toEqual({
      created: ["generated/search.json"],
      updated: [],
      unchanged: [],
      cleanable: [],
    });
  });

  it("plans changed artifacts as updates", async () => {
    const project = await createProject();
    await mkdir(path.join(project, "generated"), { recursive: true });
    await writeFile(path.join(project, "generated/search.json"), "old\n", "utf8");

    const plan = await planArtifactChanges({
      artifacts: [artifact("generated/search.json", "new\n")],
      cwd: project,
      outDir: path.join(project, "generated"),
    });

    expect(plan.issues).toEqual([]);
    expect(plan.entries).toMatchObject([
      {
        action: "update",
      },
    ]);
  });

  it("plans matching artifacts as unchanged", async () => {
    const project = await createProject();
    await mkdir(path.join(project, "generated"), { recursive: true });
    await writeFile(path.join(project, "generated/search.json"), "{}\n", "utf8");

    const plan = await planArtifactChanges({
      artifacts: [artifact("generated/search.json", "{}\n")],
      cwd: project,
      outDir: path.join(project, "generated"),
    });

    expect(plan.issues).toEqual([]);
    expect(plan.entries).toMatchObject([
      {
        action: "unchanged",
      },
    ]);
  });

  it("rejects artifact paths outside the output directory", async () => {
    const project = await createProject();

    const plan = await planArtifactChanges({
      artifacts: [artifact("../outside.json", "{}\n")],
      cwd: project,
      outDir: path.join(project, "generated"),
    });

    expect(plan.entries).toEqual([]);
    expect(plan.issues).toMatchObject([
      {
        code: "artifact.path-outside-out-dir",
        path: "../outside.json",
      },
    ]);
  });

  it("plans stale manifest-owned files as cleanable", async () => {
    const project = await createProject();

    const plan = await planArtifactChanges({
      artifacts: [artifact("generated/current.json", "{}\n")],
      cwd: project,
      outDir: path.join(project, "generated"),
      includeCleanable: true,
      previousManifest: {
        files: [
          {
            path: "generated/old.json",
          },
        ],
      },
    });

    expect(plan.issues).toEqual([]);
    expect(plan.cleanable).toMatchObject([
      {
        path: "generated/old.json",
      },
    ]);
    expect(summarizeArtifactPlan(plan).cleanable).toEqual(["generated/old.json"]);
  });

  it("reports unsafe manifest-owned paths without making them cleanable", async () => {
    const project = await createProject();

    const plan = await planArtifactChanges({
      artifacts: [artifact("generated/current.json", "{}\n")],
      cwd: project,
      outDir: path.join(project, "generated"),
      includeCleanable: true,
      previousManifest: {
        files: [
          {
            path: "../outside.json",
          },
        ],
      },
    });

    expect(plan.cleanable).toEqual([]);
    expect(plan.issues).toMatchObject([
      {
        code: "artifact.path-outside-out-dir",
        path: "../outside.json",
      },
    ]);
  });

  it("dedupes duplicate cleanable manifest paths", async () => {
    const project = await createProject();

    const plan = await planArtifactChanges({
      artifacts: [artifact("generated/current.json", "{}\n")],
      cwd: project,
      outDir: path.join(project, "generated"),
      includeCleanable: true,
      previousManifest: {
        files: [
          {
            path: "generated/old.json",
          },
          {
            path: "generated/old.json",
          },
        ],
      },
    });

    expect(plan.cleanable.map((entry) => entry.path)).toEqual(["generated/old.json"]);
  });
});

function artifact(artifactPath: string, content: string): PlannedArtifact {
  return {
    path: artifactPath,
    content,
  };
}

async function createProject(): Promise<string> {
  const project = await mkdtemp(path.join(tmpdir(), "tool-call-contract-planner-"));
  await writeFile(path.join(project, "package.json"), "{}\n", "utf8");
  return project;
}
