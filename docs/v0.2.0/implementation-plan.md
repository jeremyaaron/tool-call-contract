# tool-call-contract v0.2.0 Implementation Plan

## Purpose

This plan breaks the v0.2.0 PRD and technical design into phases sized for one normal code-review-commit cycle. Each phase should leave the repository working, tested, and easy to review.

v0.2.0 is not a rewrite. It deepens the v0.1 validation loop into a practical captured-call regression workflow:

- named capture suites,
- grouped validation reports,
- deterministic redaction,
- generated Vitest regression tests,
- and updated examples/docs.

## Phase Sizing

A phase should usually fit in one focused implementation pass when:

- it changes one primary subsystem,
- it has direct tests,
- it preserves existing v0.1 behavior,
- it avoids mixing read-only planning with file mutation,
- and it leaves `npm test`, `npm run typecheck`, and targeted CLI tests in a meaningful state.

If a phase starts touching config, validation, reporting, redaction, and generated tests at once, split it before continuing.

## Phase 0: Config Types And Capture Suite Resolver

Goal: add the data model needed for v0.2.0 without changing command behavior yet.

Scope:

- Extend `ToolCallContractConfig` with optional `captures` and `redaction`.
- Add `CaptureSuiteConfig` and `RedactionConfig` types.
- Normalize `captures` and `redaction` in `loadConfig`.
- Add config validation errors for invalid suite names, invalid suite patterns, invalid redaction paths, and invalid replacement values.
- Add a small glob dependency for suite expansion.
- Implement `src/captures.ts` with:
  - suite lookup,
  - deterministic glob expansion,
  - direct file handling,
  - deduplication,
  - project-relative POSIX paths,
  - and outside-root protection.
- Add unit tests for config normalization and capture suite resolution.

Out of scope:

- CLI `--suite` parsing.
- Grouped report rendering.
- Redaction transforms.
- Generated tests.

Acceptance criteria:

- Existing v0.1 configs still load unchanged.
- Configs with valid `captures` and `redaction` load successfully.
- Invalid new config fields produce `config.invalid` with clear messages.
- Suite resolver returns deterministic `CaptureFileRef` entries.
- Unknown suites and empty selected suites produce structured findings.
- Direct file paths outside `cwd` are rejected.

## Phase 1: CLI Suite Parsing And `validate --suite`

Goal: make named capture suites usable through the existing `validate` command.

Scope:

- Add repeatable `--suite <name>` parsing.
- Allow `validate` with files, suites, or both.
- Preserve the existing `validate <files...>` behavior.
- Wire `resolveCaptureFiles` into `validate`.
- Validate each resolved file once per command.
- Preserve `--allow-unknown`.
- Add CLI tests for:
  - `validate --suite smoke`,
  - repeated `--suite`,
  - suite plus direct file,
  - unknown suite,
  - empty suite,
  - and `validate` with neither files nor suites.

Out of scope:

- Grouped validation metadata.
- Human report grouping.
- Redaction.
- Generated tests.

Acceptance criteria:

- `tool-call-contract validate --suite smoke` validates matching configured files.
- Duplicate files from overlapping suites are validated once.
- Direct file validation remains backward compatible.
- `--allow-unknown` still converts unknown-tool results into warnings.
- Usage errors still exit `2`; validation failures still exit `1`.

## Phase 2: Grouped Validation Reports

Goal: make validation output useful for regression-suite diagnosis.

Scope:

- Add optional `validation` metadata to `CommandReport`.
- Implement grouped validation summary generation for suites, files, and contracts.
- Keep `schemaVersion: 1`.
- Render suite/file summaries in human output before per-result details.
- Preserve existing `results` entries and `summary` behavior.
- Add reporter tests for JSON and human output.
- Add CLI integration tests for grouped metadata from suite validation.

Out of scope:

- New report schema version.
- SARIF or GitHub Actions annotations.
- Redaction reports.
- Generated-test reports.

Acceptance criteria:

