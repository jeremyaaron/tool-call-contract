import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Finding, InitReportMetadata } from "../reporting.js";

export interface InitProjectOptions {
  cwd: string;
  dryRun: boolean;
  force: boolean;
}

export interface InitProjectResult {
  findings: Finding[];
  init: InitReportMetadata;
}

export type InitFileAction = InitReportMetadata["files"][number]["action"];

export interface PlannedInitFile {
  path: string;
  absolutePath: string;
  content: string;
  action: InitFileAction;
  reason?: string;
}

export interface PlannedPackageScript {
  name: string;
  value: string;
  action: InitFileAction;
  reason?: string;
}

export interface InitPlan extends InitProjectResult {
  fileWrites: PlannedInitFile[];
  packageScripts: PlannedPackageScript[];
  packageJson?: PlannedPackageJson;
}

export interface PlannedPackageJson {
  path: string;
  absolutePath: string;
  content: string;
  action: "created" | "updated" | "skipped";
  reason?: string;
}

interface InitFileTemplate {
  path: string;
  content: string;
}

interface PlanInitProjectOptionsForTests extends InitProjectOptions {
  templates?: readonly InitFileTemplate[];
}

export const defaultInitPackageScripts: Record<string, string> = {
  "tool-contracts:check": "tool-call-contract check",
  "tool-contracts:generate": "tool-call-contract generate",
  "tool-contracts:normalize":
    "tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression",
  "tool-contracts:normalize:check":
    "tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression --check",
  "tool-contracts:redact": "tool-call-contract redact --check --suite regression",
  "tool-contracts:validate": "tool-call-contract validate --suite regression",
  "tool-contracts:tests": "tool-call-contract generate-tests --suite regression",
};

export async function planInitProject(options: InitProjectOptions): Promise<InitPlan>;
export async function planInitProject(
  options: PlanInitProjectOptionsForTests,
  marker: typeof planInitProjectTestMarker,
): Promise<InitPlan>;
export async function planInitProject(
  options: InitProjectOptions | PlanInitProjectOptionsForTests,
  marker?: typeof planInitProjectTestMarker,
): Promise<InitPlan> {
  const cwd = path.resolve(options.cwd);
  const templates =
    marker === planInitProjectTestMarker && "templates" in options && options.templates
      ? options.templates
      : defaultInitFileTemplates;
  const filePlan = await planInitFiles(cwd, templates, options.force);
  const packagePlan = await planInitPackageScripts(cwd, options.force);
  const findings = [...filePlan.findings, ...packagePlan.findings];
  const packageScripts = packagePlan.scripts;

  return {
    fileWrites: filePlan.files,
    packageScripts,
    packageJson: packagePlan.packageJson,
    findings,
    init: {
      dryRun: options.dryRun,
      force: options.force,
      files: filePlan.files.map(({ path: filePath, action, reason }) => ({
        path: filePath,
        action,
        ...(reason ? { reason } : {}),
      })),
      packageScripts: packageScripts.map(({ name, action, reason }) => ({
        name,
        action,
        ...(reason ? { reason } : {}),
      })),
    },
  };
}

export async function writeInitPlan(plan: InitPlan): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const file of plan.fileWrites) {
    if (file.action === "skipped") {
      continue;
    }

    try {
      await mkdir(path.dirname(file.absolutePath), { recursive: true });
      await writeFile(file.absolutePath, file.content, "utf8");
    } catch (error) {
      findings.push(createWriteFailedFinding(file.path, error));
    }
  }

  if (plan.packageJson && plan.packageJson.action !== "skipped") {
    try {
      await writeFile(plan.packageJson.absolutePath, plan.packageJson.content, "utf8");
    } catch (error) {
      findings.push(createWriteFailedFinding(plan.packageJson.path, error));
    }
  }

  return findings;
}

export const planInitProjectTestMarker = Symbol("planInitProjectTestMarker");

