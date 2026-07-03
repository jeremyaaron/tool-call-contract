# tool-call-contract v0.4.0 Implementation Plan

## Purpose

This plan breaks the v0.4.0 PRD and technical design into phases sized for one normal
code-review-commit cycle. Each phase should leave the repository working, tested, and easy
to review.

v0.4.0 is an adoption and operability release. It should make the existing v0.3 regression
workflow easier to discover, scaffold, and run correctly:

- command-specific CLI help,
- an `init` command,
- clearer trace/capture/fixture terminology,
- agent-facing procedural docs,
- framework capture cookbooks,
- and `pkg-guard` experimental diagnostics dogfooding in release verification.

This release should not become a production telemetry system, framework adapter package,
runtime recorder, hosted service, or `pkg-guard` integration surface.

## Phase Sizing

A phase should usually fit in one focused implementation pass when:

- it changes one primary subsystem,
- it has direct tests,
- it preserves existing v0.1, v0.2, and v0.3 behavior,
- it avoids mixing docs-only positioning with unrelated code mutation,
- and it leaves `npm test`, `npm run typecheck`, and targeted CLI tests in a meaningful
  state.

If a phase starts touching help routing, init writes, report rendering, docs, and release
verification at once, split it before continuing.

## Phase 0: Help Registry And Command Help Routing

Goal: make command-specific help available without changing command execution behavior.

Scope:

- Add `src/cli/help.ts` or an equivalent focused module.
- Introduce a structured registry for global help and command help.
- Add command-specific help entries for:
  - `check`,
  - `generate`,
  - `validate`,
  - `redact`,
  - `normalize`,
  - `generate-tests`,
  - and planned `init`.
- Route help before config loading:
  - `tool-call-contract --help`,
  - `tool-call-contract -h`,
  - `tool-call-contract help`,
  - `tool-call-contract help normalize`,
  - `tool-call-contract normalize --help`,
  - and `tool-call-contract normalize -h`.
- Return usage errors for unknown help topics.
- Keep `help` out of `CommandName`.
- Add CLI tests for global help, command help, unknown topics, and no-config behavior.

Out of scope:

- Adding the `init` command implementation.
- Parser support for `--force`.
- Documentation updates beyond help text itself.

Acceptance criteria:

- Global help lists all commands including `init`.
- Command help includes usage, options, examples, output behavior, and safety notes.
- `help normalize` and `normalize --help` render the same content.
- Command help does not require `tool-call-contract.config.ts`.
- Usage errors exit `2`.

## Phase 1: Init Planning Model And Report Metadata

Goal: add the side-effect-free init data model before any files are written.

Scope:

- Add `src/cli/init.ts`.
- Add `InitProjectOptions`, `InitProjectResult`, and internal plan types.
- Add `InitReportMetadata` to `src/reporting.ts`.
- Add optional `init?: InitReportMetadata` to `CommandReport`.
- Keep report `schemaVersion: 1`.
- Implement planning for:
  - starter config,
  - raw OpenAI Responses trace,
  - normalized regression capture,
  - package script additions,
  - existing-file skips,
  - existing-script skips,
  - and malformed or missing `package.json`.
- Ensure planned writes resolve under `cwd`.
- Add unit tests for planning only.

Out of scope:

- CLI parser wiring for `init`.
- Actual filesystem writes.
- Human report rendering.
- JSON CLI output tests.

Acceptance criteria:

- Planning is deterministic and performs no writes.
- Existing files are marked `skipped` without `force`.
- Existing files are marked `updated` with `force`.
- Missing `package.json` is represented as skipped package script metadata, not failure.
- Malformed `package.json` creates `init.package-json-invalid` and still plans non-package
  files.
- Paths outside `cwd` create `init.path-outside-root`.

## Phase 2: Init CLI, Writes, Dry Run, And Force

Goal: expose `tool-call-contract init` as a complete bootstrap command.

Scope:

- Add `init` to `CommandName`.
- Add parser support for:
  - `init`,
  - `--dry-run`,
  - `--force`,
  - `--json`,
  - `--cwd`,
  - and no positional file arguments.
- Reject `--force` outside `init`.
- Wire `init --dry-run` to planning without writes.
- Implement the init writer:
  - create parent directories,
  - write created/updated files,
  - update `package.json` scripts when valid,
  - skip conflicting files/scripts unless `--force`,
  - and report `init.write-failed` findings on write failures.
- Add CLI tests for:
  - default init,
  - `--dry-run`,
  - `--force`,
  - `--json`,
  - file-argument rejection,
  - `--force` rejection on other commands,
  - malformed `package.json`,
  - and repeated runs.

Out of scope:

- Human report polish beyond basic report availability.
- README and cookbook updates.
- Release verification changes.

Acceptance criteria:

- `tool-call-contract init` creates the starter config and sample capture files.
- `init --dry-run` reports planned changes and writes nothing.
- `init --force` overwrites owned starter files and scripts.
- `init --json` returns deterministic init metadata.
- Running init twice without force exits successfully and reports skipped files/scripts.
- Existing command behavior remains unchanged.

