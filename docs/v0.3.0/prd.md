# tool-call-contract v0.3.0 PRD

## Summary

`tool-call-contract` v0.3.0 should make it easier to get real agent tool calls into the
v0.2 regression workflow.

v0.1.0 proved the contract model: define AI tools once, validate captured calls, and
generate deterministic review artifacts. v0.2.0 turned those captures into a practical
regression loop with named suites, redaction, grouped reports, and generated Vitest tests.

The remaining adoption gap is capture ingestion. Real agent applications rarely emit
`tool-call-contract`'s normalized capture shape directly. They emit provider envelopes,
framework messages, observability spans, debug logs, streaming fragments, or app-specific
trace files. Developers can write glue code, but every project having to rediscover that
glue slows adoption and makes the product feel like a validator for hand-written JSON
instead of a regression harness for real agent behavior.

The product direction is:

> Convert real provider and framework traces into safe, normalized, repeatable
> tool-call regression fixtures.

This release should deepen ingestion ergonomics without turning the package into a hosted
trace store, model runner, or broad agent framework.

## Background

The v0.2 workflow now supports:

- Zod-backed tool contract definitions.
- Runtime validation for normalized, OpenAI Chat Completions-style, and OpenAI
  Responses-style calls.
- Named capture suites in config.
- Grouped validation reports by suite, file, and contract.
- Deterministic redaction by configured JSON paths.
- Generated Vitest regression tests from capture suites.
- Artifact generation and freshness checks from v0.1.

That workflow is useful once captures exist in the right shape and folder structure.

In real TypeScript agent applications, the capture source is usually one of:

- a raw OpenAI response,
- a Vercel AI SDK tool event or recorded message,
- a LangChain message or trace object,
- an app-specific JSON log,
- a failed production trace copied from observability,
- or a local development transcript.

These sources all contain the same essential information, but the field names, nesting,
argument encoding, and surrounding metadata differ. Some store arguments as objects. Some
store arguments as JSON strings. Some include multiple tool calls per model step. Some
include tool results, prompt text, IDs, token metadata, retries, and unrelated spans.

v0.3.0 should make that bridge explicit.

## Problem

`tool-call-contract` validates tool-call contracts, but capture acquisition remains
manual. A project adopting the tool still has to answer:

- Where do raw traces go?
- Which provider shape is this?
- How do I extract only the tool calls?
- How do I keep call IDs and source labels without making validation brittle?
- How do I handle arguments that are JSON strings in one stack and objects in another?
- How do I split multi-call traces into useful committed fixtures?
- How do I redact raw provider metadata before it lands in regression captures?
- How do I diagnose skipped trace entries?

Common failure modes:

- Teams validate a few hand-written examples and never wire up real captures.
- Captures are committed with too much provider noise, making diffs hard to review.
- Sensitive fields remain in raw traces because redaction paths differ by provider shape.
- Every repo writes a slightly different normalizer.
- A provider or framework change silently breaks local glue code.
- Agents and humans cannot easily infer the intended capture flow from docs alone.

Without ingestion support, v0.2 is useful but still asks too much from first-time adopters.
v0.3.0 should turn raw traces into normalized captures through a small, inspectable CLI
workflow.

## Goals

- Add a normalization workflow that converts raw provider/framework traces into normalized
  capture files.
- Support the most common near-term input formats without promising a full adapter matrix.
- Preserve the existing normalized capture shape as the stable validation target.
- Make skipped, unsupported, and malformed trace entries visible in human and JSON reports.
- Let projects normalize from direct files or configured capture suites.
- Support dry-run and write modes that fit CI and local review.
- Provide simple library helpers for apps that want to record normalized captures directly.
- Update docs and examples so a real app can move from raw trace to generated regression
  test without custom glue.
- Keep the workflow deterministic, local, and network-free.

## Non-Goals

- Live model calls or trace collection from hosted services.
- A hosted trace database or dashboard.
- Automatic instrumentation for every agent framework.
- Streaming trace capture during a running model response.
- Semantic evaluation of model output quality.
- Tool result validation.
- Prompt snapshotting.
- Token accounting or cost reporting.
- Built-in PII detection.
- Binary, protobuf, or database trace imports.
- Support for every provider shape in v0.3.0.
- A general ETL system for arbitrary observability spans.

## Target Users

### Primary User

A TypeScript developer building an agentic application who has raw tool-call traces and
wants to turn them into committed regression fixtures without writing one-off normalizer
scripts.

They likely have:

- a `tool-call-contract.config.ts`,
- Zod tool contracts,
- raw JSON traces from local development, CI, or production debugging,
- capture suites from v0.2,
- and a test command where generated regression tests can run.

### Secondary Users

