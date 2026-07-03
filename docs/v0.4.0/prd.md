# tool-call-contract v0.4.0 PRD

## Summary

`tool-call-contract` v0.4.0 should make the v0.3 workflow easier for humans and coding
agents to adopt correctly.

v0.1.0 proved the core contract model. v0.2.0 added a captured-call regression loop.
v0.3.0 added normalization so raw provider and framework traces can become stable
regression fixtures.

The next adoption gap is not another provider format. The next gap is operability:

- users need a sharper mental model for what captures are and are not,
- coding agents need procedural instructions instead of broad prose,
- CLI help needs to expose the real command-specific workflow,
- new projects need a bootstrap path,
- and the repo should dogfood `pkg-guard`'s new experimental diagnostics API as part of
  release-quality checks.

The v0.4.0 theme is:

> Make tool-call contract regression easy to discover, scaffold, and operate.

This release should turn `tool-call-contract` from "usable if you already understand the
workflow" into "easy to integrate into an existing TypeScript agent project."

## Background

The current product supports:

- Zod-backed tool contracts.
- Generated fixtures, OpenAI-compatible schemas, docs, and manifests.
- Contract and artifact freshness checks.
- Capture suites.
- Validation of normalized and OpenAI-style captures.
- Deterministic redaction.
- Generated Vitest regression tests.
- Normalization from supported raw provider/framework traces.

That is enough for a motivated developer to build a regression workflow. It is not yet
enough for a fresh coding agent or first-time user to reliably infer the intended path.

Recent dogfooding clarified an important vocabulary problem:

- runtime traces are operational telemetry;
- committed captures are curated regression fixtures;
- `tool-call-contract` is not a telemetry store;
- and normalization bridges selected trace examples into testable fixtures.

The product should say this explicitly. Captures in the repo are useful when they are
small, reviewed, redacted, stable examples for CI. They are not where production-scale
agent logs belong.

## Problem

`tool-call-contract` is now feature-complete enough to be useful, but adoption still has
too much implicit knowledge.

First-time users and coding agents have to answer:

- Should raw traces be committed?
- What is a capture?
- What is the difference between a raw trace, a normalized capture, and a generated
  fixture?
- Which commands should run locally and which should run in CI?
- What options does each command accept?
- How do I set up the initial directory layout?
- How do I adapt one trace from OpenAI Responses, Vercel AI SDK, or LangChain?
- How do I avoid treating the repo as a production log store?

Current failure modes:

- Users assume `tool-call-contract` captures runtime calls automatically.
- Users assume committed captures are an analytics dataset instead of regression fixtures.
- Agents run `tool-call-contract --help`, miss important command options, and produce
  incomplete integrations.
- Projects skip redaction or normalize directly into committed fixtures without
  understanding privacy boundaries.
- Every adopter hand-writes initial config, scripts, directories, and sample captures.
- Release verification uses `pkg-guard` CLI checks but does not exercise the new
  experimental diagnostics API that is meant to support future editor integrations.

## Goals

- Clarify the product's scope and vocabulary.
- Make command-specific CLI help accurate and copy-pasteable.
- Add a project bootstrap command for a small working setup.
- Add procedural docs that coding agents can follow with minimal inference.
- Add framework capture cookbooks for the primary supported trace sources.
- Preserve the current local, deterministic, network-free default workflow.
- Exercise `pkg-guard@0.5.0`'s experimental diagnostics API in this repo's verification
  path without making it part of `tool-call-contract`'s product surface.
- Keep the release focused on adoption and operability rather than broadening provider
  support.

## Non-Goals

- Production trace storage.
- Hosted dashboards.
- Datadog, Langfuse, LangSmith, or OpenTelemetry integrations.
- Runtime instrumentation packages.
- Live model calls.
- Automatic PII detection.
- Runtime policy enforcement.
- Tool result contracts.
- Streaming delta reconstruction.
- New normalization providers beyond small fixture updates needed for docs.
- A VS Code extension for `tool-call-contract`.
- A VS Code extension for `pkg-guard`.
- Stable public dependency on `pkg-guard`'s experimental API from application code.

## Target Users

### Primary User

A TypeScript developer or coding agent integrating `tool-call-contract` into an existing
agentic application.

They likely have:

- existing tool definitions or handlers,
- a package manager and test runner,
- one or more tool-call traces from local development or telemetry,
- and a desire to add CI regression coverage without adopting a new agent framework.

### Secondary Users

- Maintainers of starter kits and templates.
- Platform engineers standardizing tool-call testing across repos.
- Developers using coding agents to add package integrations.
- Future maintainers of framework-specific capture adapters.
- Maintainers of `pkg-guard` who want real-consumer feedback on the experimental
  diagnostics API.

## Product Principles

- Be explicit about scope boundaries.
- Treat committed captures as test fixtures, not logs.
- Prefer procedural recipes over conceptual prose for integration tasks.
- Make CLI help useful without requiring the README.
- Keep bootstrap output small, inspectable, and easy to delete.
- Do not hide privacy caveats behind advanced docs.
- Dogfood adjacent tooling where it improves release quality, but avoid product coupling.