## Phase 3: Init Human Reporting And Generated Workflow Validation

Goal: make init output useful and prove the generated starter setup actually works.

Scope:

- Add human rendering for `init` metadata.
- Include created, updated, and skipped counts for files and package scripts.
- Include next-step guidance only where it is concise and directly actionable.
- Add tests for human report output.
- Add an integration-style test that runs the generated starter setup through:
  - `check`,
  - `normalize --check`,
  - `redact --check`,
  - `validate`,
  - and `generate-tests --dry-run`.
- Adjust starter fixture formatting only if needed to match existing deterministic output.

Out of scope:

- Changing normalization semantics.
- Writing generated Vitest tests from `init`.
- README updates.

Acceptance criteria:

- Human init output identifies created, updated, and skipped resources.
- JSON report output remains stable after human rendering changes.
- The generated starter project passes the documented local/CI command sequence.
- Starter files do not require live provider calls or framework packages.

## Phase 4: Agent Guide And Cookbook Documentation

Goal: document the intended adoption workflow for humans and coding agents.

Scope:

- Add root `AGENTS.md`.
- Add cookbooks:
  - `docs/cookbooks/openai-responses.md`,
  - `docs/cookbooks/vercel-ai-sdk.md`,
  - and `docs/cookbooks/langchain.md`.
- Make `AGENTS.md` procedural and short enough to scan.
- Include exact command sequences for:
  - adding contracts,
  - normalizing one raw trace,
  - redacting fixtures,
  - validating fixtures,
  - generating tests,
  - and adding CI checks.
- In each cookbook, explain:
  - where the raw trace shape usually comes from,
  - what minimal synthetic JSON looks like,
  - how to normalize it,
  - how to validate it,
  - redaction cautions,
  - production telemetry boundaries,
  - and unsupported shapes.
- Keep examples synthetic, network-free, and safe to commit.

Out of scope:

- New provider/framework extraction support.
- Runtime capture helpers.
- Package install or CI workflow changes.

Acceptance criteria:

- A coding agent can follow `AGENTS.md` without reading the PRD/TDD.
- Cookbooks clearly separate runtime traces from committed regression fixtures.
- Docs do not claim automatic instrumentation.
- Docs do not introduce unsupported framework claims.

## Phase 5: README And Site Positioning Refresh

Goal: make the public-facing docs match the v0.4 product boundary.

Scope:

- Add near-top README sections for:
  - "What This Is",
  - and "What This Is Not".
- Mention `init` in the quickstart.
- Link to `AGENTS.md`.
- Link to the provider/framework cookbooks.
- Clarify:
  - raw traces are operational data,
  - normalized captures are curated regression fixtures,
  - generated fixtures are synthetic contract examples,
  - and large production telemetry does not belong in git.
- Document one recommended CI command order.
- Review `/site` and make only small copy updates if current copy is stale for v0.4.0.

Out of scope:

- Site redesign.
- New visual assets.
- New docs framework or generated docs site.

Acceptance criteria:

- README has copy-pasteable v0.4 adoption steps.
- README links to command help, agent guide, and cookbooks.
- The recommended CI order matches shipped command behavior.
- Site copy does not contradict the README or shipped feature set.

## Phase 6: pkg-guard Experimental Diagnostics Dogfooding

Goal: exercise `pkg-guard@0.5.0`'s experimental analytics/diagnostics API in this real
consumer without exposing it as a `tool-call-contract` feature.

Scope:

- Upgrade `pkg-guard` to `^0.5.0`.
- Add `scripts/check-package-diagnostics.mjs`.
- Import `analyzePackageForDiagnostics` from `pkg-guard/experimental/analysis`.
- Run diagnostics with `mode: "fast"`.
- Fail on `severity: "error"`.
- Print compact warning/info diagnostics with:
  - id,
  - severity,
  - layer,
  - cost,
  - file,
  - path,
  - and range when available.
- Assert package metadata includes `name: "tool-call-contract"` when available.
- Add `pkg-guard:diagnostics` npm script.
- Update `verify:release` to run diagnostics before `pack:check`.
- Keep `pack:check` using stable `pkg-guard check`.
- Document any friction worth feeding back to `pkg-guard`.

Out of scope:

- Exposing package diagnostics through the `tool-call-contract` CLI.
- Adding runtime dependency on `pkg-guard`.
- Building a VS Code integration.
- Replacing `pkg-guard check` with the experimental API.

Acceptance criteria:

- `npm run pkg-guard:diagnostics` passes or fails deterministically.
- `npm run verify:release` exercises both the experimental diagnostics script and stable
  `pkg-guard check`.
- Any diagnostics output is compact enough for CI logs.
- `tool-call-contract` product docs do not position the project as a `pkg-guard` testbed.

Implementation notes:

- Upgraded `pkg-guard` from `^0.3.0` to `^0.5.0`.
- Added `scripts/check-package-diagnostics.mjs` as a repo-local wrapper around
  `analyzePackageForDiagnostics({ mode: "fast" })`.