- Platform engineers standardizing agent trace validation across repos.
- Maintainers of agent starter kits who want a low-friction capture convention.
- Developers reviewing failed prompt experiments.
- QA engineers converting staging traces into regression cases.
- Agentic coding tools that need clear instructions for adding contract regression
  coverage to a repo.

## Product Principles

- Treat raw traces as untrusted JSON.
- Normalize first; validate second.
- Keep provider-specific logic shallow and inspectable.
- Preserve useful source metadata without letting it dominate the capture shape.
- Prefer explicit format selection over fragile magic.
- Make dry-run output useful enough to debug before writing files.
- Keep committed captures small, stable, and reviewable.
- Avoid forcing users into a particular agent framework.
- Document workflows in a way an automated coding agent can follow.

## Scope

### 1. Normalized Capture Format

Continue treating normalized captures as the canonical validation target.

Single-call normalized capture:

```json
{
  "name": "create_issue",
  "arguments": {
    "title": "Billing export duplicates rows",
    "priority": "high"
  }
}
```

Multi-call normalized capture:

```json
[
  {
    "name": "search_knowledge_base",
    "arguments": {
      "query": "How do billing exports work?",
      "product": "billing"
    }
  },
  {
    "name": "create_issue",
    "arguments": {
      "title": "Billing export duplicates rows",
      "priority": "high"
    }
  }
]
```

Optional source metadata may be preserved only when it is stable and useful:

```json
{
  "name": "create_issue",
  "arguments": {
    "title": "Billing export duplicates rows"
  },
  "source": {
    "format": "openai-responses",
    "id": "call_123"
  }
}
```

Requirements:

- `name` remains the contract lookup key.
- `arguments` must be an object after normalization.
- Argument JSON strings should be parsed when possible.
- Multi-call traces should be emitted deterministically.
- Unknown provider metadata should not be copied by default.
- Normalized output should be formatted with the existing deterministic JSON formatter.

Open question for TDD:

- Whether source metadata should be included by default, gated behind `--include-source`, or
  omitted from v0.3.0 output.

### 2. Input Formats

Add a small set of explicit input formats.

Initial candidates:

```text
normalized
openai-chat
openai-responses
vercel-ai-sdk
langchain
generic
```

Expected behavior:

- `normalized` re-formats and optionally filters existing normalized captures.
- `openai-chat` extracts tool calls from Chat Completions-style messages.
- `openai-responses` extracts function/tool calls from Responses-style output.
- `vercel-ai-sdk` extracts tool calls from common AI SDK message/tool-call shapes.
- `langchain` extracts tool calls from message objects with `tool_calls`.
- `generic` uses configurable paths to locate call arrays, names, and arguments.

The exact supported shapes should be conservative. v0.3.0 should prefer accurate,
documented support for common examples over broad best-effort parsing.

Out of scope unless trivial:

- Mastra-specific traces.
- LangSmith trace exports.
- OpenTelemetry span conventions.
- Streaming delta reconstruction.
- Tool result normalization.

### 3. `normalize` CLI

Add a command that converts raw traces into normalized capture files.

Examples:

```sh
tool-call-contract normalize captures/raw/openai.json --format openai-responses
tool-call-contract normalize captures/raw/*.json --format langchain --out-dir captures/regression
tool-call-contract normalize --suite raw --format vercel-ai-sdk --out-dir captures/regression
tool-call-contract normalize captures/raw/example.json --format openai-chat --dry-run
tool-call-contract normalize captures/raw/example.json --format openai-chat --json
```

Expected options:

```text
--format <name>       Raw input format to normalize
--suite <name>        Include configured capture suite files
--out <file>          Write one normalized output file
--out-dir <dir>       Write normalized outputs under a directory
--dry-run             Report planned writes without writing files
--check               Fail if output files are missing or stale
--json                Print a machine-readable report
```

Rules:

- A format must be supplied unless the TDD defines safe auto-detection.
- Direct files, suites, or both may be supplied.
- `--out` is valid only for one input file.
- `--out` and `--out-dir` are mutually exclusive.
- `--check` cannot be combined with write-only options unless the TDD defines exact
  semantics.
- Writes must not escape `cwd`.
- Output paths should be deterministic.
- Existing output files should be overwritten only when content changes.

Default output behavior is an open question for the TDD.

Options the TDD should evaluate:

- require `--out` or `--out-dir` for all writes,
- write beside each raw file with a suffix,
- or write under a configured normalized capture directory.

### 4. Generic Normalizer

Provide a configurable fallback for app-specific trace JSON.

Config idea:

```ts
export default defineConfig({
  contracts,
  normalization: {
    generic: {
      callsPath: "events.*.toolCall",
      namePath: "name",
      argumentsPath: "arguments",
    },
  },
});
```

