import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createJiti } from "jiti";

import type { ToolCallContractConfig, ToolContract } from "./contracts.js";

export const defaultConfigFiles = [
  "tool-call-contract.config.ts",
  "tool-call-contract.config.mts",
  "tool-call-contract.config.js",
  "tool-call-contract.config.mjs",
] as const;

export interface LoadedConfig {
  cwd: string;
  configPath: string;
  outDir: string;
  config: ToolCallContractConfig;
}

export class ConfigLoadError extends Error {
  readonly code:
    | "config.not-found"
    | "config.load-failed"
    | "config.invalid"
    | "config.out-dir-escapes-root";

  constructor(
    code: ConfigLoadError["code"],
    message: string,
    options?: {
      cause?: unknown;
    },
  ) {
    super(message, options);
    this.name = "ConfigLoadError";
    this.code = code;
  }
}

export async function loadConfig(options: {
  cwd?: string;
  configPath?: string;
  outDir?: string;
}): Promise<LoadedConfig> {
  const cwd = await resolveCwd(options.cwd);
  const configPath = await resolveConfigPath(cwd, options.configPath);
  const rawConfig = await importConfig(configPath);
  const config = normalizeConfig(rawConfig);
  const outDir = resolveOutDir(cwd, options.outDir ?? config.outDir ?? ".tool-call-contract");

  return {
    cwd,
    configPath,
    outDir,
    config: {
      ...config,
      outDir,
    },
  };
}

async function resolveCwd(cwd?: string): Promise<string> {
  const resolved = path.resolve(cwd ?? process.cwd());
  return realpath(resolved);
}

async function resolveConfigPath(cwd: string, configPath?: string): Promise<string> {
  if (configPath) {
    const resolved = path.resolve(cwd, configPath);
    await assertFileExists(resolved, `Config file not found: ${resolved}`);
    return resolved;
  }

  for (const file of defaultConfigFiles) {
    const candidate = path.join(cwd, file);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new ConfigLoadError("config.not-found", `No tool-call-contract config found in ${cwd}.`);
}

async function importConfig(configPath: string): Promise<unknown> {
  try {
    const jiti = createJiti(import.meta.url, {
      moduleCache: false,
    });

    return await jiti.import(pathToFileURL(configPath).href, {
      default: true,
    });
  } catch (error) {
    throw new ConfigLoadError("config.load-failed", `Failed to load config: ${configPath}`, {
      cause: error,
    });
  }
}

function normalizeConfig(value: unknown): ToolCallContractConfig {
  if (!isRecord(value)) {
    throw new ConfigLoadError("config.invalid", "Config default export must be an object.");
  }

  if (!Array.isArray(value.contracts)) {
    throw new ConfigLoadError("config.invalid", 'Config field "contracts" must be an array.');
  }

  const contracts = value.contracts.map((contract, index) =>
    normalizeContract(contract, `contracts[${index}]`),
  );
  const outDir = optionalString(value.outDir, "outDir");
  const examples = normalizeExamples(value.examples);
  const include = optionalStringArray(value.include, "include");
  const exclude = optionalStringArray(value.exclude, "exclude");

  return {
    contracts,
    ...(outDir ? { outDir } : {}),
    ...(examples ? { examples } : {}),
    ...(include ? { include } : {}),
    ...(exclude ? { exclude } : {}),
  };
}

function normalizeContract(value: unknown, pathLabel: string): ToolContract {
  if (!isRecord(value)) {
    throw new ConfigLoadError("config.invalid", `${pathLabel} must be a tool contract object.`);
  }

  if (value.kind !== "tool-call-contract") {
    throw new ConfigLoadError(
      "config.invalid",
      `${pathLabel} must be created with defineToolContract().`,
    );
  }

  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    throw new ConfigLoadError("config.invalid", `${pathLabel}.name must be a non-empty string.`);
  }

  if (typeof value.description !== "string") {
    throw new ConfigLoadError("config.invalid", `${pathLabel}.description must be a string.`);
  }

  if (!isRecord(value.input) || typeof value.input.safeParse !== "function") {
    throw new ConfigLoadError("config.invalid", `${pathLabel}.input must be a Zod schema.`);
  }

  if (!Array.isArray(value.examples)) {
    throw new ConfigLoadError("config.invalid", `${pathLabel}.examples must be an array.`);
  }

  return value as unknown as ToolContract;
}

function normalizeExamples(value: unknown): Record<string, readonly unknown[]> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new ConfigLoadError("config.invalid", 'Config field "examples" must be an object.');
  }

  const examples: Record<string, readonly unknown[]> = {};

  for (const [name, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) {
      throw new ConfigLoadError(
        "config.invalid",
        `Config examples for "${name}" must be an array.`,
      );
    }

    examples[name] = entries;
  }

  return examples;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigLoadError("config.invalid", `Config field "${field}" must be a string.`);
  }

  return value;
}

function optionalStringArray(value: unknown, field: string): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ConfigLoadError(
      "config.invalid",
      `Config field "${field}" must be an array of strings.`,
    );
  }

  return value;
}

function resolveOutDir(cwd: string, outDir: string): string {
  const resolved = path.resolve(cwd, outDir);
  const relative = path.relative(cwd, resolved);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ConfigLoadError(
      "config.out-dir-escapes-root",
      `Configured outDir must stay inside the project root: ${outDir}`,
    );
  }

  return resolved;
}

async function assertFileExists(file: string, message: string): Promise<void> {
  if (!(await fileExists(file))) {
    throw new ConfigLoadError("config.not-found", message);
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