## Scope

### 1. Vocabulary And Positioning

Add a prominent "what this is / what this is not" section to README and any agent-facing
guide.

Core message:

```text
tool-call-contract defines and tests contracts for AI tool calls.
It validates tool calls wherever you have them.
It can normalize selected raw traces into small regression fixtures.
It is not a telemetry backend, model runner, tool orchestrator, or PII detector.
```

Define:

- **contract**: a named tool schema and metadata in code.
- **raw trace**: provider/framework/app output from runtime behavior.
- **normalized capture**: the canonical JSON shape used for validation.
- **regression fixture**: a small reviewed capture committed to the repo.
- **generated fixture**: synthetic valid/invalid examples produced from contracts.

Docs should recommend:

- operational traces live in logs, databases, object storage, or observability systems;
- selected examples may be exported into the repo as regression fixtures;
- committed fixtures should be redacted and reviewed;
- large runtime datasets do not belong in git.

### 2. Command-Specific Help

Add command-specific help for:

```text
check
generate
validate
redact
normalize
generate-tests
init
```

Expected behavior:

```sh
tool-call-contract normalize --help
tool-call-contract help normalize
```

Both should show command-specific usage, options, and examples.

Each command help page should include:

- one-line purpose,
- usage,
- command-specific options,
- common examples,
- output behavior,
- and safety notes where relevant.

The global help should stay concise and point to command help.

Acceptance criteria:

- An agent using only `--help` can discover `--out`, `--out-dir`, `--check`, `--dry-run`,
  `--allow-unknown`, `--strict`, `--ignore`, `--suite`, and `--format`.
- Help output stays deterministic and covered by tests.

### 3. `init` Command

Add a bootstrap command:

```sh
tool-call-contract init
```

Default behavior should create a minimal local setup:

```text
tool-call-contract.config.ts
captures/
  raw/
    openai-responses.json
  regression/
    openai-responses.json
test/
  tool-call-contract.generated.test.ts
```

The exact generated test file may be created directly or left to `generate-tests`; the TDD
should choose the least surprising behavior.

The generated config should include:

- one sample Zod contract,
- `raw` and `regression` capture suites,
- a simple redaction config,
- and comments only where they reduce ambiguity.

The command should also add package scripts when a `package.json` exists:

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

Safety rules:

- Do not overwrite existing files unless the user passes a force option.
- Writes must stay inside `cwd`.
- Existing `package.json` formatting should be preserved as much as practical.
- The command should report created, skipped, and updated files.

Open question for TDD:

- Whether `init` should support `--dry-run` in v0.4.0.
- Whether package script updates should be default or gated behind `--package-scripts`.
- Whether the generated config should use `.ts`, `.mjs`, or infer from project metadata.

### 4. Agent Integration Guide

Add an `AGENTS.md` or `docs/for-coding-agents.md`.

It should be procedural, not essay-like.

Required sections:

- "When asked to add tool-call-contract to a project"
- "Inspect existing tools"
- "Create contracts"
- "Add capture suites"
- "Normalize one raw trace"
- "Redact before committing"
- "Validate and generate tests"
- "Add package scripts"
- "Run verification"
- "Do not do these things"

The guide should include exact command sequences and common failure handling.

It should explicitly say:

- do not invent production traces;
- do not commit secrets;
- do not treat raw telemetry stores as repo fixtures;
- do not add unsupported framework claims;
- do not import internal package files.

Acceptance criteria:

- A coding agent can follow the guide to add the package to a new TypeScript project
  without reading the full PRD/TDD history.

### 5. Framework Capture Cookbooks

Add docs-first capture cookbooks for:

- OpenAI Responses,
- Vercel AI SDK,
- LangChain.

Each cookbook should answer:

- where tool-call data usually appears,
- what shape `tool-call-contract normalize` expects,
- what a minimal raw trace file looks like,
- how to normalize it,
- how to validate it,
- and where production traces should live in real deployments.

Cookbooks should avoid claiming automatic instrumentation.

OpenAI Responses cookbook should use the existing `openai-responses` format.

Vercel AI SDK cookbook should use the existing `vercel-ai-sdk` format and focus on
recorded message/tool-call objects rather than live SDK integration.

LangChain cookbook should use the existing `langchain` format and focus on message
objects with `tool_calls`.

Acceptance criteria:

- Each cookbook includes one raw JSON example and one command sequence.
- Examples are synthetic and safe to commit.
- Docs clearly separate local development files from production telemetry.

### 6. Canonical CI Pipeline

Document one recommended CI order:

```sh
tool-call-contract check
tool-call-contract generate --dry-run
tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression --check
tool-call-contract redact --check --suite regression
tool-call-contract validate --suite regression
tool-call-contract generate-tests --suite regression --dry-run
```

The TDD should decide whether `generate --dry-run` and `generate-tests --dry-run` are the
right CI recommendations, or whether artifact freshness checks through `check` are enough.

Docs should explain:

- local update commands,
- CI check commands,
- and what to commit.

