# tool-call-contract v0.2.0 PRD

## Summary

`tool-call-contract` v0.2.0 should turn the v0.1 contract validation workflow into a practical captured-call regression testing workflow.

v0.1.0 proved that developers can define tool contracts once, validate captured calls, and generate deterministic fixtures, docs, provider schemas, and manifests. v0.2.0 should make those capabilities easier to use continuously by introducing named capture suites, grouped validation reports, redaction for sensitive captured data, and generated regression tests that can run in ordinary TypeScript test projects.

The product direction is:

> Capture real AI tool calls, make them safe to commit, and turn them into repeatable contract tests.

This release should not broaden the product into a multi-provider adapter matrix yet. It should deepen the core loop for teams already using the MVP: define contracts, capture tool calls, validate traces, commit regression coverage, and catch drift in CI.

## Background

The v0.1 MVP shipped:

- Zod-backed tool contract definitions.
- Runtime validation for normalized, OpenAI Chat Completions-style, and OpenAI Responses-style calls.
- Deterministic fixture, OpenAI schema, Markdown doc, and manifest generation.
- Artifact freshness checks and safe clean behavior.
- A working package release pipeline and product site.

The next adoption barrier is not defining contracts. It is operationalizing real captured calls.

In real projects, captured calls usually arrive as trace files, prompt experiment output, failed production examples, or local agent logs. Developers need to keep those captures organized, scrub sensitive fields, validate them repeatedly, and eventually turn the important ones into tests.

v0.2.0 should make that workflow first-class.

## Problem

AI tool-call regressions are often discovered after a prompt, schema, model, or tool description changes. Developers may have captured examples showing the expected tool behavior, but those captures are difficult to use as durable regression coverage.

Common problems:

- Captured calls live in ad hoc folders with no project-level convention.
- Validation output is flat, making it hard to see which file, suite, or contract regressed.
- Unknown tools in mixed traces create noise unless they are intentionally tracked.
- Captures may contain emails, tokens, customer text, account IDs, or other sensitive fields.
- Teams want regression tests, but do not want to hand-write boilerplate for every capture file.
- CI can validate captures, but the workflow is not yet ergonomic enough to become a habit.

Without a better capture workflow, `tool-call-contract validate` remains useful but mostly manual. v0.2.0 should make it feel like a regression harness.

## Goals

- Let projects define named capture suites in config.
- Validate suites without repeating long file globs in package scripts.
- Improve JSON and human validation reports with file, suite, and contract grouping.
- Add deterministic redaction for sensitive captured-call fields before captures are committed.
- Generate plain Vitest-compatible regression tests from configured capture suites.
- Keep generated tests assertion-library-light and easy to inspect.
- Preserve v0.1 behavior for direct `validate <files...>` usage.
- Keep the release local, deterministic, and network-free after dependencies are installed.

## Non-Goals

- Live model calls or LLM evaluation.
- Semantic quality scoring for model responses.
- Provider-specific adapters beyond the OpenAI normalization already in v0.1.
- Vitest custom matchers or Jest custom matchers.
- SARIF, GitHub Actions annotations, or dashboards.
- A hosted trace store.
- Full property-based or fuzz testing.
- Automatic source scanning for contract discovery.
- Valibot or JSON Schema contract definitions.

## Target Users

### Primary User

A TypeScript developer building an AI product with tool calls who wants to turn captured model behavior into repeatable CI coverage.

They already have:

- a `tool-call-contract.config.ts`,
- one or more captured-call JSON files,
- a test runner such as Vitest,
- and a desire to catch contract drift before shipping prompt or schema changes.

### Secondary Users

- Platform engineers standardizing agent testing across multiple repos.
- QA engineers validating model traces collected from staging or production.
- Library authors maintaining examples for reusable AI tool kits.
- Developers reviewing captured failures from prompt experiments.

## Product Principles

- Treat captures as untrusted input.
- Make sensitive-data handling explicit and deterministic.
- Keep generated tests readable enough to review.
- Prefer conventions that work in plain npm scripts and CI.
- Do not require users to adopt a framework-specific adapter.
- Keep the CLI useful without generated tests.
- Avoid hiding validation failures behind too much abstraction.

## Scope