Expected behavior:

- Paths should use a simple documented dot-path syntax.
- `*` wildcards may be supported if they can share the existing redaction path parser.
- `argumentsPath` values may be objects or JSON strings.
- Missing paths should produce structured findings.
- Generic normalization should not require users to write JavaScript code.

Out of scope:

- Full JSONPath.
- Regex extraction.
- Transform expressions.
- Calling user-provided functions during normalization.

### 5. Capture Recording Helpers

Add small public helpers for applications that want to record normalized captures directly.

Potential API:

```ts
import { normalizeToolCall, normalizeToolCalls } from "tool-call-contract";

const capture = normalizeToolCall({
  name: "create_issue",
  arguments: {
    title: "Billing export duplicates rows",
  },
});
```

Potential file helper:

```ts
import { appendToolCallCapture } from "tool-call-contract";

await appendToolCallCapture("captures/raw/local.jsonl", {
  name: "create_issue",
  arguments: {
    title: "Billing export duplicates rows",
  },
});
```

The TDD should decide whether file-writing helpers belong in v0.3.0. A pure normalization
API may be enough for this release.

Requirements:

- Library helpers should not import CLI internals.
- Helpers should not require a config file.
- Helpers should be safe to use in app code without pulling in test-only dependencies.
- Public APIs should be small enough to preserve compatibility in future minor releases.

### 6. Normalization Reports

Add report metadata for normalization commands.

Desired JSON shape:

```ts
interface JsonReport {
  schemaVersion: 1;
  command: "normalize";
  success: boolean;
  summary: ReportSummary;
  findings?: Finding[];
  normalization?: {
    format: string;
    inputs: Array<{
      path: string;
      callsFound: number;
      callsWritten: number;
      skipped: number;
      outputPath?: string;
      changed?: boolean;
    }>;
  };
}
```

Human output should show:

- input file,
- selected format,
- number of calls found,
- output destination,
- changed/unchanged status,
- skipped entries,
- and any parse errors.

Finding IDs may include:

```text
normalize.format-unknown
normalize.format-required
normalize.input-invalid-json
normalize.input-unsupported
normalize.arguments-invalid-json
normalize.arguments-not-object
normalize.no-tool-calls
normalize.output-stale
normalize.write-failed
normalize.path-invalid
```

The TDD should confirm final IDs.

### 7. Workflow Integration

The v0.3 workflow should compose with v0.2 commands.

Recommended project layout:

```text
captures/
  raw/
    openai/
    langchain/
  regression/
    create-issue.json
    search-docs.json
```

Recommended scripts:

```json
{
  "scripts": {
    "tool-contracts:normalize": "tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression",
    "tool-contracts:redact": "tool-call-contract redact --check --suite regression",
    "tool-contracts:validate": "tool-call-contract validate --suite regression",
    "tool-contracts:tests": "tool-call-contract generate-tests --suite regression"
  }
}
```

The docs should make clear that raw traces may be ignored by git while normalized,
redacted regression captures can be committed.

### 8. Docs And Examples

Update docs and examples to show the ingestion workflow.

The example project should include:

- a raw OpenAI-style trace,
- a raw framework-style trace if implementation supports one,
- a configured raw capture suite,
- a configured regression capture suite,
- a normalization command,
- redaction after normalization,
- validation of normalized captures,
- and generated tests from normalized captures.

README should include:

- "raw trace to regression test" quickstart,
- supported input format table,
- examples of provider/framework trace shapes,
- caveats around streaming and unsupported spans,
- and an explanation of normalized captures as the stable contract boundary.

## User Stories

### Normalize A Raw Provider Trace

As a developer, I want to convert a raw OpenAI or framework trace into normalized captures
so I can validate real model behavior without hand-editing JSON.

Acceptance criteria:

- Given a supported raw trace, `normalize --format <name>` extracts tool calls.
- The output is deterministic normalized JSON.
- The normalized output can be validated by `validate`.

### Diagnose Unsupported Trace Entries

As a developer, I want skipped trace entries to be reported clearly so I can tell whether
the tool missed a call or the trace did not contain one.

Acceptance criteria:

- JSON reports include skipped counts and findings.
- Human reports identify the input file and reason for skipped entries.
- Malformed arguments produce a specific finding.

### Normalize From Capture Suites

As a CI user, I want to normalize a configured raw suite into a regression suite so the
same project conventions work for ingestion and validation.

Acceptance criteria:

- `normalize --suite raw --out-dir captures/regression` resolves configured files.
- Duplicate raw inputs are processed once.
- Output paths are deterministic and cannot escape `cwd`.

### Check Normalized Output Freshness

As a developer, I want CI to fail when committed normalized captures are stale relative to
raw traces.

Acceptance criteria:

- `normalize --check` exits non-zero when expected output would change.
- Reports identify stale files.
- `normalize --dry-run` shows the planned writes without mutating files.

### Record Normalized Calls Directly

As an application developer, I want a small helper for writing normalized calls at runtime
so I can avoid provider-specific trace parsing when I own the tool invocation boundary.

Acceptance criteria:

- A public helper can normalize a call object into the canonical capture shape.
- The helper rejects invalid names and non-object arguments.
- The helper does not require CLI config loading.

## CLI Changes

Existing commands:

```sh
tool-call-contract check
tool-call-contract generate
tool-call-contract validate <files...>
tool-call-contract redact <files...>
tool-call-contract generate-tests
```

New command:

```sh
tool-call-contract normalize <files...>
```

Supported forms:

```sh
tool-call-contract normalize captures/raw/openai.json --format openai-responses
tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression
tool-call-contract normalize captures/raw/langchain.json --format langchain --dry-run
tool-call-contract normalize captures/raw/custom.json --format generic --json
```

The exact command and option names can be refined in the technical design, but the product
requirements are:

- explicit format selection,
- deterministic normalized output,
- suite integration,
- dry-run/check modes,
- and reports that explain skipped or unsupported entries.

## Config Changes

Potential extension to `defineConfig` input:

```ts
interface ToolCallContractConfig {
  contracts: readonly ToolContract[];
  outDir?: string;
  examples?: Record<string, readonly unknown[]>;
  include?: readonly string[];
  exclude?: readonly string[];
  captures?: Record<string, readonly string[]>;
  redaction?: {
    paths: readonly string[];
    replacement?: string;
  };
  normalization?: {
    generic?: {
      callsPath: string;
      namePath: string;
      argumentsPath: string;
    };
  };
}
```

Compatibility:

- Existing v0.1 and v0.2 configs remain valid.
- New fields are optional.
- Invalid normalization config should produce structured config errors.
- Config loading remains trusted code execution.

Open question for TDD:

- Whether provider-specific normalization options should live in config now or wait until a
  future release.

## Reporting Requirements

Normalization reports should preserve:

- `schemaVersion: 1` unless the TDD concludes the JSON contract needs a version bump,
- stable issue codes,
- project-relative POSIX paths,
- deterministic ordering,
- and a clear distinction between errors, warnings, and informational skips.

Reports should make it easy for automated agents to:

- detect whether normalization succeeded,
- identify generated output paths,
- determine whether files changed,
- and explain unsupported input shapes to a user.

## Security And Privacy

- Raw traces are untrusted JSON.
- Normalization should not execute tool handlers, model code, or user-provided transform
  functions.
- Normalization should not make sensitive traces safe by itself.
- Redaction remains the explicit sensitive-data step.
- Docs should recommend normalizing from raw ignored files into redacted committed captures.
- Writes must stay inside `cwd`.
- Argument JSON parsing should avoid eval-like behavior.
- Config loading remains trusted project code execution.

## Success Metrics

v0.3.0 succeeds if:

- A project can convert at least one raw provider trace into normalized captures with one
  CLI command.
- A project can normalize from a configured raw suite into a configured regression suite.
- Normalized output can flow through `redact`, `validate`, and `generate-tests`.
- Reports explain malformed, skipped, and unsupported trace entries clearly.
- The example project demonstrates raw trace to regression test without custom scripts.
- Existing v0.1 and v0.2 workflows continue to work.

## Release Criteria

- Full release verification passes.
- Existing v0.1 and v0.2 tests continue to pass.
- Normalization logic has focused unit tests for each supported format.
- CLI integration tests cover direct files, suites, dry-run, check mode, output writes, and
  unsupported inputs.
- README documents the v0.3 ingestion workflow.
- `docs/v0.3.0` contains PRD, technical design, and implementation plan before
  implementation begins.
- The package remains small and does not add large framework dependencies.
- The product site is reviewed for whether v0.3 messaging needs a small update.

## Open Questions For Technical Design

- Which input formats should ship in v0.3.0 versus be deferred?
- Should `normalize` require `--format`, or should it support conservative auto-detection?
- Should normalized output include source metadata by default?
- What should the default write destination be when neither `--out` nor `--out-dir` is
  supplied?
- Should `normalize --check` compare against existing output files, validate raw files only,
  or both?
- Should file-writing capture helpers ship in v0.3.0, or should public helpers stay
  side-effect-free?
- Can the existing redaction dot-path parser be reused for generic normalization paths?
- Should generic normalization support arrays and wildcards in v0.3.0?
- Should provider-specific normalization options be configurable now?
- Do normalization reports fit `schemaVersion: 1`, or does adding a new command with new
  metadata justify a report schema version bump?
