#!/usr/bin/env node

const helpText = `tool-call-contract

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
`;

function main(args: string[]): number {
  if (args.includes("--version") || args.includes("-v")) {
    console.log("0.0.0");
    return 0;
  }

  console.log(helpText);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
