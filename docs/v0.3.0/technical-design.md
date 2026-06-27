# tool-call-contract v0.3.0 Technical Design

## Overview

`tool-call-contract` v0.3.0 adds capture ingestion to the v0.2 regression workflow.

The package already validates normalized tool-call captures, resolves named capture suites,
redacts configured JSON paths, and generates Vitest regression tests. v0.3.0 should add a
first-class normalization layer that converts raw provider/framework trace files into the
same stable capture shape those existing commands already understand.

The design keeps the package local and deterministic:

- no model calls,
- no hosted trace APIs,
- no framework runtime dependencies,
- no user-provided transform execution,
- and no implicit trace collection.

The v0.3 workflow is:

```text
raw trace JSON
  -> normalize --format <provider-or-framework>
  -> redact --check
  -> validate --suite regression
  -> generate-tests --suite regression
```

Normalization is intentionally shallow. It extracts tool-call names, arguments, and
optional IDs/source labels from known JSON shapes. It does not preserve full provider
metadata, reconstruct streaming deltas, validate tool results, or infer semantic quality.

## Design Decisions

The v0.3.0 PRD left several choices open. This design resolves them as follows.

| Question                      | Decision                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial input formats         | Ship `normalized`, `openai-chat`, `openai-responses`, `vercel-ai-sdk`, `langchain`, and `generic`. Defer Mastra, LangSmith, OpenTelemetry, and streaming.  |
| Format detection              | Require `--format <name>`. Do not auto-detect in v0.3. Explicit formats produce clearer failures and avoid surprising cross-provider matches.              |
| Source metadata               | Omit source metadata from output by default. Add `--include-source` to include stable `id` and `source` fields when available.                             |
| Default write destination     | Require `--out` or `--out-dir` for writes and `--check`. Allow `--dry-run` without a destination for extraction diagnostics.                               |
| `normalize --check` semantics | Recompute normalized output and compare it with explicit destination files. Missing or stale outputs are errors. `--check` never writes.                   |
| File-writing library helpers  | Do not add public file-writing helpers in v0.3.0. Ship side-effect-free normalization helpers first.                                                       |
| Generic path parser           | Extract the existing redaction dot-path logic into a shared path utility and reuse it for generic normalization.                                           |
| Generic wildcards             | Support `*` and numeric array indexes in v0.3.0 because redaction already has this behavior. Do not support full JSONPath.                                 |
| Provider-specific config      | Do not add provider-specific normalization config in v0.3.0. Only `generic` needs config.                                                                  |
| Report schema version         | Keep `schemaVersion: 1` and add optional `normalization` metadata. Existing report consumers can ignore new fields.                                        |
| Output granularity            | Write one normalized JSON file per input file. If a raw input contains multiple tool calls, the normalized output is an array.                             |
| `validate` compatibility      | Preserve the current ability to validate normalized, OpenAI Chat, and OpenAI Responses shapes. Internally, validation should reuse the normalization code. |

## Runtime And Dependencies

Runtime targets remain unchanged:

- Node.js 20 or newer.
- TypeScript 5.5 or newer.
- Zod 4 as a peer dependency.

No new runtime dependency should be required for v0.3.0.

The existing dependencies already cover:

- TypeScript config loading through `jiti`,
- capture suite globs through `tinyglobby`,
- bundling through `tsup`,
- tests through Vitest,
- and release package checks through `pkg-guard`.

Normalization should use only local JSON parsing and small internal helpers.

## Public API Changes

### Normalized Capture Types

Move the canonical capture shape out of validation-only internals and make it the shared
normalization/validation contract.

```ts
export interface NormalizedToolCall {
  name: string;
  arguments: unknown;
  id?: string;
  source?: ToolCallSource;
}

export type ToolCallSource =
  | "normalized"
  | "openai-chat"
  | "openai-responses"
  | "vercel-ai-sdk"
  | "langchain"
  | "generic"
  | "unknown";
```

`id` and `source` remain optional because committed captures should be able to stay small.

Validation continues to parse string arguments before schema validation. Normalization also
parses string arguments so written captures contain objects where possible. If parsing
fails, normalization should report a finding instead of writing invalid normalized output.

