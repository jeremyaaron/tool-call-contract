# tool-call-contract v0.4.0 Technical Design

## Overview

`tool-call-contract` v0.4.0 improves adoption and operability for the v0.3 regression
workflow.

The package already has the core primitives:

- contracts,
- generated artifacts,
- capture suites,
- validation,
- redaction,
- normalization,
- and generated regression tests.

v0.4.0 should make those primitives easier to discover and bootstrap. The implementation
should stay local, deterministic, and small:

- no production trace storage,
- no live provider calls,
- no framework runtime dependencies,
- no runtime instrumentation package,
- and no hosted integrations.

The design adds:

- command-specific help,
- an `init` command,
- agent-facing procedural docs,
- framework capture cookbooks,
- clearer terminology around traces, captures, and fixtures,
- and `pkg-guard` experimental diagnostics dogfooding in verification.

## Design Decisions

The v0.4.0 PRD left several choices open. This design resolves them as follows.

| Question                     | Decision                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init --dry-run`             | Ship it in v0.4.0. Bootstrap writes are exactly the kind of operation users should be able to preview.                                               |
| Package script updates       | Update package scripts by default when `package.json` exists. Skip existing script names unless `--force` is passed.                                 |
| Config file type             | Generate `tool-call-contract.config.ts`. The package is TypeScript-first, existing docs use TS, and config loading already supports it.              |
| Generated test file          | Do not write `test/tool-call-contract.generated.test.ts` in `init`. Add the package script and next-step output; `generate-tests` owns writes.       |
| Existing file conflicts      | Skip conflicting files by default and report them. `--force` overwrites only the files/scripts the initializer owns.                                 |
| Command help implementation  | Add a structured command help registry in CLI code. Global help remains short; command help owns examples and full option details.                   |
| `help` command               | Support `tool-call-contract help <command>` as an output-only alias. It is not a report-producing command and does not require config loading.       |
| Agent guide location         | Add root `AGENTS.md` for discoverability. Link it from README.                                                                                       |
| Cookbook location            | Add provider docs under `docs/cookbooks/`. Keep examples synthetic and network-free.                                                                 |
| CI recommendation            | Recommend `check`, `normalize --check`, `redact --check`, `validate`, and `generate-tests --dry-run`. `generate --dry-run` is optional local review. |
| `pkg-guard` diagnostics mode | Run `mode: "fast"` through the experimental API. Keep `pkg-guard check` in `pack:check` for stable default/release package checks.                   |
| `pkg-guard` product coupling | Keep diagnostics dogfooding in scripts only. Do not expose package diagnostics through `tool-call-contract` CLI or public API.                       |
| Capture terminology changes  | Treat as documentation-only in v0.4.0. Do not rename CLI options, config fields, or report fields.                                                   |

## Runtime And Dependencies

Runtime targets remain unchanged:

- Node.js 20 or newer.
- TypeScript 5.5 or newer.
- Zod 4 as a peer dependency.

Runtime dependencies should remain unchanged.

Development dependencies should change:

```json
{
  "devDependencies": {
    "pkg-guard": "^0.5.0"
  }
}
```

`pkg-guard` stays a dev dependency. The experimental diagnostics API is used only by a
repository verification script.

## CLI Architecture

### Command Set

Extend command recognition with `init`.

```ts
export type CommandName =
  | "check"
  | "generate"
  | "validate"
  | "redact"
  | "generate-tests"
  | "normalize"
  | "init";
```

`help` is intentionally not a `CommandName`. It is handled before normal command parsing
and returns `CliRunResult.kind === "output"`.

### Help Routing

Current behavior treats any `--help` anywhere as global help. v0.4.0 should change help
routing to:

```text
tool-call-contract --help              -> global help
tool-call-contract -h                  -> global help
tool-call-contract help                -> global help
tool-call-contract help normalize      -> normalize help
tool-call-contract normalize --help    -> normalize help
tool-call-contract normalize -h        -> normalize help
```

Unknown help topics should be usage errors:

```text
Unknown help topic "nope". Run tool-call-contract --help for commands.
```

Command-specific help does not load config and never mutates files.

### Help Registry

Add a small structured registry in `src/cli/help.ts` or `src/cli/app.ts`.

Preferred module:

```text
src/cli/help.ts
```

Suggested shape:

```ts
export interface CommandHelp {
  command: string;
  summary: string;
  usage: string[];
  options: Array<{
    flag: string;
    description: string;
  }>;
  examples: string[];
  notes?: string[];
}