- JSON validation reports include deterministic `validation.suites`, `validation.files`, and `validation.contracts`.
- Human output identifies selected suites, files, and invalid contracts clearly.
- Existing JSON consumers can still read `results` and `summary`.
- Existing v0.1 reporter tests continue to pass.

## Phase 3: Redaction Core

Goal: implement deterministic redaction as a library-internal planner before adding CLI writes.

Scope:

- Add `src/redaction.ts`.
- Implement dot-path parsing.
- Support `*` wildcards.
- Apply paths recursively from every object node in parsed JSON.
- Replace matched values with the configured replacement string.
- Default replacement to `"[REDACTED]"` at execution time.
- Preserve deterministic JSON formatting through the existing JSON formatter.
- Produce per-file redaction plan entries with changed status and replacement counts.
- Add unit tests for:
  - valid and invalid paths,
  - nested object replacement,
  - array wildcard replacement,
  - recursive matching inside wrapper objects,
  - no-op paths,
  - malformed JSON,
  - and stable formatting.

Out of scope:

- CLI command wiring.
- File writes.
- Regex matching.
- PII detection.
- JSONPath.

Acceptance criteria:

- Redaction is deterministic across repeated runs.
- Redaction never normalizes calls or executes tool code.
- The planner reports whether each file would change.
- Invalid redaction paths produce `redaction.path-invalid`.

## Phase 4: `redact` CLI

Goal: expose redaction through a safe, scriptable command.

Scope:

- Add `redact` to command parsing and help output.
- Support:
  - direct files,
  - repeated `--suite`,
  - `--out`,
  - `--out-dir`,
  - `--check`,
  - `--dry-run`,
  - and `--json`.
- Enforce invalid option combinations:
  - `--out` with multiple files,
  - `--out` plus `--out-dir`,
  - `--check` plus write output options.
- Wire capture suite resolution into `redact`.
- Implement in-place writes when no output option is provided.
- Implement destination path safety.
- Add optional `redaction` metadata to `CommandReport`.
- Add human and JSON redaction output.
- Add CLI tests for check mode, dry run, in-place write, `--out`, `--out-dir`, suite mode, and invalid options.

Out of scope:

- Generated regression tests.
- Configurable CLI-only redaction paths.
- Streaming large files.

Acceptance criteria:

- `redact --check --suite regression` exits `0` when files are already redacted.
- `redact --check` exits `1` and reports `redaction.would-change` when files would change.
- `redact captures/raw.json --out captures/safe/raw.json` writes the redacted output.
- `redact --suite regression --out-dir captures/redacted` mirrors project-relative capture paths under the output directory.
- Writes cannot escape `cwd`.

## Phase 5: Generated Test Renderer

Goal: generate deterministic Vitest test content without introducing file writes yet.

Scope:

- Add `src/test-generation.ts`.
- Resolve selected capture suites for test generation.
- If no suite is supplied, select all configured suites.
- Render a TypeScript test file that:
  - imports `readFile` from `node:fs/promises`,
  - imports `describe`, `expect`, and `it` from `vitest`,
  - imports `validateToolCalls` from `tool-call-contract`,
  - imports the user's config through a relative path,
  - reads capture JSON at runtime,
  - and asserts every validation result is ok.
- Compute capture file URLs relative to the generated test output path.
- Keep display labels project-relative.
- Add unit tests for rendering, path escaping, custom output locations, no configured captures, and deterministic ordering.

Out of scope:

- `generate-tests` CLI command.
- File writes.
- Running the generated test in a fixture project.

Acceptance criteria:

- Generated content is stable across repeated renders.
- Generated content works for the default output path and custom nested output paths.
- Generated tests do not import CLI internals.
- Generated tests do not execute tool handlers or model code.

## Phase 6: `generate-tests` CLI

Goal: write generated regression tests as a user-facing command.

Scope:

- Add `generate-tests` to command parsing and help output.
- Support:
  - repeated `--suite`,
  - `--out`,
  - `--dry-run`,
  - and `--json`.
