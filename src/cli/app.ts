import {
  createCommandReport,
  createValidationReportMetadata,
  hasBlockingFailures,
  renderHumanReport,
  renderJsonReport,
  type CommandName,
  type CommandReport,
} from "../reporting.js";
import path from "node:path";

import { generateArtifacts } from "../artifacts.js";
import {
  collectArtifactFreshnessFindings,
  loadArtifactManifest,
  planArtifactWrites,
  writeArtifactPlan,
} from "../artifact-writer.js";
import { resolveCaptureFiles } from "../captures.js";
import { runContractChecks } from "../checks.js";
import { ConfigLoadError, loadConfig } from "../config.js";
import { createContractRegistry } from "../registry.js";
import type { Finding } from "../reporting.js";
import { analyzeRegistrySchemas } from "../schema.js";
import { generateTests } from "./generate-tests.js";
import { redactCaptureFiles } from "./redact.js";
import { validateCaptureFiles } from "./validate.js";

export const cliHelpText = `tool-call-contract

Define AI tool contracts once, then validate calls and generate test artifacts.

Usage:
  tool-call-contract <command> [options]

Commands:
  check                 Validate configured tool contracts
  generate              Generate fixtures, schemas, docs, and manifest
  validate <files...>   Validate captured tool-call JSON files
  redact <files...>     Redact captured tool-call JSON files
  generate-tests        Generate Vitest regression tests for captures

Options:
  -h, --help            Show help
  -v, --version         Show version
      --cwd <path>      Run from a different working directory
      --config <path>   Load a specific config file
      --json            Print JSON output
      --suite <name>    Include a configured capture suite
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface CliOptions {
  cwd?: string;
  config?: string;
  json: boolean;
  strict: boolean;
  ignore: string[];
  dryRun: boolean;
  clean: boolean;
  check: boolean;
  out?: string;
  outDir?: string;
  allowUnknown: boolean;
  suites: string[];
}

export interface ParsedCliCommand {
  command: CommandName;
  options: CliOptions;
  files: string[];
}

export type CliRunResult =
  | {
      kind: "output";
      exitCode: 0;
      text: string;
    }
  | {
      kind: "success";
      exitCode: 0 | 1 | 2;
      report: CommandReport;
      json: boolean;
    }
  | {
      kind: "usage";
      exitCode: 2;
      message: string;
    };

const defaultOptions: CliOptions = {
  json: false,
  strict: false,
  ignore: [],
  dryRun: false,
  clean: false,
  check: false,
  allowUnknown: false,
  suites: [],
};

export async function runCli(args: readonly string[], io: CliIo = consoleIo): Promise<number> {
  try {
    const result = await runCliCommand(args);

    if (result.kind === "output") {
      io.stdout(result.text);
      return result.exitCode;
    }

    if (result.kind === "usage") {
      io.stderr(`${result.message}\n`);
      return result.exitCode;
    }

    io.stdout(result.json ? renderJsonReport(result.report) : renderHumanReport(result.report));
    return result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected internal error.";
    io.stderr(`Internal error: ${message}\n`);
    return 3;
  }
}

export async function runCliCommand(args: readonly string[]): Promise<CliRunResult> {
  if (args.includes("--version") || args.includes("-v")) {
    return {
      kind: "output",
      exitCode: 0,
      text: "0.1.1\n",
    };
  }

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return {
      kind: "output",
      exitCode: 0,
      text: cliHelpText,
    };
  }

  const parsed = parseCliArgs(args);
  if ("message" in parsed) {
    return {
      kind: "usage",
      exitCode: 2,
      message: parsed.message,
    };
  }

  const report = await createCommandReportForParsedInput(parsed);

  return {
    kind: "success",
    exitCode: resolveExitCode(report),
    report,
    json: parsed.options.json,
  };
}

export function parseCliArgs(args: readonly string[]): ParsedCliCommand | { message: string } {
  const [commandToken, ...rest] = args;

  if (!isCommandName(commandToken)) {
    return {
      message: commandToken
        ? `Unknown command "${commandToken}". Run tool-call-contract --help for usage.`
        : cliHelpText.trimEnd(),
    };
  }

  const options: CliOptions = { ...defaultOptions, ignore: [], suites: [] };
  const files: string[] = [];
  let collectIgnore = false;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (!arg) {
      continue;
    }

    if (collectIgnore && !arg.startsWith("-")) {
      options.ignore.push(arg);
      continue;
    }

    collectIgnore = false;

    switch (arg) {
      case "--cwd": {
        const value = readOptionValue(rest, index, arg);
        if ("message" in value) {
          return value;
        }
        options.cwd = value.value;
        index = value.index;
        break;
      }
      case "--config": {
        const value = readOptionValue(rest, index, arg);
        if ("message" in value) {
          return value;
        }
        options.config = value.value;
        index = value.index;
        break;
      }
      case "--out-dir": {
        const value = readOptionValue(rest, index, arg);
        if ("message" in value) {
          return value;
        }
        options.outDir = value.value;
        index = value.index;
        break;
      }
      case "--out": {
        const value = readOptionValue(rest, index, arg);
        if ("message" in value) {
          return value;
        }
        options.out = value.value;
        index = value.index;
        break;
      }
      case "--json":
        options.json = true;
        break;
      case "--strict":
        options.strict = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--clean":
        options.clean = true;
        break;
      case "--check":
        options.check = true;
        break;
      case "--allow-unknown":
        options.allowUnknown = true;
        break;
      case "--suite": {
        const value = readOptionValue(rest, index, arg);
        if ("message" in value) {
          return value;
        }
        options.suites.push(value.value);
        index = value.index;
        break;
      }
      case "--ignore": {
        const value = readOptionValue(rest, index, arg);
        if ("message" in value) {
          return value;
        }
        options.ignore.push(value.value);
        index = value.index;
        collectIgnore = true;
        break;
      }
      default:
        if (arg.startsWith("-")) {
          return {
            message: `Unknown option "${arg}".`,
          };
        }
        files.push(arg);
        break;
    }
  }

  if (commandToken === "validate" && files.length === 0 && options.suites.length === 0) {
    return {
      message: "validate requires at least one file or --suite.",
    };
  }

  if (commandToken === "redact") {
    const usage = validateRedactUsage(files, options);
    if (usage) {
      return usage;
    }
  }

  if (commandToken === "generate-tests") {
    const usage = validateGenerateTestsUsage(files);
    if (usage) {
      return usage;
    }
  }

  return {
    command: commandToken,
    options,
    files,
  };
}

async function createCommandReportForParsedInput(parsed: ParsedCliCommand): Promise<CommandReport> {
  try {
    const loaded = await loadConfig({
      cwd: parsed.options.cwd,
      configPath: parsed.options.config,
      outDir: parsed.options.outDir,
    });
    const { registry, findings: registryFindings } = createContractRegistry(loaded.config);
    const roots = {
      cwd: loaded.cwd,
      outDir: loaded.outDir,
    };

    if (parsed.command === "generate") {
      const generation = generateArtifacts(registry, {
        outDir: path.relative(loaded.cwd, loaded.outDir),
      });
      const previousManifest = parsed.options.clean
        ? await loadArtifactManifest(roots)
        : { findings: [] };
      const plan = await planArtifactWrites(generation.artifacts, roots, {
        clean: parsed.options.clean,
        previousManifest: previousManifest.manifest,
      });
      const preWriteFindings = applyFindingPolicy(
        [
          ...registryFindings,
          ...generation.findings,
          ...previousManifest.findings,
          ...plan.findings,
        ],
        parsed.options,
      );
      const writeFindings =
        parsed.options.dryRun || hasErrorFindings(preWriteFindings)
          ? []
          : await writeArtifactPlan(plan);
      const findings = applyFindingPolicy([...preWriteFindings, ...writeFindings], parsed.options);

      return createCommandReport({
        command: parsed.command,
        findings,
        artifacts: plan.artifacts,
      });
    }

    if (parsed.command === "validate") {
      const captures = await resolveCaptureFiles({
        cwd: loaded.cwd,
        captures: loaded.config.captures,
        suites: parsed.options.suites,
        files: parsed.files,
      });
      const validation = await validateCaptureFiles(registry, {
        cwd: loaded.cwd,
        files: captures.files.map((file) => file.path),
        allowUnknown: parsed.options.allowUnknown,
      });
      const findings = applyFindingPolicy(
        [...registryFindings, ...captures.findings, ...validation.findings],
        parsed.options,
      );

      return createCommandReport({
        command: parsed.command,
        findings,
        results: validation.results,
        validation: createValidationReportMetadata({
          suites: parsed.options.suites,
          files: captures.files,
          results: validation.results,
        }),
      });
    }

    if (parsed.command === "redact") {
      const captures = await resolveCaptureFiles({
        cwd: loaded.cwd,
        captures: loaded.config.captures,
        suites: parsed.options.suites,
        files: parsed.files,
      });
      const redaction = await redactCaptureFiles({
        cwd: loaded.cwd,
        files: captures.files,
        redaction: loaded.config.redaction,
        check: parsed.options.check,
        dryRun: parsed.options.dryRun,
        out: parsed.options.out,
        outDir: parsed.options.outDir,
      });
      const findings = applyFindingPolicy(
        [...captures.findings, ...redaction.findings],
        parsed.options,
      );

      return createCommandReport({
        command: parsed.command,
        findings,
        redaction: redaction.redaction,
      });
    }

    if (parsed.command === "generate-tests") {
      const generatedTests = await generateTests({
        cwd: loaded.cwd,
        configPath: loaded.configPath,
        captures: loaded.config.captures,
        suites: parsed.options.suites,
        out: parsed.options.out,
        dryRun: parsed.options.dryRun,
      });
      const findings = applyFindingPolicy(
        [...registryFindings, ...generatedTests.findings],
        parsed.options,
      );

      return createCommandReport({
        command: parsed.command,
        findings,
        generatedTests: generatedTests.generatedTests,
      });
    }

    const artifactFindings =
      parsed.command === "check" ? await createArtifactFreshnessFindings(registry, roots) : [];
    const checkFindings =
      parsed.command === "check"
        ? [
            ...runContractChecks(registry),
            ...analyzeRegistrySchemas(registry).flatMap((analysis) => analysis.findings),
            ...artifactFindings,
          ]
        : [];
    const findings = applyFindingPolicy([...registryFindings, ...checkFindings], parsed.options);

    return createCommandReport({
      command: parsed.command,
      findings,
    });
  } catch (error) {
    if (error instanceof ConfigLoadError) {
      return createCommandReport({
        command: parsed.command,
        findings: [
          {
            id: error.code,
            severity: "error",
            title: "Config could not be loaded",
            message: error.message,
            suggestion: "Create a valid tool-call-contract config or pass --config.",
          },
        ],
        success: false,
        artifacts: parsed.command === "generate" ? emptyArtifactReport() : undefined,
      });
    }

    throw error;
  }
}

async function createArtifactFreshnessFindings(
  registry: ReturnType<typeof createContractRegistry>["registry"],
  roots: { cwd: string; outDir: string },
): Promise<Finding[]> {
  const previousManifest = await loadArtifactManifest(roots);

  if (!previousManifest.manifest) {
    return previousManifest.findings;
  }

  const generation = generateArtifacts(registry, {
    outDir: path.relative(roots.cwd, roots.outDir),
  });
  const plan = await planArtifactWrites(generation.artifacts, roots);

  return [
    ...previousManifest.findings,
    ...plan.findings,
    ...collectArtifactFreshnessFindings(plan),
  ];
}

function hasErrorFindings(findings: readonly Finding[]): boolean {
  return findings.some((finding) => finding.severity === "error");
}

function emptyArtifactReport(): NonNullable<CommandReport["artifacts"]> {
  return {
    created: [],
    updated: [],
    unchanged: [],
    deleted: [],
  };
}

function applyFindingPolicy(findings: readonly Finding[], options: CliOptions): Finding[] {
  const ignored = new Set(options.ignore);

  return findings
    .filter((finding) => !ignored.has(finding.id))
    .map((finding) =>
      options.strict && finding.severity === "warning"
        ? {
            ...finding,
            severity: "error" as const,
          }
        : finding,
    );
}

function configFailureExitCode(report: CommandReport): 1 | 2 {
  if (report.findings?.some((finding) => finding.id.startsWith("config."))) {
    return 2;
  }

  return 1;
}

function resolveExitCode(report: CommandReport): 0 | 1 | 2 {
  if (!hasBlockingFailures(report)) {
    return 0;
  }

  return configFailureExitCode(report);
}

function readOptionValue(
  args: readonly string[],
  index: number,
  option: string,
): { value: string; index: number } | { message: string } {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    return {
      message: `${option} requires a value.`,
    };
  }

  return {
    value,
    index: index + 1,
  };
}

function isCommandName(value: unknown): value is CommandName {
  return (
    value === "check" ||
    value === "generate" ||
    value === "validate" ||
    value === "redact" ||
    value === "generate-tests"
  );
}

function validateRedactUsage(
  files: readonly string[],
  options: CliOptions,
): { message: string } | undefined {
  if (files.length === 0 && options.suites.length === 0) {
    return {
      message: "redact requires at least one file or --suite.",
    };
  }

  if (options.out && options.outDir) {
    return {
      message: "--out and --out-dir cannot be used together.",
    };
  }

  if (options.check && (options.out || options.outDir)) {
    return {
      message: "--check cannot be used with --out or --out-dir.",
    };
  }

  if (options.out && (files.length !== 1 || options.suites.length > 0)) {
    return {
      message: "--out requires exactly one direct file.",
    };
  }

  return undefined;
}

function validateGenerateTestsUsage(files: readonly string[]): { message: string } | undefined {
  if (files.length > 0) {
    return {
      message: "generate-tests does not accept file arguments.",
    };
  }

  return undefined;
}

const consoleIo: CliIo = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};
