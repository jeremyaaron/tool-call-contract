# tool-call-contract v0.3.0 Implementation Plan

## Purpose

This plan breaks the v0.3.0 PRD and technical design into phases sized for one normal
code-review-commit cycle. Each phase should leave the repository working, tested, and easy
to review.

v0.3.0 adds capture ingestion to the v0.2 regression workflow:

- shared path selectors,
- generic normalization config,
- side-effect-free normalization helpers,
- provider/framework trace extraction,
- a `normalize` CLI with dry-run/check/write modes,
- normalization reports,
- validation reuse of normalization internals,
- and updated examples/docs.

The release should not become an observability platform or agent framework. Its job is to
make raw JSON traces easy to turn into normalized, redacted, validated regression captures.

## Phase Sizing

A phase should usually fit in one focused implementation pass when:

- it changes one primary subsystem,
- it has direct tests,
- it preserves existing v0.1 and v0.2 behavior,
- it avoids mixing planning-only docs with code mutation,
- and it leaves `npm test`, `npm run typecheck`, and targeted CLI tests in a meaningful
  state.

If a phase starts touching path selectors, provider extraction, CLI writes, reporting, and
examples all at once, split it before continuing.

## Phase 0: Shared Path Selectors And Config Types

Goal: add the foundational data model for normalization without changing command behavior.

Scope:

- Add `NormalizationConfig` and `GenericNormalizationConfig` types.
- Extend `ToolCallContractConfig` with optional `normalization`.
- Validate `normalization.generic` in `loadConfig`.
- Add `src/path-selectors.ts` by extracting the existing redaction dot-path parser and
  traversal behavior.
- Preserve redaction's current recursive application behavior by layering it on top of the
  shared selector helper.
- Add unit tests for:
  - valid dot paths,
  - invalid empty paths,
  - empty segments,
  - object property selection,
  - array index selection,
  - wildcard object selection,
  - wildcard array selection,
  - generic config validation,
  - and redaction behavior after extraction.

Out of scope:

- Normalization format extraction.
- Public normalization helpers.
- CLI `normalize`.
- Reporting changes.

Acceptance criteria:

- Existing v0.1 and v0.2 configs still load unchanged.
- Configs with valid `normalization.generic` load successfully.
- Invalid normalization config produces `config.invalid` with clear messages.
- Redaction tests still pass with unchanged behavior.
- `src/path-selectors.ts` supports the syntax required by generic normalization.

## Phase 1: Normalization Core And Public Helpers

Goal: introduce the canonical normalization API and normalized format support before adding
provider-specific extractors.

Scope:

- Add `src/normalization.ts`.
- Define:
  - `NormalizationFormat`,
  - `NormalizeToolCallsOptions`,
  - `NormalizeToolCallsResult`,
  - and `ToolCallSource` additions.
- Add side-effect-free public helpers:
  - `normalizeToolCallCapture`,
  - `normalizeToolCallCaptures`.
- Implement `format: "normalized"` for:
  - `{ name, arguments }`,
  - arrays of normalized calls,
  - compatibility `{ toolName, args }`,
  - JSON string arguments that parse to objects,
  - optional `id`,
  - and `includeSource`.
- Enforce final normalized shape:
  - non-empty string name,
  - present arguments,
  - arguments object after parsing,
  - non-array arguments,
  - deterministic call order.
- Export the new helpers and types from `src/index.ts`.
- Add focused unit tests for normalized input behavior and public exports.

Out of scope:

- OpenAI/Vercel/LangChain/generic extractors.
- CLI wiring.
- File writes.
- Validation refactor.

Acceptance criteria:

- `normalizeToolCallCaptures(input, { format: "normalized" })` returns deterministic calls.
- Source metadata is omitted by default.
- `includeSource: true` preserves stable `id` and `source`.
- Invalid names and arguments produce structured `ToolCallIssue` entries.
- No file IO or config loading is required to use the helpers.

## Phase 2: Provider And Framework Format Extractors

Goal: support the explicit provider/framework formats promised for v0.3.0.

Scope:

- Add `src/normalization-formats.ts` or equivalent internal helpers.
- Implement extraction for:
  - `openai-chat`,
  - `openai-responses`,
  - `vercel-ai-sdk`,
  - `langchain`,
  - and `generic`.
- Keep extraction shallow and fixture-backed.
- Support OpenAI Chat completion roots and assistant message roots.
- Support OpenAI Responses roots and direct `function_call` items.
- Support Vercel AI SDK `toolCalls` arrays and `parts` with `tool-*` types.
- Support LangChain `tool_calls` arrays on message objects and arrays of messages.
- Support generic config with:
  - root-relative `callsPath`,
  - per-call `namePath`,
  - per-call `argumentsPath`,
  - optional per-call `idPath`,
  - wildcard and array-index selectors.