const defaultInitFileTemplates: InitFileTemplate[] = [
  {
    path: "tool-call-contract.config.ts",
    content: `import { z } from "zod";
import { defineConfig, defineToolContract } from "tool-call-contract";

const searchKnowledgeBase = defineToolContract({
  name: "search_knowledge_base",
  description: "Search internal product documentation for a user question.",
  input: z.object({
    query: z.string().min(1),
    product: z.enum(["billing", "analytics", "platform"]),
    limit: z.number().int().min(1).max(10).default(5),
  }),
});

export default defineConfig({
  contracts: [searchKnowledgeBase],
  captures: {
    raw: ["captures/raw/*.json"],
    regression: ["captures/regression/*.json"],
  },
  redaction: {
    paths: ["arguments.email", "metadata.authorization"],
  },
});
`,
  },
  {
    path: "captures/raw/openai-responses.json",
    content: `${JSON.stringify(
      {
        id: "resp_example_001",
        output: [
          {
            type: "function_call",
            call_id: "call_search",
            name: "search_knowledge_base",
            arguments: '{"query":"billing exports","product":"billing","limit":2}',
          },
        ],
      },
      null,
      2,
    )}\n`,
  },
  {
    path: "captures/regression/openai-responses.json",
    content: `${JSON.stringify(
      {
        arguments: {
          limit: 2,
          product: "billing",
          query: "billing exports",
        },
        name: "search_knowledge_base",
      },
      null,
      2,
    )}\n`,
  },
];

async function planInitFiles(
  cwd: string,
  templates: readonly InitFileTemplate[],
  force: boolean,
): Promise<{ files: PlannedInitFile[]; findings: Finding[] }> {
  const files: PlannedInitFile[] = [];
  const findings: Finding[] = [];

  for (const template of templates) {
    const resolved = resolveProjectPath(cwd, template.path);

    if (!resolved.ok) {
      findings.push(createPathOutsideRootFinding(template.path));
      continue;
    }

    const existing = await readExistingFile(resolved.absolutePath);

    if (!existing.ok) {
      findings.push(createWriteFailedFinding(template.path, existing.error));
      continue;
    }

    const action = resolveInitFileAction(existing.content, template.content, force);
    files.push({
      path: template.path,
      absolutePath: resolved.absolutePath,
      content: template.content,
      action: action.action,
      ...(action.reason ? { reason: action.reason } : {}),
    });
  }

  return {
    files,
    findings,
  };
}

async function planInitPackageScripts(
  cwd: string,
  force: boolean,
): Promise<{
  scripts: PlannedPackageScript[];
  packageJson?: PlannedPackageJson;
  findings: Finding[];
}> {
  const packageJsonPath = "package.json";
  const resolved = resolveProjectPath(cwd, packageJsonPath);

  if (!resolved.ok) {
    return {
      scripts: createSkippedPackageScripts("package.json path is outside the project root"),
      findings: [createPathOutsideRootFinding(packageJsonPath)],
    };
  }

  const existing = await readExistingFile(resolved.absolutePath);

  if (!existing.ok) {
    return {
      scripts: [],
      findings: [createWriteFailedFinding(packageJsonPath, existing.error)],
    };
  }

  if (existing.content === undefined) {
    return {
      scripts: createSkippedPackageScripts("package.json was not found"),
      findings: [],
    };
  }

  const parsed = parsePackageJson(existing.content);

  if (!parsed.ok) {
    return {
      scripts: createSkippedPackageScripts("package.json is malformed"),
      findings: [
        {
          id: "init.package-json-invalid",
          severity: "error",
          title: "package.json could not be parsed",
          message: `Could not parse package.json: ${parsed.message}`,
          impact: "Package scripts were not planned.",
          suggestion: "Fix package.json and run tool-call-contract init again.",
          file: packageJsonPath,
        },
      ],
    };
  }

  const packageJson = parsed.value;
  const currentScripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const nextScripts: Record<string, unknown> = { ...currentScripts };
  const scripts: PlannedPackageScript[] = [];
  let changed = false;

  for (const [name, value] of Object.entries(defaultInitPackageScripts)) {
    const existingScript = currentScripts[name];

    if (existingScript === undefined) {
      nextScripts[name] = value;
      changed = true;
      scripts.push({
        name,
        value,
        action: "created",
      });
      continue;
    }

    if (force && existingScript !== value) {
      nextScripts[name] = value;
      changed = true;
      scripts.push({
        name,
        value,
        action: "updated",
      });
      continue;
    }

    scripts.push({
      name,
      value,
      action: "skipped",
      reason:
        existingScript === value
          ? "script already exists"
          : "script already exists with different content",
    });
  }

  if (!changed) {
    return {
      scripts,
      packageJson: {
        path: packageJsonPath,
        absolutePath: resolved.absolutePath,
        content: existing.content,
        action: "skipped",
        reason: "package scripts already exist",
      },
      findings: [],
    };
  }

  return {
    scripts,
    packageJson: {
      path: packageJsonPath,
      absolutePath: resolved.absolutePath,
      content: formatPackageJson({
        ...packageJson,
        scripts: nextScripts,
      }),
      action: "updated",
    },
    findings: [],
  };
}

