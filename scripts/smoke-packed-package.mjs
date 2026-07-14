import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let tarballPath;
let project;

try {
  tarballPath = await packPackage();
  project = await mkdtemp(path.join(tmpdir(), "tool-call-contract-smoke-"));

  await writeFile(
    path.join(project, "package.json"),
    `${JSON.stringify({ type: "module", private: true }, null, 2)}\n`,
  );
  await run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--dry-run=false",
      tarballPath,
      "zod@^4.0.0",
    ],
    {
      cwd: project,
    },
  );

  await writeFile(
    path.join(project, "tool-call-contract.config.mjs"),
    `
import { z } from "zod";
import { defineConfig, defineToolContract } from "tool-call-contract";

const searchDocs = defineToolContract({
  name: "search_docs",
  description: "Search documentation.",
  input: z.object({ query: z.string().min(1) }),
});

export default defineConfig({
  contracts: [searchDocs],
});
`.trimStart(),
  );
  await writeFile(
    path.join(project, "capture.json"),
    `${JSON.stringify(
      {
        name: "search_docs",
        arguments: {
          query: "pack smoke",
        },
      },
      null,
      2,
    )}\n`,
  );

  await run(
    "node",
    [
      "--input-type=module",
      "--eval",
      `
import { z } from "zod";
import { defineToolContract, validateToolCall, version } from "tool-call-contract";

if (version !== "0.5.0") {
  throw new Error(\`Expected version 0.5.0, received \${version}\`);
}

const contract = defineToolContract({
  name: "search_docs",
  description: "Search documentation.",
  input: z.object({ query: z.string() }),
});
const result = validateToolCall(contract, {
  name: "search_docs",
  arguments: { query: "library smoke" },
});

if (!result.ok) {
  throw new Error("Library validation smoke test failed.");
}
`,
    ],
    { cwd: project },
  );
  await run("npx", ["tool-call-contract", "check"], { cwd: project });
  await run("npx", ["tool-call-contract", "generate"], { cwd: project });
  await run("npx", ["tool-call-contract", "validate", "capture.json"], { cwd: project });

  const manifest = await readFile(
    path.join(project, ".tool-call-contract", "manifest.json"),
    "utf8",
  );
  if (!manifest.includes('"schemaVersion": 1')) {
    throw new Error("Generated manifest was not written by the packed CLI.");
  }
} finally {
  if (project) {
    await rm(project, { recursive: true, force: true });
  }

  if (tarballPath) {
    await rm(tarballPath, { force: true });
  }
}

async function packPackage() {
  const { stdout } = await run("npm", ["pack", "--json", "--ignore-scripts", "--dry-run=false"], {
    cwd: root,
  });
  const packResult = JSON.parse(stdout);
  const filename = packResult[0]?.filename;

  if (typeof filename !== "string") {
    throw new Error("npm pack did not report a tarball filename.");
  }

  return path.join(root, filename);
}

async function run(command, args, options) {
  try {
    return await execFileAsync(command, args, {
      cwd: options.cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = error.stderr ? `\n${error.stderr}` : "";
    const stdout = error.stdout ? `\n${error.stdout}` : "";
    throw new Error(`Command failed: ${command} ${args.join(" ")}${stdout}${stderr}`, {
      cause: error,
    });
  }
}