- Add unit tests for each supported shape, skipped counts, malformed calls, JSON string
  arguments, and source metadata.

Out of scope:

- CLI command.
- Output write planning.
- Validation refactor.
- Mastra, LangSmith, OpenTelemetry, streaming, or tool result normalization.

Acceptance criteria:

- Each supported format extracts calls from documented fixture shapes.
- Unsupported roots produce `normalize.no-tool-calls` or equivalent issues.
- Invalid JSON string arguments produce `normalize.arguments-invalid-json`.
- Non-object arguments produce `normalize.arguments-not-object`.
- Generic path ambiguity produces structured issues.
- Extraction order is deterministic and follows input order.

## Phase 3: Normalization Writer And Output Planning

Goal: plan normalization outputs without exposing a user-facing command yet.

Scope:

- Add `src/normalization-writer.ts`.
- Implement input file planning:
  - parse JSON,
  - call normalization helpers,
  - format normalized calls with two-space JSON and trailing newline,
  - write a single object for one call,
  - write an array for multiple calls,
  - report zero-call inputs,
  - and carry per-file issues.
- Implement destination planning:
  - `--out` equivalent for one input,
  - `--out-dir` equivalent for one output per input basename,
  - output path safety under `cwd`,
  - duplicate output collision detection,
  - changed/unchanged detection,
  - missing/stale output detection for check mode.
- Add unit tests for:
  - direct output,
  - output directory mapping,
  - unchanged output,
  - stale output,
  - missing output,
  - output collision,
  - malformed input JSON,
  - dry-run planning without destination,
  - and outside-root rejection.

Out of scope:

- CLI parsing.
- Human/JSON report rendering.
- Actual command writes through `runCliCommand`.

Acceptance criteria:

- Planning never writes files.
- Planned content is deterministic.
- Check mode findings distinguish missing and stale outputs.
- Output paths cannot escape `cwd`.
- Multiple raw inputs that map to the same basename produce an output collision finding.

## Phase 4: `normalize` CLI Parsing And Dry-Run

Goal: expose normalization diagnostics without writes first.

Scope:

- Add `normalize` to `CommandName`.
- Add help text for `normalize`, `--format`, and `--include-source`.
- Extend CLI options with:
  - `format`,
  - `includeSource`.
- Parse and validate:
  - `normalize` requires direct files or `--suite`,
  - `normalize` requires `--format`,
  - unknown formats are usage errors,
  - `--include-source` is valid only with `normalize`,
  - `--format generic` requires `config.normalization.generic`.
- Wire `normalize --dry-run` to:
  - resolve direct files and suites,
  - read input files,
  - run normalization planning,
  - and return findings/report metadata without writing.
- Add CLI tests for:
  - help output,
  - missing format,
  - unknown format,
  - missing files/suites,
  - dry-run direct file,
  - dry-run suite,
  - generic config missing,
  - and JSON dry-run report.

Out of scope:

- Actual writes.
- Check mode.
- Human rendering polish beyond basic report availability.
- Validation refactor.

Acceptance criteria:

- `tool-call-contract normalize raw.json --format openai-responses --dry-run` reports planned
  calls without writing.
- `normalize --suite raw --format langchain --dry-run --json` includes deterministic
  normalization metadata.
- Usage errors exit `2`.
- Normalization failures exit `1`; warning-only dry-runs exit `0`.

## Phase 5: Normalize Writes And Check Mode

Goal: complete the user-facing `normalize` command.

Scope:

- Support `--out`.
- Support `--out-dir`.
- Support `--check`.
- Enforce invalid option combinations:
  - writes require `--out` or `--out-dir`,
  - `--dry-run` may omit output,
  - `--check` requires output,
  - `--check` and `--dry-run` are mutually exclusive,
  - `--out` with multiple resolved files is invalid,
  - `--out` plus `--out-dir` is invalid.
- Implement actual file writes when content changed.
- Create parent directories for output files.
- Add CLI tests for:
  - `--out` write,
  - `--out-dir` write,
  - unchanged second run,
  - check success,
  - check missing output,
  - check stale output,
  - output collision,
  - and write failure where practical.

Out of scope:

- Example project updates.
- README updates.
- Site updates.

Acceptance criteria:

- `normalize raw.json --format openai-chat --out captures/regression/raw.json` writes
  normalized JSON.
- `normalize --suite raw --format openai-responses --out-dir captures/regression` writes one
  output per input basename.
- `normalize --check` exits `0` when outputs match.
- `normalize --check` exits `1` with structured findings when outputs are missing or stale.
- Writes cannot escape `cwd`.

## Phase 6: Normalization Reports