export const globalHelpText: string;
export function renderCommandHelp(command: CommandName): string;
export function isHelpTopic(value: string): value is CommandName;
```

Help text can be rendered from structured data or stored as stable strings. The registry
should be easy to test and update. It should not depend on config loading, filesystem
state, or package metadata beyond the hardcoded CLI version already used by `--version`.

### Command Help Content

Global help should remain concise:

```text
tool-call-contract <command>

Commands:
  init                  Create a starter contract regression setup
  check                 Check contracts and generated artifact freshness
  generate              Generate fixtures, schemas, docs, and manifest
  validate <files...>   Validate captured tool-call JSON files
  redact <files...>     Redact captured tool-call JSON files
  normalize <files...>  Normalize raw tool-call traces into capture JSON
  generate-tests        Generate Vitest regression tests for captures

Run tool-call-contract help <command> for command-specific examples.
```

Each command help page should include enough options for a coding agent to integrate the
package without reading the README.

Required option coverage:

- `check`: `--strict`, `--ignore`, `--json`, `--cwd`, `--config`.
- `generate`: `--dry-run`, `--clean`, `--out-dir`, `--json`.
- `validate`: `--suite`, `--allow-unknown`, `--json`.
- `redact`: `--suite`, `--check`, `--dry-run`, `--out`, `--out-dir`, `--json`.
- `normalize`: `--format`, `--suite`, `--out`, `--out-dir`, `--dry-run`, `--check`,
  `--include-source`, `--json`.
- `generate-tests`: `--suite`, `--out`, `--dry-run`, `--json`.
- `init`: `--dry-run`, `--force`, `--json`, `--cwd`.

### Parser Changes

Add `force` to `CliOptions`.

```ts
export interface CliOptions {
  // existing fields...
  force: boolean;
}
```

Parse `--force` globally but validate it as only meaningful for `init`:

- `init --force` is valid.
- other commands with `--force` should return a usage error:

```text
--force can only be used with init.
```

Alternatively, parse `--force` only when command is `init`. The implementation plan can
choose either path. The user-facing behavior should be deterministic and tested.

`init` accepts no file arguments:

```text
init does not accept file arguments.
```

`init --dry-run --json` should return a JSON command report without writing files.

## Init Design

### Module

Add:

```text
src/cli/init.ts
```

This module owns init planning and writes. It should not load
`tool-call-contract.config.ts`; it operates on project files only.

Suggested public-internal types:

```ts
export interface InitProjectOptions {
  cwd: string;
  dryRun: boolean;
  force: boolean;
}

export interface InitProjectResult {
  findings: Finding[];
  init: InitReportMetadata;
}
```

`InitReportMetadata` should live in `src/reporting.ts`.

```ts
export interface InitReportMetadata {
  dryRun: boolean;
  force: boolean;
  files: Array<{
    path: string;
    action: "created" | "updated" | "skipped";
    reason?: string;
  }>;
  packageScripts: Array<{
    name: string;
    action: "created" | "updated" | "skipped";
    reason?: string;
  }>;
}
```

Add optional `init?: InitReportMetadata` to `CommandReport`.

Report schema stays `schemaVersion: 1`.

### Write Plan

Build the initializer as a side-effect-free plan plus writer:

```ts
interface InitPlan {
  fileWrites: PlannedInitFile[];
  packageScripts: PlannedPackageScript[];
  findings: Finding[];
  init: InitReportMetadata;
}