### Normalization Formats

Add public format and result types:

```ts
export type NormalizationFormat =
  | "normalized"
  | "openai-chat"
  | "openai-responses"
  | "vercel-ai-sdk"
  | "langchain"
  | "generic";

export interface GenericNormalizationConfig {
  callsPath: string;
  namePath: string;
  argumentsPath: string;
  idPath?: string;
}

export interface NormalizeToolCallsOptions {
  format: NormalizationFormat;
  includeSource?: boolean;
  generic?: GenericNormalizationConfig;
}

export interface NormalizeToolCallsResult {
  calls: NormalizedToolCall[];
  issues: ToolCallIssue[];
  skipped: number;
}
```

Add side-effect-free public helpers:

```ts
export function normalizeToolCallCapture(input: {
  name: string;
  arguments: unknown;
  id?: string;
  source?: ToolCallSource;
}): NormalizeToolCallsResult;

export function normalizeToolCallCaptures(
  input: unknown,
  options: NormalizeToolCallsOptions,
): NormalizeToolCallsResult;
```

The naming deliberately includes `Capture` to avoid implying that these helpers execute
tools or call model APIs.

Only these small helpers and related types should be exported from `src/index.ts`. File IO,
write planning, CLI parsing, and provider-specific implementation functions should stay
internal until the API proves stable.

### Config Types

Extend `ToolCallContractConfig` with optional generic normalization config:

```ts
export interface ToolCallContractConfig {
  contracts: readonly ToolContract[];
  outDir?: string;
  examples?: Record<string, readonly unknown[]>;
  include?: readonly string[];
  exclude?: readonly string[];
  captures?: CaptureSuiteConfig;
  redaction?: RedactionConfig;
  normalization?: NormalizationConfig;
}

export interface NormalizationConfig {
  generic?: GenericNormalizationConfig;
}
```

Rules:

- Existing v0.1 and v0.2 configs remain valid.
- `normalization` is optional.
- `normalization.generic` is required only when using `--format generic`.
- `callsPath`, `namePath`, `argumentsPath`, and `idPath` use the same shared dot-path
  syntax as redaction.
- Invalid normalization config produces `ConfigLoadError` with `code: "config.invalid"`.

Provider-specific formats do not get config in v0.3.0. If a provider shape needs options,
that format should be deferred rather than hidden behind loose configuration.

## Internal Modules

Add focused modules:

```text
src/normalization.ts
src/normalization-formats.ts
src/path-selectors.ts
src/normalization-writer.ts
src/cli/normalize.ts
```

### `src/path-selectors.ts`

Extract the redaction path parser and traversal behavior into a shared helper.

Supported syntax:

- dot-separated object properties,
- `*` wildcard over object values or array items,
- numeric array indexes,
- no escaping,
- no recursive descent operator,
- no filters or predicates.

Example:

```text
events.*.toolCall
choices.0.message.tool_calls
arguments.email
```

Recommended types:

```ts
export interface ParsedPathSelector {
  source: string;
  segments: readonly string[];
}

export function parsePathSelector(path: string): PathSelectorParseResult;
export function selectPathValues(value: unknown, selector: ParsedPathSelector): unknown[];
```

Redaction can keep its recursive "apply paths from every object node" behavior by layering
that policy on top of the shared selector. Generic normalization should apply selectors
from the root of the raw trace only.

### `src/normalization.ts`

Own public normalization types and the top-level dispatcher:

```ts
export function normalizeToolCallCapture(...): NormalizeToolCallsResult;
export function normalizeToolCallCaptures(...): NormalizeToolCallsResult;
```

Responsibilities:

- dispatch by explicit format,
- aggregate calls, issues, and skipped counts,
- enforce `arguments` object shape,
- parse JSON string arguments,
- optionally include `id` and `source`,
- and preserve deterministic call ordering.

### `src/normalization-formats.ts`

Own internal extraction functions for each format.

Recommended internal shape:

```ts
interface ExtractedToolCall {
  name: string;
  arguments: unknown;
  id?: string;
  source: ToolCallSource;
  path?: Array<string | number>;
}

type FormatExtractor = (input: unknown, options: FormatExtractorOptions) => FormatExtractionResult;
```

Format extractors should not parse files, validate contracts, write output, or render
reports. They should only traverse JSON-like values.

### `src/normalization-writer.ts`

Own CLI write/check planning:

```ts
export interface NormalizationInputFile {
  path: string;
  content: string;
}

export interface NormalizationWritePlanEntry {
  inputPath: string;
  outputPath?: string;
  callsFound: number;
  callsWritten: number;
  skipped: number;
  changed: boolean;
  content?: string;
  issues: ToolCallIssue[];
}

export interface NormalizationWritePlan {
  entries: NormalizationWritePlanEntry[];
  findings: Finding[];
}
```

Responsibilities:

- parse input JSON,
- call normalization helpers,
- format normalized output as deterministic JSON,
- compute destination paths,
- detect output collisions,
- compare existing output files for `--check`,
- and produce write findings.

### `src/cli/normalize.ts`

Own command-level behavior:

- resolve direct files and suites through `resolveCaptureFiles`,
- load input file contents,
- call the writer/planner,
- perform writes unless `--dry-run` or `--check`,
- build report metadata,
- and return findings to `createCommandReport`.

`src/cli/app.ts` should only parse the new options and route to this module.

## Format Extraction Rules

### Shared Rules

All formats should follow the same final normalization rules:

- Tool name must be a non-empty string.
- Arguments must exist.
- Arguments may be an object or a JSON string that parses to an object.
- Parsed arguments must be a non-array object.
- Invalid calls produce issues and are not written.
- Unsupported non-call entries increment `skipped` only when they are part of a supported
  container. A totally unsupported root produces an error finding.
- Empty extraction produces `normalize.no-tool-calls`.
- Output order follows input order.

Source metadata:

- Default output includes only `name` and `arguments`.
- With `--include-source`, include `id` when present and `source` as the format name.
- Do not include raw provider path metadata in written captures.

### `normalized`

Supported input:

```json
{ "name": "create_issue", "arguments": { "title": "Bug" } }
```

Also support arrays and the existing compatibility shape:

```json
{ "toolName": "create_issue", "args": { "title": "Bug" } }
```

For `normalized`, reformatting an already-normalized capture should be deterministic. This
format is useful for cleaning generated or hand-written captures.

### `openai-chat`

Support Chat Completions-style tool calls:

```json
{
  "choices": [
    {
      "message": {
        "tool_calls": [
          {
            "id": "call_123",
            "type": "function",
            "function": {
              "name": "create_issue",
              "arguments": "{\"title\":\"Bug\"}"
            }
          }
        ]
      }
    }
  ]
}
```

Also support a message object directly:

```json
{
  "role": "assistant",
  "tool_calls": []
}
```

Rules:

- Extract `tool_calls[].function.name`.
- Extract `tool_calls[].function.arguments`.
- Extract `tool_calls[].id` as optional ID.
- Ignore non-function tool-call entries in v0.3.0.
- Do not extract tool result messages.

### `openai-responses`

Support Responses-style output items:

```json
{
  "output": [
    {
      "type": "function_call",
      "call_id": "call_123",
      "name": "create_issue",
      "arguments": "{\"title\":\"Bug\"}"
    }
  ]
}
```

Also support a function call item directly.

Rules:

- Extract items where `type === "function_call"`.
- Extract `name`.
- Extract `arguments`.
- Extract `call_id` as optional ID.
- Ignore function call output/result items in v0.3.0.

### `vercel-ai-sdk`

Support common AI SDK core and UI message shapes without importing the AI SDK package.

Core result-style shape:

```json
{
  "toolCalls": [
    {
      "toolCallId": "call_123",
      "toolName": "create_issue",
      "args": {
        "title": "Bug"
      }
    }
  ]
}
```

Also accept `input` instead of `args` because AI SDK UI/tool part shapes commonly refer to
tool input.

UI message part-style shape:

```json
{
  "parts": [
    {
      "type": "tool-create_issue",
      "toolCallId": "call_123",
      "input": {
        "title": "Bug"
      }
    }
  ]
}
```

Rules:

- Prefer explicit `toolName` when present.
- If no `toolName` exists and `type` starts with `tool-`, derive the name by stripping
  `tool-`.
- Extract arguments from `args` first, then `input`.
- Extract `toolCallId` or `id` as optional ID.
- Ignore tool result/output-only parts.
- Keep support conservative and fixture-backed; do not chase every AI SDK internal message
  variant in v0.3.0.

### `langchain`

Support LangChain JS message objects with standard `tool_calls` arrays:

```json
{
  "tool_calls": [
    {
      "name": "create_issue",
      "args": {
        "title": "Bug"
      },
      "id": "call_123"
    }
  ]
}
```

Rules:

- Extract `tool_calls[].name`.
- Extract `tool_calls[].args`.
- Extract `tool_calls[].id` as optional ID.
- Support arrays of message objects.
- Do not parse provider-specific raw calls inside `additional_kwargs` in v0.3.0. Users can
  select `openai-chat` for raw OpenAI payloads.

### `generic`

Support app-specific JSON through config:

```ts
export default defineConfig({
  contracts,
  normalization: {
    generic: {
      callsPath: "events.*.toolCall",
      namePath: "name",
      argumentsPath: "arguments",
      idPath: "id",
    },
  },
});
```

Rules:

- `callsPath` is evaluated from the raw root.
- `namePath`, `argumentsPath`, and `idPath` are evaluated from each selected call node.
- `namePath` must select exactly one string.
- `argumentsPath` must select exactly one object or JSON string that parses to an object.
- `idPath`, when present, may select zero or one string.
- Multiple matches for name, arguments, or ID produce a structured issue for that call.

Generic normalization is deliberately limited. Users who need arbitrary transformation can
normalize in their application code and pass `--format normalized`.

## CLI Design

### Command Name

Extend `CommandName`:

```ts
export type CommandName =
  | "check"
  | "generate"
  | "validate"
  | "redact"
  | "generate-tests"
  | "normalize";
```

### Options

Extend `CliOptions`:

```ts
export interface CliOptions {
  // existing fields...
  format?: NormalizationFormat;
  includeSource: boolean;
}
```

Help text:

```text
Commands:
  normalize <files...>  Normalize raw tool-call traces into capture JSON

Options:
      --format <name>       Input format for normalize
      --include-source      Include stable source/id metadata in normalized output
```

### Usage Validation

Rules:

- `normalize` requires at least one direct file or `--suite`.
- `normalize` requires `--format`.
- `--format` must be one of the supported format names.
- Writes require exactly one of `--out` or `--out-dir`.
- `--dry-run` may run without output options for diagnostics.
- `--check` requires `--out` or `--out-dir`.
- `--check` and `--dry-run` are mutually exclusive.
- `--out` is valid only when exactly one input file resolves.
- `--out` and `--out-dir` are mutually exclusive.
- `--include-source` is valid only with `normalize`.
- `--format generic` requires `config.normalization.generic`.

Exit codes follow existing CLI policy:

- usage errors exit `2`,
- normalization errors or stale outputs exit `1`,
- success and warning-only reports exit `0`.

### Destination Paths

`--out`:

- only one resolved input file,
- output path normalized relative to `cwd`,
- path must stay inside `cwd`.

`--out-dir`:

- one output file per input file,
- output path is `outDir/<basename(input)>`,
- input extension must be `.json` in v0.3.0,
- duplicate output paths produce `normalize.output-collision`,
- output paths must stay inside `cwd`.

This basename mapping keeps `captures/raw/openai/example.json` from becoming
`captures/regression/captures/raw/openai/example.json`. A future release can add output
templates if projects need more structure.

### Writes

Write behavior:

- If a planned output differs, write it unless `--dry-run` or `--check`.
- If content is unchanged, report unchanged and do not rewrite.
- If any error finding exists before writes, do not write any files.
- Create parent directories for output paths.
- Format JSON with two-space indentation and trailing newline, matching existing artifact
  formatting.