### 7. pkg-guard Experimental Diagnostics Dogfooding

Upgrade `pkg-guard` to `^0.5.0` and add a small verification script that consumes:

```ts
import { analyzePackageForDiagnostics } from "pkg-guard/experimental/analysis";
```

The script should:

- run against the current package,
- use `mode: "fast"` for a quick diagnostics pass,
- fail on `error` diagnostics,
- print warnings in a compact file/path/range-aware format,
- and avoid replacing `pkg-guard check` in the release path until the experimental API
  stabilizes.

Optional TDD evaluation:

- whether release verification should also run `mode: "default"`;
- whether the script should assert that the API returns package metadata;
- whether diagnostics should be snapshotted in a test.

Product boundary:

- This is dogfooding infrastructure, not a public `tool-call-contract` feature.
- Do not expose `pkg-guard` diagnostics through `tool-call-contract` CLI.
- Do not add runtime dependency on `pkg-guard`.

Acceptance criteria:

- `tool-call-contract` explicitly depends on `pkg-guard@^0.5.0`.
- Verification exercises the experimental API.
- Existing `pkg-guard check` release verification remains intact.
- Any issues or API friction discovered should be documented for possible `pkg-guard`
  follow-up.

### 8. README And Site Refresh

Update README and the product site to reflect v0.4 positioning.

README should:

- move the "what this is / is not" section near the top,
- mention `init`,
- link to command help,
- link to agent guide,
- link to framework cookbooks,
- and clarify captures as regression fixtures.

The site should receive only a small content update unless the current copy becomes
materially stale.

## User Stories

### Understand The Product Boundary

As a new user, I want to know whether `tool-call-contract` stores runtime traces so that I
do not design the wrong architecture around it.

Acceptance criteria:

- README states that operational traces live outside the repo.
- README states that committed captures are curated regression fixtures.
- README states that the package is not a telemetry backend.

### Bootstrap A New Project

As a developer, I want one command to create a working example setup so I can run the
workflow before adapting it to my real tools.

Acceptance criteria:

- `tool-call-contract init` creates a valid config and example captures.
- The generated project can run check, normalize, redact, validate, and generate-tests.
- Existing files are not overwritten by default.

### Discover Command Usage From Help

As a coding agent, I want command-specific help so I can integrate the package without
guessing options from README prose.

Acceptance criteria:

- `tool-call-contract <command> --help` returns command-specific usage.
- Help output includes examples for common workflows.
- Tests cover global and command help.

### Capture One Framework Trace

As a developer using OpenAI Responses, Vercel AI SDK, or LangChain, I want a cookbook that
shows exactly how to turn one recorded tool call into a regression fixture.

Acceptance criteria:

- Each cookbook includes raw input, command sequence, and caveats.
- Examples do not require live provider calls.

### Dogfood pkg-guard Diagnostics

As the maintainer of both packages, I want `tool-call-contract` to exercise
`pkg-guard`'s experimental diagnostics API so the future editor integration is tested in a
real consumer.

Acceptance criteria:

- A verification script imports the experimental API.
- Diagnostics include enough metadata for compact output.
- Release verification still passes.

## CLI Sketch

```sh
tool-call-contract --help
tool-call-contract help normalize
tool-call-contract normalize --help

tool-call-contract init
tool-call-contract init --dry-run
tool-call-contract init --force
```

Potential global help:

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

## Success Metrics

- A fresh coding agent can install and configure the package using help output plus
  `AGENTS.md`.
- `init` produces a working setup that passes the documented local workflow.
- README makes the traces-vs-fixtures boundary unambiguous.
- Framework cookbooks cover one safe synthetic trace each.
- Release verification exercises `pkg-guard/experimental/analysis`.
- No existing v0.3 workflows regress.

## Risks And Mitigations

- **Risk:** `init` overwrites user work.
  **Mitigation:** no overwrite by default; explicit `--force`; report skipped files.

- **Risk:** command help becomes long and hard to scan.
  **Mitigation:** keep global help short; put examples in command help.

- **Risk:** docs imply automatic production instrumentation.
  **Mitigation:** repeat that cookbooks use recorded/exported traces, not live capture.

- **Risk:** `pkg-guard` experimental API churn breaks release verification.
  **Mitigation:** pin to `^0.5.0` during this sprint; isolate usage in one script; keep
  `pkg-guard check` as the stable gate.

- **Risk:** users confuse generated fixtures with captured regression fixtures.
  **Mitigation:** define both terms explicitly and use them consistently.

## Open Questions

- Should `init` update `package.json` scripts by default?
- Should `init` generate a test file directly or instruct users to run `generate-tests`?
- Should `init` support `--dry-run` in v0.4.0?
- Should command help be embedded strings or structured data shared with tests?
- Should the agent guide live at repo root as `AGENTS.md`, in `docs/`, or both?
- Should `pkg-guard` diagnostic API dogfooding run in fast mode only or both fast and
  default modes?
- Should v0.4.0 include any small public helper rename or terminology cleanup around
  "capture" vs "fixture", or should that remain documentation-only?