### 1. Capture Suites

Add named capture suites to config.

Example:

```ts
import { defineConfig } from "tool-call-contract";
import { createIssue, searchDocs } from "./src/tools";

export default defineConfig({
  contracts: [createIssue, searchDocs],
  captures: {
    smoke: ["captures/smoke/*.json"],
    regression: ["captures/regression/**/*.json"],
    openai: ["captures/openai/*.json"],
  },
});
```

Expected behavior:

- `captures` is optional.
- Suite names must be non-empty strings.
- Suite file patterns should be resolved relative to the config `cwd`.
- The CLI should preserve deterministic file ordering.
- Direct file arguments continue to work.

CLI:

```sh
tool-call-contract validate --suite smoke
tool-call-contract validate --suite regression --json
tool-call-contract validate captures/manual.json
```

Rules:

- `validate` may accept file arguments, one or more suites, or both.
- Duplicate files should be validated once per command unless a later design explicitly needs per-suite duplication.
- Unknown suite names should produce a usage/config finding.
- Empty suites should produce a clear warning or error; the implementation plan can decide severity.

### 2. Grouped Validation Reports

Enhance validation reporting so real regression runs are easier to understand.

JSON report additions should include stable grouping metadata without breaking existing result entries.

Desired JSON shape:

```ts
interface JsonReport {
  schemaVersion: 1;
  command: "validate";
  success: boolean;
  summary: ReportSummary;
  findings?: Finding[];
  results?: ToolCallValidationResult[];
  validation?: {
    suites: Array<{
      name: string;
      files: string[];
      validResults: number;
      invalidResults: number;
    }>;
    files: Array<{
      path: string;
      suiteNames: string[];
      validResults: number;
      invalidResults: number;
    }>;
    contracts: Array<{
      name: string;
      validResults: number;
      invalidResults: number;
      unknownResults: number;
    }>;
  };
}
```

Human output should make it clear:

- which suite was validated,
- which file failed,
- which contract failed,
- and which issue path caused the failure.

The report should remain deterministic.

### 3. Redaction

Add a simple redaction workflow for captured JSON files.

Config:

```ts
export default defineConfig({
  contracts,
  redaction: {
    paths: [
      "arguments.email",
      "arguments.apiKey",
      "arguments.customer.ssn",
      "metadata.authorization",
    ],
    replacement: "[REDACTED]",
  },
});
```

CLI:

```sh
tool-call-contract redact captures/raw.json --out captures/safe/raw.json
tool-call-contract redact --suite regression --out-dir captures/redacted
tool-call-contract redact --check --suite regression
```

Expected behavior:

- Redaction should operate on JSON files only.
- The default replacement should be `"[REDACTED]"`.
- Paths should use a small, documented dot-path syntax.
- Redaction should preserve JSON formatting deterministically.
- `--check` should fail if files would change.
- Redaction should never execute tool handlers or model code.

Out of v0.2.0 unless implementation is trivial:

- JSONPath.
- Regex value matching.
- Built-in PII detection.
- Streaming redaction for very large files.

### 4. Generated Regression Tests

Generate plain TypeScript tests that validate configured capture suites.

CLI:

```sh
tool-call-contract generate-tests
tool-call-contract generate-tests --suite regression
tool-call-contract generate-tests --out test/tool-call-contract.generated.test.ts
```

Generated test style:

```ts
import { describe, expect, it } from "vitest";
import config from "../tool-call-contract.config";
import { validateToolCalls } from "tool-call-contract";
import capture from "../captures/regression/create-issue.json";

describe("tool-call-contract regression captures", () => {
  it("validates captures/regression/create-issue.json", () => {
    const results = validateToolCalls(config.contracts, capture);
    expect(results.every((result) => result.ok)).toBe(true);
  });
});
```

Expected behavior:

- Generated tests should be deterministic.
- Generated tests should use public package APIs.
- Generated tests should not require custom matchers.
- Generated tests should work with Vitest first.
- If capture imports need JSON import assertions or Node loader behavior, the technical design should choose the least surprising approach.

Open question for TDD:

- Whether generated tests should import JSON directly or read files at runtime through `node:fs`.

### 5. Docs And Examples

Update docs and examples to show the v0.2 workflow:

