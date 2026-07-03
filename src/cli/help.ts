import type { CommandName } from "../reporting.js";

export type HelpTopic = CommandName | "init";

export interface CommandHelp {
  command: HelpTopic;
  summary: string;
  usage: string[];
  options: Array<{
    flag: string;
    description: string;
  }>;
  examples: string[];
  notes?: string[];
}

export const globalHelpText = `tool-call-contract <command>

Define AI tool contracts once, then validate calls and generate test artifacts.

Commands:
  init                  Create a starter contract regression setup
  check                 Check contracts and generated artifact freshness
  generate              Generate fixtures, schemas, docs, and manifest
  validate <files...>   Validate captured tool-call JSON files
  redact <files...>     Redact captured tool-call JSON files
  normalize <files...>  Normalize raw tool-call traces into capture JSON
  generate-tests        Generate Vitest regression tests for captures

Global options:
  -h, --help            Show help
  -v, --version         Show version
      --cwd <path>      Run from a different working directory
      --config <path>   Load a specific config file
      --json            Print JSON output

Run tool-call-contract help <command> for command-specific examples.
`;

const commandHelps: Record<HelpTopic, CommandHelp> = {
  init: {
    command: "init",
    summary: "Create a starter contract regression setup.",
    usage: ["tool-call-contract init [options]"],
    options: [
      { flag: "--dry-run", description: "Preview files and scripts without writing them." },
      { flag: "--force", description: "Overwrite initializer-owned files and scripts." },
      { flag: "--json", description: "Print a machine-readable command report." },
      { flag: "--cwd <path>", description: "Initialize a project from a different directory." },
    ],
    examples: [
      "tool-call-contract init",
      "tool-call-contract init --dry-run",
      "tool-call-contract init --force --json",
    ],
    notes: [
      "Creates a small local regression setup with sample captures.",
      "Skips existing files and package scripts unless --force is passed.",
      "Does not capture production tool calls or contact an AI provider.",
    ],
  },
  check: {
    command: "check",
    summary: "Check contracts and generated artifact freshness.",
    usage: ["tool-call-contract check [options]"],
    options: [
      { flag: "--strict", description: "Treat warnings as errors." },
      { flag: "--ignore <id>", description: "Ignore a finding id. May be repeated." },
      { flag: "--json", description: "Print a machine-readable command report." },
      { flag: "--cwd <path>", description: "Run from a different working directory." },
      { flag: "--config <path>", description: "Load a specific config file." },
    ],
    examples: [
      "tool-call-contract check",
      "tool-call-contract check --strict",
      "tool-call-contract check --ignore contract.description-missing --json",
    ],
    notes: [
      "Loads configured contracts and reports schema, contract, and artifact freshness findings.",
      "Run in CI to ensure generated artifacts are current.",
    ],
  },
  generate: {
    command: "generate",
    summary: "Generate fixtures, schemas, docs, and manifest files.",
    usage: ["tool-call-contract generate [options]"],
    options: [
      { flag: "--dry-run", description: "Plan artifact changes without writing files." },
      { flag: "--clean", description: "Delete stale generated artifacts tracked by the manifest." },
      {
        flag: "--out-dir <path>",
        description: "Write generated artifacts under a custom directory.",
      },
      { flag: "--json", description: "Print a machine-readable command report." },
      { flag: "--cwd <path>", description: "Run from a different working directory." },
      { flag: "--config <path>", description: "Load a specific config file." },
    ],
    examples: [
      "tool-call-contract generate",
      "tool-call-contract generate --dry-run",
      "tool-call-contract generate --clean --out-dir artifacts/contracts",
    ],
    notes: [
      "Generated artifacts are deterministic and should be committed when they are part of the project contract surface.",
      "Use check in CI to catch stale generated output.",
    ],
  },
  validate: {
    command: "validate",
    summary: "Validate captured tool-call JSON files against configured contracts.",
    usage: [
      "tool-call-contract validate <files...> [options]",
      "tool-call-contract validate --suite <name> [options]",
    ],
    options: [
      {
        flag: "--suite <name>",
        description: "Validate files from a configured capture suite. May be repeated.",
      },
      {
        flag: "--allow-unknown",
        description: "Report unknown tool names without failing validation.",
      },
      { flag: "--json", description: "Print a machine-readable command report." },
      { flag: "--cwd <path>", description: "Run from a different working directory." },
      { flag: "--config <path>", description: "Load a specific config file." },
    ],
    examples: [
      "tool-call-contract validate captures/regression/search.json",
      "tool-call-contract validate --suite regression",
      "tool-call-contract validate --suite regression --allow-unknown --json",
    ],
    notes: [
      "Validates normalized captures and supported OpenAI-style tool-call shapes.",
      "Use redaction before committing captures that came from runtime traces.",
    ],
  },
  redact: {
    command: "redact",
    summary: "Redact captured tool-call JSON files with configured path rules.",
    usage: [
      "tool-call-contract redact <files...> [options]",
      "tool-call-contract redact --suite <name> [options]",
    ],
    options: [
      {
        flag: "--suite <name>",
        description: "Redact files from a configured capture suite. May be repeated.",
      },
      {
        flag: "--check",
        description: "Fail when files would change instead of writing redactions.",
      },
      { flag: "--dry-run", description: "Preview redactions without writing files." },
      { flag: "--out <path>", description: "Write a single direct input file to a destination." },
      {
        flag: "--out-dir <path>",
        description: "Write one redacted file per input under a destination directory.",
      },
      { flag: "--json", description: "Print a machine-readable command report." },
      { flag: "--cwd <path>", description: "Run from a different working directory." },
      { flag: "--config <path>", description: "Load a specific config file." },
    ],
    examples: [
      "tool-call-contract redact --suite regression",
      "tool-call-contract redact --suite regression --check",
      "tool-call-contract redact captures/raw.json --out captures/safe/raw.json",
    ],
    notes: [
      "Redaction uses explicit configured paths; it is not automatic PII detection.",
      "Use --check in CI after committing reviewed regression fixtures.",
    ],
  },
  normalize: {
    command: "normalize",
    summary: "Normalize raw tool-call traces into canonical capture JSON.",
    usage: [
      "tool-call-contract normalize <files...> --format <name> --out <path>",
      "tool-call-contract normalize --suite <name> --format <name> --out-dir <path>",
    ],
    options: [
      {
        flag: "--format <name>",
        description:
          "Input format: normalized, openai-chat, openai-responses, vercel-ai-sdk, langchain, or generic.",
      },
      {
        flag: "--suite <name>",
        description: "Normalize files from a configured capture suite. May be repeated.",
      },
      { flag: "--out <path>", description: "Write one direct input file to a destination." },
      {
        flag: "--out-dir <path>",
        description: "Write one normalized file per input under a destination directory.",
      },
      { flag: "--dry-run", description: "Preview normalization without writing files." },
      { flag: "--check", description: "Fail when destination files are missing or stale." },
      {
        flag: "--include-source",
        description: "Include stable source/id metadata in normalized output.",
      },
      { flag: "--json", description: "Print a machine-readable command report." },
      { flag: "--cwd <path>", description: "Run from a different working directory." },
      { flag: "--config <path>", description: "Load a specific config file." },
    ],
    examples: [
      "tool-call-contract normalize raw.json --format openai-responses --out captures/regression/raw.json",
      "tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression",
      "tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression --check",
    ],
    notes: [
      "Normalization converts selected raw traces into small regression fixtures.",
      "It does not capture runtime calls, store production telemetry, or redact secrets.",
    ],
  },
  "generate-tests": {
    command: "generate-tests",
    summary: "Generate Vitest regression tests for capture suites.",
    usage: ["tool-call-contract generate-tests [options]"],
    options: [
      {
        flag: "--suite <name>",
        description: "Generate tests for a configured capture suite. May be repeated.",
      },
      { flag: "--out <path>", description: "Write the generated test file to a custom path." },
      { flag: "--dry-run", description: "Preview generated test content without writing files." },
      { flag: "--json", description: "Print a machine-readable command report." },
      { flag: "--cwd <path>", description: "Run from a different working directory." },
      { flag: "--config <path>", description: "Load a specific config file." },
    ],
    examples: [
      "tool-call-contract generate-tests --suite regression",
      "tool-call-contract generate-tests --suite regression --out test/tool-call-contract.generated.test.ts",
      "tool-call-contract generate-tests --suite regression --dry-run",
    ],
    notes: [
      "Generated tests validate committed regression fixtures against configured contracts.",
      "Use --dry-run in CI when the generated file is not committed.",
    ],
  },
};

export const commandHelpEntries: readonly CommandHelp[] = Object.freeze(
  Object.values(commandHelps),
);

export function isHelpTopic(value: unknown): value is HelpTopic {
  return (
    value === "init" ||
    value === "check" ||
    value === "generate" ||
    value === "validate" ||
    value === "redact" ||
    value === "generate-tests" ||
    value === "normalize"
  );
}

export function renderCommandHelp(command: HelpTopic): string {
  const help = commandHelps[command];

  return [
    `tool-call-contract ${help.command}`,
    "",
    help.summary,
    "",
    "Usage:",
    ...help.usage.map((usage) => `  ${usage}`),
    "",
    "Options:",
    ...help.options.map((option) => `  ${option.flag.padEnd(20)} ${option.description}`),
    "",
    "Examples:",
    ...help.examples.map((example) => `  ${example}`),
    ...(help.notes && help.notes.length > 0
      ? ["", "Notes:", ...help.notes.map((note) => `  ${note}`)]
      : []),
    "",
  ].join("\n");
}