interface PlannedInitFile {
  path: string;
  content: string;
  action: "created" | "updated" | "skipped";
  reason?: string;
}
```

The planner should:

1. Create candidate files.
2. Check existing files.
3. Mark conflicts as `skipped` unless `force` is true.
4. Read and update `package.json` if it exists.
5. Mark existing script names as `skipped` unless `force` is true.
6. Return metadata even in dry-run mode.

The writer should:

1. Create parent directories.
2. Write only `created` and `updated` file entries.
3. Write `package.json` only if a script changed.
4. Return `init.write-failed` findings on filesystem errors.

Writes must resolve under `cwd`.

### Generated Files

Default generated files:

```text
tool-call-contract.config.ts
captures/raw/openai-responses.json
captures/regression/openai-responses.json
```

Do not write the generated Vitest test file in `init`. Instead, add
`tool-contracts:tests` and include next-step instructions in human output. This keeps
`generate-tests` as the only command that owns generated test files.

### Generated Config

Config should be minimal and executable:

```ts
import { z } from "zod";
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
```

Avoid explanatory comments in generated code unless later implementation shows a real
ambiguity.

### Generated Raw Trace

Use an OpenAI Responses-style fixture because v0.3 examples already use that format:

```json
{
  "id": "resp_example_001",
  "output": [
    {
      "type": "function_call",
      "call_id": "call_search",
      "name": "search_knowledge_base",
      "arguments": "{\"query\":\"billing exports\",\"product\":\"billing\",\"limit\":2}"
    }
  ]
}
```

### Generated Regression Capture

Generate the expected normalized output for that raw trace:

```json
{
  "arguments": {
    "limit": 2,
    "product": "billing",
    "query": "billing exports"
  },
  "name": "search_knowledge_base"
}
```

The content must match the deterministic JSON formatter used by `normalize`, not
Prettier. If this creates formatter churn, the implementation should extend
`.prettierignore` narrowly rather than changing normalization output.

### Package Scripts

If `package.json` exists and is valid JSON, add missing scripts:

```json
{
  "tool-contracts:check": "tool-call-contract check",
  "tool-contracts:generate": "tool-call-contract generate",
  "tool-contracts:normalize": "tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression",
  "tool-contracts:normalize:check": "tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression --check",
  "tool-contracts:redact": "tool-call-contract redact --check --suite regression",
  "tool-contracts:validate": "tool-call-contract validate --suite regression",
  "tool-contracts:tests": "tool-call-contract generate-tests --suite regression"
}
```

If `scripts` is missing, create it.

If `package.json` is missing:

- skip package script updates,
- do not fail,
- report the skip in init metadata.

If `package.json` is malformed:

- add an `init.package-json-invalid` error finding,
- do not write package scripts,
- still plan/write non-package files if possible.

### Human Output

Add init rendering in `renderHumanReport`:

```text
Init: 3 created, 0 updated, 0 skipped.
  created tool-call-contract.config.ts
  created captures/raw/openai-responses.json
  created captures/regression/openai-responses.json
Package scripts: 7 created, 0 updated, 0 skipped.
```

For dry-run:

```text
Init dry run: 3 would create, 0 would update, 0 skipped.
```

The exact wording can be adjusted during implementation, but tests should assert the key
counts and file names.

### JSON Output

`init --json` should include:

```json
{
  "schemaVersion": 1,
  "command": "init",
  "success": true,
  "summary": {
    "errors": 0,
    "warnings": 0,
    "info": 0,
    "validResults": 0,
    "invalidResults": 0
  },
  "init": {
    "dryRun": false,
    "force": false,
    "files": [
      {
        "path": "tool-call-contract.config.ts",
        "action": "created"
      }
    ],
    "packageScripts": [
      {
        "name": "tool-contracts:check",
        "action": "created"
      }
    ]
  }
}
```

## Reporting Changes

Add init report metadata only. Do not change existing report fields.

```ts
export interface CommandReport {
  schemaVersion: 1;
  command: CommandName;
  success: boolean;
  summary: ReportSummary;
  findings?: Finding[];
  results?: ToolCallValidationResult[];
  validation?: ValidationReportMetadata;
  redaction?: RedactionReportMetadata;
  generatedTests?: GeneratedTestReportMetadata;
  normalization?: NormalizationReportMetadata;
  init?: InitReportMetadata;
  artifacts?: ArtifactReportMetadata;
}
```

No report schema version bump is needed because the new metadata is optional and command
specific.

Finding IDs:

```text
init.package-json-invalid
init.write-failed
init.path-outside-root
```

Skipped files/scripts are metadata, not findings, unless the skip prevents a successful
bootstrap in a way that should fail the command. Existing file conflicts should not be
errors by default.

## pkg-guard Diagnostics Dogfooding

### Dependency

Upgrade:

```json
{
  "devDependencies": {
    "pkg-guard": "^0.5.0"
  }
}
```

This is required because `^0.3.0` does not allow `0.5.0`.

### Script

Add:

```text
scripts/check-package-diagnostics.mjs
```

The script imports the experimental API:

```js
import { analyzePackageForDiagnostics } from "pkg-guard/experimental/analysis";
```

Run:

```js
const result = await analyzePackageForDiagnostics({
  cwd: root,
  mode: "fast",
});
```

Behavior:

- Fail if any diagnostic has `severity: "error"`.
- Print warnings and info diagnostics to stdout.
- Include `id`, `severity`, `layer`, `cost`, file, path, and range when present.
- Assert package metadata includes `name: "tool-call-contract"` when available.
- Exit `0` when there are no error diagnostics.

Formatting example:

```text
pkg-guard diagnostics: 0 errors, 1 warning, 0 info
warning manifest.license-missing [source/fast] package.json $.license
```

If there are no diagnostics:

```text
pkg-guard diagnostics: no issues
```

### npm Scripts

Add:

```json
{
  "scripts": {
    "pkg-guard:diagnostics": "node scripts/check-package-diagnostics.mjs"
  }
}
```

Update release verification:

```json
{
  "scripts": {
    "verify:release": "npm run lint && npm run format && npm run typecheck && npm test && npm run build && npm run pkg-guard:diagnostics && npm run pack:check && npm run smoke:package"
  }
}
```

Keep:

```json
{
  "scripts": {
    "pack:check": "pkg-guard check && npm pack --dry-run --ignore-scripts"
  }
}
```

`pkg-guard check` remains the stable release gate. The diagnostics script exercises the
experimental API for dogfooding and future editor-readiness feedback.

## Documentation Design

### README

Add a near-top section:

```md
## What This Is