```sh
tool-call-contract validate --suite regression
tool-call-contract redact --check --suite regression
tool-call-contract generate-tests --suite regression
```

The example project should include:

- at least two capture suites,
- one redaction example,
- one generated-test example or expected output fixture,
- and docs showing how to wire the workflow into `package.json`.

## User Stories

### Capture Suite Validation

As a developer, I want to define a named `regression` capture suite so I can run one stable command in CI without repeating file globs.

Acceptance criteria:

- Given a config with `captures.regression`, `tool-call-contract validate --suite regression` validates all matching files.
- The report identifies the suite and each file.
- Missing or empty suite patterns produce a clear message.

### Redaction Before Commit

As a developer, I want to redact sensitive fields from captured calls so I can commit useful regression examples safely.

Acceptance criteria:

- Given a redaction path, the CLI replaces matching values deterministically.
- `--check` fails when a file still contains unredacted configured paths.
- Redaction output can be reviewed as normal JSON.

### Generated Regression Test

As a developer, I want to generate a Vitest test from a capture suite so captured traces run as part of my normal test command.

Acceptance criteria:

- `generate-tests` writes a deterministic TypeScript test file.
- The generated test validates all configured suite files.
- Running Vitest fails when any captured call violates its contract.

### CI Diagnosis

As a CI user, I want validation output grouped by suite, file, and contract so I can quickly identify what changed.

Acceptance criteria:

- JSON reports include grouped validation metadata.
- Human reports include enough file and contract context to debug failures without opening the JSON.

## CLI Changes

Existing commands:

```sh
tool-call-contract check
tool-call-contract generate
tool-call-contract validate <files...>
```

New or expanded commands:

```sh
tool-call-contract validate --suite <name>
tool-call-contract redact <files...>
tool-call-contract redact --suite <name>
tool-call-contract redact --check --suite <name>
tool-call-contract generate-tests
tool-call-contract generate-tests --suite <name>
```

The exact command names can be refined in the technical design, but the product requirements are:

- suite-based validation,
- deterministic redaction,
- and generated regression tests.

## Config Changes

Extend `defineConfig` input:

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
}
```

Compatibility:

- Existing v0.1 configs remain valid.
- New fields are optional.
- Invalid `captures` or `redaction` config should produce structured config errors.

## Reporting Requirements

Validation report improvements should preserve:

- `schemaVersion: 1` unless the technical design concludes the JSON contract needs a version bump.
- existing `results` entries,
- stable issue codes,
- stable file paths relative to project root,
- deterministic ordering.

New finding IDs may include:

```text
capture.suite-unknown
capture.suite-empty
capture.file-not-found
redaction.path-invalid
redaction.would-change
generated-test.write-failed
```

The technical design should confirm final IDs.

## Security And Privacy

- Captures are untrusted JSON.
- Redaction is a deterministic transform, not a guarantee that all sensitive data has been removed.
- Docs must state that users are responsible for choosing redaction paths appropriate to their trace format.
- Config loading remains trusted code execution.
- Generated tests must not execute tool implementations.

## Success Metrics

v0.2.0 succeeds if:

- A project can define a capture suite and validate it in CI with one command.
- A project can redact configured fields before committing captures.
- A project can generate a Vitest regression test from capture suites.
- The example project demonstrates the full capture-to-test workflow.
- Existing v0.1 commands and configs continue to work.

## Release Criteria

- Full release verification passes.
- Existing v0.1 tests continue to pass.
- New suite validation, redaction, and generated-test behavior has focused unit and integration coverage.
- README documents the v0.2 workflow.
- `docs/v0.2.0` contains PRD, technical design, and implementation plan before implementation begins.
- Packaged artifact remains small and excludes generated example output.

## Open Questions For Technical Design

- Should capture suite file matching use a new dependency or a small internal glob implementation?
- Should generated tests import JSON directly or read JSON at runtime?
- Should `redact` mutate files by default or require explicit `--write`?
- Should `validate --suite` allow multiple suites in one invocation?
- Should grouped report metadata require `schemaVersion: 2`, or can it fit into the current optional report shape?
- Should `redaction.paths` match the normalized call shape, the raw capture shape, or both?