- The wrapper asserts the analyzed package name when package metadata is returned, prints compact
  diagnostics, and fails only on `error` severity diagnostics.
- Added `pkg-guard:diagnostics` and wired it into `verify:release` before `pack:check`.
- Kept `pack:check` on the stable `pkg-guard check` CLI plus `npm pack --dry-run`.
- No adoption friction worth escalating to `pkg-guard` was found in this phase; the documented
  experimental export, type declarations, package metadata, and diagnostic shape were sufficient.

## Phase 7: Examples, Smoke Checks, And Cross-Command Hardening

Goal: catch adoption regressions across the full command sequence after v0.4 docs and init
are in place.

Scope:

- Review existing examples for stale terminology.
- Update example package scripts only if v0.4 makes them materially clearer.
- Add or update smoke tests for the documented workflow:
  - `init`,
  - `check`,
  - `normalize --check`,
  - `redact --check`,
  - `validate`,
  - and `generate-tests --dry-run`.
- Verify command-specific help examples against parser behavior.
- Review JSON reports for command consistency.
- Fix small option/help mismatches discovered during the sweep.

Out of scope:

- New providers.
- New public APIs.
- Large example-project restructuring.

Acceptance criteria:

- Documented command examples run as written.
- Smoke tests cover the v0.4 bootstrap-to-regression path.
- Help output and README examples do not drift from parser behavior.
- Existing v0.1-v0.3 examples still pass.

Implementation notes:

- Reviewed the basic example project and README example commands; no stale terminology or package
  script changes were needed.
- Added parser-backed coverage for every command-specific help example so future help text cannot
  advertise invalid option combinations.
- Added JSON-mode smoke coverage for the generated starter workflow:
  `init`, `check`, `normalize --check`, `redact --check`, `validate`, and
  `generate-tests --dry-run`.
- Kept the existing executable `examples/basic` e2e coverage as the guard for the README example
  project and pre-v0.4 workflows.

## Phase 8: v0.4.0 Release Hardening

Goal: prepare the package for a clean v0.4.0 release.

Scope:

- Bump package version to `0.4.0`.
- Update exported CLI/package version.
- Update release notes.
- Review public exports for accidental unstable internals.
- Review generated package contents.
- Run the full verification suite:
  - lint,
  - format,
  - typecheck,
  - tests,
  - build,
  - package diagnostics,
  - package checks,
  - and packed-package smoke test.
- Confirm docs match shipped behavior.
- Confirm Pages/site content is acceptable for v0.4.0.

Out of scope:

- npm publishing itself.
- GitHub release creation.
- Trusted publishing configuration changes unless verification fails because of workflow
  drift.

Acceptance criteria:

- `npm run verify:release` passes.
- `npm pack --dry-run --ignore-scripts` includes only expected files.
- The built CLI reports version `0.4.0`.
- Release notes accurately describe `init`, command help, docs/cookbooks, terminology, and
  `pkg-guard` diagnostics dogfooding.
- The repo is ready for tagging after review.

Implementation notes:

- Bumped package metadata, exported library version, CLI `--version`, artifact manifest default
  version, tests, and packed-package smoke expectations to `0.4.0`.
- Added `docs/v0.4.0/release.md` and updated `CHANGELOG.md` plus README release-note links.
- Reviewed the package export map and built public entry; no unstable CLI help or `pkg-guard`
  internals are exported from the package root.
- Reviewed `/site`; current copy already reflects the v0.4 starter, normalization, redaction,
  validation, and generated-test workflow.
- Reviewed dry-run package contents. The package includes only `CHANGELOG.md`, `LICENSE`,
  `README.md`, built `dist` entries, and `package.json`.
- Verified `node dist/cli/index.js --version` prints `0.4.0`.
- Verified `npm run verify:release` passes.

## Deferred Post-v0.4.0 Work

These ideas are useful, but intentionally outside v0.4.0:

- Runtime recorder helpers.
- Provider/framework adapter packages.
- OpenTelemetry, Langfuse, LangSmith, or Datadog imports.
- Production trace storage.
- Capture promotion workflows.
- Capture diffing and coverage reports.
- Tool result contracts.
- Streaming reconstruction.
- Policy metadata.
- SARIF and GitHub Actions annotation reporters.
- VS Code extension or language server.
- Stable `pkg-guard` analysis integration beyond repo verification.
- Public `tool-call-contract` integration with `pkg-guard`.

## Phase Completion Rule

At the end of each implementation phase:

- Update tests for the behavior added in that phase.
- Run targeted tests plus any relevant verification commands.
- Run formatting when docs, generated code, or generated fixtures changed.
- Update README, examples, or site only when user-facing behavior changed.
- Check `git status --short`.
- Commit only the scoped phase diff when the user asks to commit.

Each completed phase should leave the repository ready for the next phase without relying on
uncommitted generated output, unpublished packages, manual package publication, or external
services.