`--check` behavior:

- Missing output file is `normalize.output-missing`.
- Existing output content mismatch is `normalize.output-stale`.
- Matching content is success.
- No writes occur.

## Reporting Design

### Command Report

Extend `CommandReport`:

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
  artifacts?: ArtifactReportMetadata;
}

export interface NormalizationReportMetadata {
  format: NormalizationFormat;
  includeSource: boolean;
  dryRun: boolean;
  checked: boolean;
  files: Array<{
    inputPath: string;
    outputPath?: string;
    callsFound: number;
    callsWritten: number;
    skipped: number;
    changed: boolean;
  }>;
}
```

`summary.validResults` and `summary.invalidResults` remain validation-only. Normalization
success is represented through findings and metadata counts.

### Human Output

Add a normalization block:

```text
Normalization: openai-responses
  captures/raw/openai.json -> captures/regression/openai.json
    calls found: 2, written: 2, skipped: 1, changed: yes
```

If no destination exists in dry-run diagnostics:

```text
Normalization: langchain
  captures/raw/langchain.json
    calls found: 1, written: 1, skipped: 0
```

Findings render through the existing finding renderer.

### Finding IDs

Recommended findings:

```text
normalize.format-required
normalize.format-unknown
normalize.generic-config-missing
normalize.input-invalid-json
normalize.input-unsupported
normalize.arguments-missing
normalize.arguments-invalid-json
normalize.arguments-not-object
normalize.name-missing
normalize.name-not-string
normalize.no-tool-calls
normalize.output-required
normalize.output-collision
normalize.output-missing
normalize.output-stale
normalize.write-failed
normalize.path-invalid
normalize.path-ambiguous
```

Severity guidance:

- usage/config problems are errors,
- malformed JSON inputs are errors,
- no tool calls in a selected input is an error,
- unsupported non-call entries inside an otherwise supported container increment `skipped`
  and may be info,
- stale/missing outputs in `--check` are errors,
- unchanged outputs are metadata only.

## Validation Refactor

The existing `validateToolCalls` behavior already accepts several raw-ish shapes. v0.3.0
should preserve that compatibility while moving the implementation into normalization.

Recommended path:

1. Add `normalizeToolCallCaptures`.
2. Reimplement validation's private normalization through:

   ```ts
   normalizeToolCallCaptures(input, { format: "normalized", includeSource: true });
   ```

3. Keep compatibility collection for OpenAI Chat and Responses when validation receives
   those shapes by adding an internal `format: "auto-legacy"` helper or by trying the three
   legacy formats in order:

   ```text
   openai-responses -> normalized -> openai-chat
   ```

4. Do not expose auto-detection through the CLI.

This keeps existing v0.1/v0.2 users working while still making the new `normalize` command
explicit.

## Config Loading

Extend config validation in `loadConfig`:

- `normalization` must be an object when present.
- `normalization.generic` must be an object when present.
- `callsPath`, `namePath`, and `argumentsPath` must be non-empty strings.
- `idPath`, when present, must be a non-empty string.
- Every configured path must parse through `parsePathSelector`.

Invalid config should produce `config.invalid` with messages precise enough to fix without
reading source code.

`defineConfig` remains a light identity helper.

## Testing Strategy

### Unit Tests

Add `test/normalization.test.ts` for format extraction:

- normalized single call,
- normalized array,
- normalized `toolName`/`args`,
- OpenAI Chat completion root,
- OpenAI Chat message root,
- OpenAI Responses root,
- OpenAI Responses direct item,
- Vercel AI SDK `toolCalls`,
- Vercel AI SDK `parts`,
- LangChain `tool_calls`,
- generic path extraction,
- JSON string arguments,
- invalid JSON arguments,
- non-object arguments,
- missing names,
- unsupported roots,
- deterministic output order,
- `includeSource` on/off.

Add `test/path-selectors.test.ts`:

- dot paths,
- wildcard object traversal,
- wildcard array traversal,
- numeric array indexes,
- invalid empty segments,
- root-relative behavior for generic normalization.

Update redaction tests to confirm behavior is unchanged after path helper extraction.

### CLI Tests

Extend `test/cli.test.ts`:

- help includes `normalize`,
- unknown format usage error,
- missing format usage error,
- direct file normalization with `--out`,
- suite normalization with `--out-dir`,
- dry-run without output,
- check success,
- check stale output,
- output collision,
- generic format missing config,
- JSON report shape.

### E2E Tests

Update the example project e2e to run:

```sh
tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression
tool-call-contract redact --check --suite regression
tool-call-contract validate --suite regression
tool-call-contract generate-tests --suite regression
```

The e2e test should avoid live model calls and only use committed fixtures.

## Documentation And Examples

README additions:

- "Normalize raw traces" section.
- Supported format table.
- OpenAI Chat, OpenAI Responses, Vercel AI SDK, LangChain, and generic examples.
- Recommended raw/regression capture layout.
- CI script examples.
- Warning that normalization is not redaction.

Example project updates:

```text
examples/basic/
  captures/
    raw/
      openai-responses.json
      langchain.json
    regression/
      openai-responses.json
      langchain.json
