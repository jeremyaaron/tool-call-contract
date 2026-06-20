import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { hashContent } from "../src/artifacts.js";
import { planArtifactWrites } from "../src/artifact-writer.js";

describe("planArtifactWrites", () => {
  it("rejects artifact paths outside the configured output directory", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "tool-call-contract-writer-"));
    const content = "{}\n";

    const plan = await planArtifactWrites(
      [
        {
          path: "../outside.json",
          kind: "fixture",
          content,
          hash: hashContent(content),
        },
      ],
      {
        cwd: project,
        outDir: path.join(project, ".tool-call-contract"),
      },
    );

    expect(plan.entries).toEqual([]);
    expect(plan.findings).toMatchObject([
      {
        id: "artifact.path-outside-out-dir",
        severity: "error",
      },
    ]);
  });
});