Goal: make normalization output useful for humans, CI, and automated agents.

Scope:

- Add optional `normalization` metadata to `CommandReport`.
- Implement `NormalizationReportMetadata`.
- Keep `schemaVersion: 1`.
- Add human output rendering for normalization summaries:
  - format,
  - input path,
  - output path,
  - calls found,
  - calls written,
  - skipped,
  - changed/unchanged.
- Preserve existing finding rendering.
- Add reporter tests for human and JSON output.
- Add CLI tests for report metadata across dry-run, write, check success, and check stale.

Out of scope:

- New report schema version.
- SARIF or GitHub Actions annotations.
- Provider-specific docs.

Acceptance criteria:

- JSON reports include deterministic `normalization.files` entries.
- Human output identifies inputs, outputs, call counts, and changed state.
- Existing report tests continue to pass.
- Existing v0.2 validation/redaction/generated-tests report fields remain unchanged.

## Phase 7: Validation Reuse Of Normalization Internals

Goal: remove duplicate normalization logic while preserving v0.1/v0.2 validation behavior.

Scope:

- Rework `validateToolCall` and `validateToolCalls` to use the new normalization helpers.
- Preserve support for existing accepted validation inputs:
  - normalized calls,
  - arrays of normalized calls,
  - OpenAI Chat-style tool calls,
  - OpenAI Responses-style function calls,
  - wrapper objects with `calls`, `output`, and `choices`.
- Keep CLI `validate` behavior unchanged.
- Keep existing validation issue codes where practical.
- Add regression tests proving existing validation fixture behavior remains stable.
- Add tests proving `validate` still accepts OpenAI Chat and Responses captures after the
  refactor.

Out of scope:

- Changing public validation result shape.
- Adding CLI auto-detection to `normalize`.
- Broadening validation to every new v0.3 format unless it falls out naturally from shared
  normalization.

Acceptance criteria:

- Existing validation tests pass.
- Existing CLI validation tests pass.
- Public `validateToolCalls` remains backward compatible.
- No provider extraction logic remains duplicated in `src/validation.ts` except small
  compatibility orchestration.

## Phase 8: Example Project And README Updates

Goal: document and demonstrate raw trace ingestion through the full v0.3 workflow.

Scope:

- Update `examples/basic` with:
  - raw OpenAI Responses fixture,
  - raw LangChain or Vercel AI SDK fixture,
  - configured `raw` capture suite,
  - normalized regression fixtures generated from raw traces,
  - and generic normalization config if a fixture uses it.
- Update e2e test to run:
  - `check`,
  - `generate`,
  - `normalize --suite raw --format <format> --out-dir captures/regression --check` or an
    equivalent deterministic flow,
  - `redact --check --suite regression`,
  - `validate --suite regression`,
  - and `generate-tests --suite regression`.
- Update README with:
  - raw trace to regression test quickstart,
  - supported format table,
  - provider/framework examples,
  - generic normalization example,
  - package script examples,
  - limitations and privacy notes.
- Review the product site for whether v0.3 needs a small content update.

Out of scope:

- Live provider calls.
- Installing provider SDKs.
- Mastra/LangSmith/OpenTelemetry docs.
- Large site redesign.

Acceptance criteria:

- README has copy-pasteable v0.3 normalization usage.
- Example fixtures demonstrate ingestion without network access.
- E2E tests cover the primary raw-trace-to-regression path.
- Docs clearly state that normalization is not redaction.
- The site is reviewed and updated only if it is materially stale.

## Phase 9: v0.3.0 Release Hardening

Goal: prepare the package for a clean v0.3.0 release.

Scope:

- Bump package version to `0.3.0`.
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
- New provider adapters beyond v0.3 scope.
- Release workflow redesign unless verification fails.

Acceptance criteria:

- `npm run verify:release` passes.
- `npm pack --dry-run --ignore-scripts` includes only expected files.
- The built CLI reports version `0.3.0`.
- Release notes accurately describe normalization formats, `normalize`, reports, and
  compatibility.
- The repo is ready for tagging after review.

## Deferred Post-v0.3.0 Work

These ideas are useful, but intentionally outside v0.3.0:

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
- SARIF and GitHub Actions annotation reporters for normalization.
- Watch mode.

## Phase Completion Rule

At the end of each implementation phase:

- Update tests for the behavior added in that phase.
- Run targeted tests plus any relevant verification commands.
- Run formatting when docs or generated code changed.
- Update README, examples, or site only when user-facing behavior changed.
- Check `git status --short`.
- Commit only the scoped phase diff when the user asks to commit.

Each completed phase should leave the repository ready for the next phase without relying on
uncommitted generated output, unpublished packages, or manual setup outside the repo.