function resolveInitFileAction(
  existingContent: string | undefined,
  plannedContent: string,
  force: boolean,
): { action: InitFileAction; reason?: string } {
  if (existingContent === undefined) {
    return {
      action: "created",
    };
  }

  if (existingContent === plannedContent) {
    return {
      action: "skipped",
      reason: "file already exists",
    };
  }

  if (force) {
    return {
      action: "updated",
    };
  }

  return {
    action: "skipped",
    reason: "file already exists with different content",
  };
}

function createSkippedPackageScripts(reason: string): PlannedPackageScript[] {
  return Object.entries(defaultInitPackageScripts).map(([name, value]) => ({
    name,
    value,
    action: "skipped" as const,
    reason,
  }));
}

function parsePackageJson(
  content: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const value = JSON.parse(content) as unknown;

    if (!isRecord(value)) {
      return {
        ok: false,
        message: "package.json root must be an object.",
      };
    }

    return {
      ok: true,
      value,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unknown JSON parse error.",
    };
  }
}

async function readExistingFile(
  absolutePath: string,
): Promise<{ ok: true; content?: string } | { ok: false; error: unknown }> {
  try {
    return {
      ok: true,
      content: await readFile(absolutePath, "utf8"),
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        ok: true,
      };
    }

    return {
      ok: false,
      error,
    };
  }
}

function resolveProjectPath(
  cwd: string,
  relativePath: string,
): { ok: true; absolutePath: string } | { ok: false } {
  const normalizedPath = relativePath.replaceAll("\\", path.sep);

  if (path.isAbsolute(normalizedPath)) {
    return {
      ok: false,
    };
  }

  const root = path.resolve(cwd);
  const absolutePath = path.resolve(root, normalizedPath);

  if (!isPathInside(absolutePath, root)) {
    return {
      ok: false,
    };
  }

  return {
    ok: true,
    absolutePath,
  };
}

function formatPackageJson(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function createPathOutsideRootFinding(file: string): Finding {
  return {
    id: "init.path-outside-root",
    severity: "error",
    title: "Init path escapes the project root",
    message: `Init path "${file}" does not stay inside the project root.`,
    impact: "The file was not planned.",
    suggestion: "Run init from the project root and report this as a bug if it persists.",
    file,
  };
}

function createWriteFailedFinding(file: string, error: unknown): Finding {
  return {
    id: "init.write-failed",
    severity: "error",
    title: "Init file could not be read",
    message: `Could not inspect "${file}": ${formatErrorMessage(error)}`,
    impact: "The init plan may be incomplete.",
    suggestion: "Check file and directory permissions before running init again.",
    file,
  };
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown file system error.";
}

function isPathInside(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