- Default output path to `test/tool-call-contract.generated.test.ts`.
- Enforce output path safety under `cwd`.
- Write generated test files when content changed.
- Report created, updated, and unchanged status.
- Add optional `generatedTests` metadata to `CommandReport`.
- Add human and JSON output for generated tests.
- Add CLI tests for default output, custom output, dry run, unknown suite, no captures, and unchanged second run.

Out of scope:

- Custom test runner support.
- Vitest custom matchers.
- Automatic package script editing.

Acceptance criteria:

- `tool-call-contract generate-tests --suite regression` writes a deterministic TypeScript test file.
- Running the command twice reports unchanged on the second run.
- `--dry-run` reports the planned output without writing.
- Missing capture configuration produces a clear generated-test/capture finding.

## Phase 7: Example Project And README Updates

Goal: document and demonstrate the full v0.2.0 capture-to-test workflow.

Scope:

- Update the example config with at least two capture suites.
- Add capture fixtures for:
  - smoke validation,
  - regression validation,
  - and redaction.
- Add an already-redacted fixture for `redact --check`.
- Update the e2e test to run:
  - `check`,
  - `generate`,
  - `validate --suite smoke`,
  - `redact --check --suite regression`,
  - and `generate-tests --suite regression`.
- Verify generated-test output contains expected capture names.
- Update README with:
  - capture suite config,
  - `validate --suite`,
  - redaction workflow,
  - generated tests,
  - package script examples,
  - and limitations.
- Update CLI help snapshots or assertions as needed.

Out of scope:

- Running a nested package install inside the example project unless it is already cheap and reliable.
- Website redesign.
- Provider-specific adapter docs.

Acceptance criteria:

- README has copy-pasteable v0.2.0 usage.
- Example fixtures demonstrate the intended workflow without network access.
- E2E tests cover the primary capture-to-test path.
- Docs clearly state that redaction is deterministic replacement, not PII detection.

## Phase 8: v0.2.0 Release Hardening

Goal: prepare the package for a clean v0.2.0 release.

Scope:

- Bump package version to `0.2.0`.
- Update exported `version`.
- Update changelog/release notes.
- Review public exports for accidental unstable internals.
- Run the full verification suite:
  - lint,
  - format,
  - typecheck,
  - tests,
  - build,
  - package checks,
  - packed-package smoke test.
- Run `pkg-guard check` through the existing release verification.
- Review packed package contents.
- Confirm docs match shipped behavior.

Out of scope:

- npm publishing itself.
- GitHub Pages redesign unless docs/site links need a small content update.
- New provider adapters.
- New schema libraries.

Acceptance criteria:

- `npm run verify:release` passes.
- `npm pack --dry-run --ignore-scripts` includes only expected files.
- The built CLI reports version `0.2.0`.
- Release notes accurately describe capture suites, redaction, generated tests, and grouped reports.
- The repo is ready for tagging after review.

## Deferred Post-v0.2.0 Work

These ideas are useful, but intentionally outside v0.2.0:

- Vitest or Jest custom matchers.
- SARIF and GitHub Actions annotation reporters.
- Built-in PII detection.
- Regex redaction rules.
- JSONPath redaction.
- Capture coverage reports by contract/schema field.
- Provider-specific trace importers.
- Vercel AI SDK, Mastra, LangChain, Anthropic, Gemini, and MCP adapters.
- Contract diffing for pull requests.
- Automatic package script editing.
- Watch mode.

## Phase Completion Rule

At the end of each implementation phase:

- Update tests for the behavior added in that phase.
- Run targeted tests plus any relevant verification commands.
- Run formatting when docs or generated code changed.
- Update README or examples only when user-facing behavior changed.
- Check `git status --short`.
- Commit only the scoped phase diff when the user asks to commit.

Each completed phase should leave the repository ready for the next phase without relying on uncommitted generated output, unpublished packages, or manual setup outside the repo.
