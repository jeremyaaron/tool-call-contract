# Changelog

## 0.5.0

Generated artifact freshness and CI ergonomics release.

- Added `artifacts` as a read-only command for inspecting generated fixture, schema, doc, and manifest freshness.
- Added `artifacts --check` as a focused CI gate that fails when generated artifacts or the manifest are missing, stale, or unsafe.
- Preserved broad `check` compatibility: generated artifacts remain optional until a manifest exists.
- Clarified the artifact lifecycle across `generate`, `artifacts`, `artifacts --check`, `check`, and `generate --clean`.
- Added `tool-contracts:artifacts` to generated starter package scripts.
- Introduced an internal artifact planning boundary to keep write, inspect, check, and clean behavior consistent without exposing unstable planner internals.
- Expanded artifact lifecycle coverage across CLI, example, and release verification paths.

## 0.4.0

Adoption and operability release.

- Added `init` to bootstrap a starter config, sample raw trace, normalized regression fixture, and package scripts.
- Added command-specific help with real usage, options, examples, and notes.
- Refined docs terminology around raw traces, normalized captures, and reviewed regression fixtures.
- Added agent guidance and provider/framework cookbooks for OpenAI Responses, Vercel AI SDK, and LangChain.
- Expanded smoke coverage for the bootstrap-to-regression workflow and command JSON reports.
- Upgraded release verification to exercise `pkg-guard`'s experimental diagnostics API while keeping the stable `pkg-guard check` gate.

## 0.3.0

Raw trace normalization release.

- Added public normalization helpers for converting tool-call captures into the canonical capture shape.
- Added `normalize` with dry-run, write, and check modes.
- Added normalization support for `normalized`, OpenAI Chat Completions, OpenAI Responses, Vercel AI SDK, LangChain, and configured generic JSON traces.
- Added normalization report metadata and human-readable normalization summaries.
- Reused normalization internals from validation while preserving existing validation compatibility.
- Expanded the example project, README, and site to demonstrate raw-trace-to-regression workflows.

## 0.2.0

Captured-call regression workflow release.

- Added named capture suites with `validate --suite`.
- Added grouped validation report metadata for suites, files, and contracts.
- Added deterministic capture redaction with `redact`, `--check`, `--dry-run`, `--out`, and `--out-dir`.
- Added `generate-tests` to create plain Vitest regression tests from configured capture suites.
- Expanded the example project and README to demonstrate capture suites, redaction, and generated tests.

## 0.1.1

Maintenance patch.

- Upgraded `pkg-guard` to exercise improved workflow script analysis in a real consumer.
- Isolated the example end-to-end test by copying `examples/basic` into a temporary project before generating artifacts.

## 0.1.0

Initial MVP release.

- Define Zod-backed AI tool-call contracts.
- Validate normalized, OpenAI Chat Completions-style, and OpenAI Responses-style captured calls.
- Generate deterministic fixtures, OpenAI tool schemas, Markdown docs, and an artifact manifest.
- Check contract quality and generated artifact freshness.
- Write and clean generated artifacts safely inside the configured output directory.
