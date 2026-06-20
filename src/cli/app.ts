import {
  createCommandReport,
  hasBlockingFailures,
  renderHumanReport,
  renderJsonReport,
  type CommandName,
  type CommandReport,
} from "../reporting.js";

export const cliHelpText = `tool-call-contract

Define AI tool contracts once, then validate calls and generate test artifacts.

Usage:
  tool-call-contract <command> [options]

Commands:
  check                 Validate configured tool contracts
  generate              Generate fixtures, schemas, docs, and manifest
  validate <files...>   Validate captured tool-call JSON files

Options:
  -h, --help            Show help
  -v, --version         Show version
      --cwd <path>      Run from a different working directory
      --config <path>   Load a specific config file
      --json            Print JSON output
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
  outDir?: string;
  allowUnknown: boolean;
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
      exitCode: 0 | 1;
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
  allowUnknown: false,
};

export function runCli(args: readonly string[], io: CliIo = consoleIo): number {
  try {
    const result = runCliCommand(args);

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

export function runCliCommand(args: readonly string[]): CliRunResult {
  if (args.includes("--version") || args.includes("-v")) {
    return {
      kind: "output",
      exitCode: 0,
      text: "0.0.0\n",
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

  const report = createPlaceholderReport(parsed);

  return {
    kind: "success",
    exitCode: hasBlockingFailures(report) ? 1 : 0,
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

  const options: CliOptions = { ...defaultOptions, ignore: [] };
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
      case "--allow-unknown":
        options.allowUnknown = true;
        break;
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

  if (commandToken === "validate" && files.length === 0) {
    return {
      message: "validate requires at least one file.",
    };
  }

  return {
    command: commandToken,
    options,
    files,
  };
}

function createPlaceholderReport(parsed: ParsedCliCommand): CommandReport {
  return createCommandReport({
    command: parsed.command,
    success: true,
    artifacts:
      parsed.command === "generate"
        ? {
            created: [],
            updated: [],
            unchanged: [],
            deleted: [],
          }
        : undefined,
  });
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
  return value === "check" || value === "generate" || value === "validate";
}

const consoleIo: CliIo = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};