```

Config:

```ts
export default defineConfig({
  contracts,
  captures: {
    raw: ["captures/raw/*.json"],
    regression: ["captures/regression/*.json"],
  },
  redaction: {
    paths: ["arguments.email", "metadata.authorization"],
  },
  normalization: {
    generic: {
      callsPath: "events.*.toolCall",
      namePath: "name",
      argumentsPath: "arguments",
    },
  },
});
```

The example should keep raw fixtures synthetic and safe to commit. Docs should still tell
real users to treat raw traces as potentially sensitive and normally gitignore them.

## Security And Privacy

- Raw trace files are untrusted JSON.
- Normalization only uses `JSON.parse`; it must never evaluate strings as JavaScript.
- Normalization must not execute tool handlers or model code.
- Generic normalization must not call user-provided transform functions.
- Normalization is not redaction.
- Raw traces may include prompts, outputs, auth metadata, customer text, and tokens.
- Docs should recommend committing only normalized/redacted regression captures.
- `--out` and `--out-dir` must not write outside `cwd`.
- Config loading remains trusted code execution because TypeScript config loading already
  executes local project code.

## Migration And Compatibility

Existing behavior remains valid:

- v0.1/v0.2 configs load unchanged.
- `validate <files...>` still accepts existing normalized captures.
- `validate` still accepts the OpenAI shapes it already accepted.
- `redact`, `generate-tests`, `check`, and `generate` keep their current behavior.
- Report `schemaVersion` remains `1`.

New normalized captures should still validate with older v0.2 validators as long as they
omit new source metadata or only use the existing optional `id`/`source` fields.

## Release Notes Positioning

Describe v0.3.0 as:

> Capture ingestion for real agent traces.

Do not position it as:

- an observability product,
- a hosted trace store,
- a complete provider adapter suite,
- or an agent framework.

The practical message:

> Bring raw tool-call traces from OpenAI, Vercel AI SDK, LangChain, or your own JSON logs
> into the same redaction, validation, and generated-test workflow.

## External References

The implementation should use fixture-backed support for documented public shapes and avoid
depending on provider SDK internals.

Primary references:

- OpenAI function calling guide: `https://platform.openai.com/docs/guides/function-calling`
- OpenAI Chat Completions API reference: `https://platform.openai.com/docs/api-reference/chat/create`
- OpenAI Responses API reference: `https://platform.openai.com/docs/api-reference/responses/create`
- Vercel AI SDK tool calling docs: `https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling`
- LangChain JS tool calling docs: `https://js.langchain.com/docs/how_to/tool_calling/`

## Deferred Post-v0.3.0 Work

- Auto-detection with confidence reporting.
- Output path templates.
- Per-call output splitting.
- Streaming delta reconstruction.
- Tool result validation.
- Mastra-specific trace imports.
- LangSmith trace exports.
- OpenTelemetry span conventions.
- MCP trace formats.
- Provider-specific config options.
- File-writing runtime capture helpers.
- Built-in PII detection.
- Capture diffing and coverage reports.