...

## What This Is Not

...
```

This should appear before detailed command usage.

README updates should also:

- mention `init` in the quickstart,
- link to `AGENTS.md`,
- link to cookbooks,
- clarify that captures in git are curated regression fixtures,
- and keep release verification instructions current.

### AGENTS.md

Add root:

```text
AGENTS.md
```

The file should be optimized for coding agents and short enough to scan.

Required structure:

```md
# Using tool-call-contract In A Project

## Goal

## Do This

## Commands

## Files To Create

## Validation

## Do Not

## Troubleshooting
```

It should include exact command sequences and a minimal "adopt in an existing project"
workflow.

### Cookbooks

Add:

```text
docs/cookbooks/openai-responses.md
docs/cookbooks/vercel-ai-sdk.md
docs/cookbooks/langchain.md
```

Each cookbook should include:

- when to use it,
- where the trace shape usually comes from,
- a safe synthetic raw JSON example,
- normalize command,
- validate command,
- redaction warning,
- production telemetry note,
- and unsupported shapes.

Cookbooks should be docs-only. Do not add framework packages.

### Site

Only make small copy updates if necessary:

- mention `init`;
- clarify captures as regression fixtures rather than logs;
- link to GitHub/README for detailed cookbooks if the site has room.

No redesign is required.

## Testing Strategy

### CLI Help Tests

Add tests for:

- global help includes `init` and `help <command>` guidance;
- `help normalize` renders normalize options and examples;
- `normalize --help` renders the same text;
- `help init` renders init options;
- unknown help topics fail with usage error;
- command help does not require config loading.

### Parser Tests

Add tests for:

- `init`;
- `init --dry-run`;
- `init --force`;
- `init` rejects file arguments;
- `--force` outside init is rejected.

### Init Tests

Use temporary directories.

Cases:

- creates config and sample capture files;
- creates package scripts when `package.json` exists;
- skips existing files without `--force`;
- overwrites owned files with `--force`;
- supports `--dry-run` without writing;
- returns deterministic JSON metadata;
- reports malformed `package.json`;
- generated sample workflow passes `check`, `normalize --check`, `redact --check`,
  `validate`, and `generate-tests --dry-run`.

### Reporting Tests

Add human and JSON report tests for `init` metadata.

### pkg-guard Diagnostics Tests

Keep this lightweight:

- Directly run `npm run pkg-guard:diagnostics` in verification.
- Unit tests for the formatting helper are optional.

Because this is a repository script, full behavior is covered by release verification.

### Docs Checks

No separate docs test is required, but links and command examples should be reviewed during
release hardening.

## Migration And Compatibility

- Existing configs remain valid.
- Existing commands keep behavior.
- Existing JSON reports keep `schemaVersion: 1`.
- `init` is additive.
- Command-specific help changes output text but not command semantics.
- No public API removals.
- No runtime dependency changes.
- `pkg-guard` upgrade affects dev/release verification only.

## Release Notes Guidance

v0.4.0 should be described as:

```text
Agent adoption and operability release.
```

Emphasize:

- `init`,
- command-specific help,
- agent guide,
- framework cookbooks,
- trace/capture/fixture terminology,
- and `pkg-guard` diagnostics dogfooding.

Avoid positioning v0.4.0 as:

- enterprise governance,
- runtime instrumentation,
- or production observability.

## Deferred Work

- Runtime recorder helpers.
- Framework adapter packages.
- OpenTelemetry/Langfuse/LangSmith imports.
- Tool result contracts.
- Streaming reconstruction.
- Policy metadata.
- Capture promotion workflows.
- VS Code extension or language server.
- Stable `pkg-guard` analysis integration beyond repo verification.
