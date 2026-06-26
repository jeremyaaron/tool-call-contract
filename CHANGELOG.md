# Changelog

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
