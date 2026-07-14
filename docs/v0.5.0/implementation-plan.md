# tool-call-contract v0.5.0 Implementation Plan

## Purpose

This plan breaks the v0.5.0 PRD and technical design into phases sized for one normal
code-review-commit cycle. Each phase should leave the repository working, tested, and easy to
review.

v0.5.0 is a generated artifact freshness and CI ergonomics release. It should make the existing
artifact lifecycle easier to inspect and gate:

- add a read-only `artifacts` command,
- add a focused `artifacts --check` CI gate,
- preserve existing `generate`, `generate --clean`, and `check` behavior,
- keep v0.4 manifests compatible,
- and move reusable artifact planning mechanics behind an internal generic boundary.

This release should not become a standalone artifact freshness package, generator plugin system,
manifest standard, source dependency graph tracker, or discontinued-product integration.

## Phase Sizing

A phase should usually fit in one focused implementation pass when:

- it changes one primary subsystem,
- it has direct tests,
- it preserves existing v0.1-v0.4 behavior,
- it avoids mixing CLI behavior, docs, and release version changes unless it is a release phase,
- and it leaves targeted tests plus relevant verification commands in a meaningful state.

If a phase starts touching generic planning, command parsing, human report rendering, README
positioning, and release metadata at once, split it before continuing.

## Phase 0: Generic Artifact Planner Boundary

Goal: extract the reusable artifact planning mechanics without changing public behavior.

Scope:

- Add internal `src/artifact-planner.ts`.
- Move or duplicate-then-route generic mechanics from `src/artifact-writer.ts`:
  - path normalization,
  - `outDir` containment checks,
  - create/update/unchanged planning,
  - cleanable manifest-owned delete planning,
  - write/delete execution helpers,
  - and plan summaries.
- Keep `src/artifact-planner.ts` free of imports from:
  - `reporting`,
  - `contracts`,
  - `registry`,
  - `schema`,
  - `fixtures`,
  - and CLI modules.
- Keep `src/artifact-writer.ts` as the `tool-call-contract` facade.
- Preserve existing public exports:
  - `planArtifactWrites`,
  - `writeArtifactPlan`,
  - `loadArtifactManifest`,
  - and `collectArtifactFreshnessFindings`.
- Add focused unit tests for the generic planner:
  - missing file -> `create`,
  - changed file -> `update`,
  - matching file -> `unchanged`,
  - artifact path outside `outDir` -> issue,
  - cleanable previous-manifest file under `outDir` -> cleanable entry,
  - unsafe previous-manifest path -> issue,
  - duplicate manifest paths are deduped for cleanable files.
- Keep existing artifact writer tests passing.

Out of scope:

- Adding the `artifacts` command.
- Changing manifest shape.
- Changing report metadata.
- Changing `generate` or `check` behavior.
- Exporting the generic planner from the package root.

Acceptance criteria:

- Existing `generate`, `generate --clean`, and `check` tests still pass.
- Existing root exports still typecheck.
- Generic planner tests prove the new internal module without importing domain modules.
- `src/index.ts` does not export `artifact-planner`.
- No user-visible output changes.

Implementation notes:

- Added internal `src/artifact-planner.ts` with generic artifact planning, path safety, write
  execution, cleanable-file planning, and plan summaries.
- Refactored `src/artifact-writer.ts` into the `tool-call-contract` facade that preserves existing
  public exports, manifest parsing, findings, and report summaries.
- Added `test/artifact-planner.test.ts` for create/update/unchanged state, unsafe artifact paths,
  cleanable manifest-owned files, unsafe manifest paths, and duplicate cleanable path deduping.
- Confirmed `src/index.ts` does not export `artifact-planner`.
- Verified the refactor does not change existing artifact generation, check, or clean behavior.

## Phase 1: Artifact Inspection Domain Helper

Goal: add a shared `tool-call-contract` artifact inspection helper on top of the generic planner.

Scope:

- Add an internal helper, likely in `src/artifact-inspection.ts` or `src/artifact-writer.ts`.
- Implement artifact inspection flow:
  - generate expected artifacts in memory,
  - load existing manifest if present,
  - plan current artifact state,
  - optionally plan cleanable manifest-owned files,
  - convert plan issues to `Finding` objects,
  - convert stale/missing entries to `artifact.stale` findings when requested,
  - return artifact summary metadata.
- Keep `check` behavior unchanged:
  - no manifest means no artifact freshness failure,
  - stale artifacts with a manifest produce `artifact.stale`.
- Keep `generate` behavior unchanged:
  - writes still happen only through `generate`,
  - clean deletion still happens only through `generate --clean`.
- Add tests for the helper directly or through existing command helpers:
  - no manifest inspection can report expected creates without making `check` fail,
  - manifest present and clean returns fresh state,
  - manifest present and stale returns stale findings when severity is `error`,
  - cleanable entries are reported when requested.

Out of scope:

- Parser support for `artifacts`.
- Human report changes.
- JSON report schema changes.
- README updates.

Acceptance criteria:

- Existing `check` tests are unchanged or only minimally adapted.
- New helper can support both `check` and future `artifacts`.
- v0.4 manifests remain readable.
- No new public package exports.

Implementation notes:

- Added internal `src/artifact-inspection.ts` to generate expected artifacts, load manifests, plan
  file state, optionally report cleanable manifest-owned files, and convert stale entries into
  `artifact.stale` findings with caller-selected severity.
- Routed `check` artifact freshness through `inspectGeneratedArtifacts` with
  `skipIfManifestMissing: true`, preserving broad check behavior when no generated manifest exists.
- Added `test/artifact-inspection.test.ts` for no-manifest inspection, check-compatible missing
  manifest skips, fresh manifests, stale manifests, and cleanable manifest-owned files.
- Kept the helper internal and did not add new public package exports.

## Phase 2: Report Metadata And Human Rendering

Goal: add report structures and rendering support for artifact inspection before the command is
wired.

Scope:

- Add `ArtifactInspectionReportMetadata` to `src/reporting.ts`.
- Add optional `artifactInspection?: ArtifactInspectionReportMetadata` to `CommandReport`.
- Keep report `schemaVersion: 1`.
- Ensure `createCommandReport` includes `artifactInspection` when present.
- Extend `renderHumanReport` to render:
  - artifact summary,
  - fresh/not-fresh status,
  - manifest found/valid status when helpful,
  - cleanable manifest-owned files,
  - and next-step guidance.
- Decide final non-check behavior:
  - Prefer metadata-only stale state for non-check mode,
  - avoid `info` findings unless the implementation is cleaner with findings.
- Add reporting tests for:
  - fresh artifact inspection output,
  - stale artifact inspection output,
  - cleanable files output,
  - JSON report shape with `artifactInspection`.

Out of scope:

- Parser support for `artifacts`.
- Changing existing `generate` human output.
- Release notes.

Acceptance criteria:

- Report schema remains additive.
- Existing report rendering tests pass.
- Human artifact inspection output is concise and CI-readable.
- JSON output is deterministic.

Implementation notes:

- Added `ArtifactInspectionReportMetadata` and optional `artifactInspection` metadata to
  `CommandReport`.
- Exported the artifact inspection report metadata type from the package root with the other
  report metadata types.
- Extended `createCommandReport`, `renderJsonReport`, and `renderHumanReport` support for
  artifact inspection metadata.
- Added human rendering for fresh/not-fresh state, missing/invalid manifest status, cleanable
  manifest-owned files, and next-step guidance.
- Updated `inspectGeneratedArtifacts` to return ready-to-attach `artifactInspection` report
  metadata for future command wiring.
- Added reporting tests for fresh, stale, cleanable, and stable JSON artifact inspection output.

## Phase 3: `artifacts` Parser And CLI Command

Goal: expose `tool-call-contract artifacts` as a read-only artifact inspection command.

Scope:

- Add `artifacts` to `CommandName`.
- Add global help and command-specific help entry.
- Route `tool-call-contract help artifacts` and `tool-call-contract artifacts --help`.
- Wire `artifacts` in `runCliCommand`.
- Support:
  - `artifacts`,
  - `artifacts --check`,
  - `artifacts --json`,
  - `artifacts --cwd <path>`,
  - `artifacts --config <path>`,
  - and `artifacts --out-dir <path>`.
- Reject:
  - positional files,
  - `artifacts --clean`,
  - and `artifacts --dry-run`.
- Implement exit behavior:
  - plain `artifacts` exits `0` when config loads, even if files would change,
  - `artifacts --check` exits non-zero when artifacts are missing, stale, unsafe, or manifest is
    missing,
  - config load failures keep existing config failure exit behavior.
- Ensure `artifacts` never writes or deletes files.
- Add CLI tests for:
  - clean state after `generate`,
  - missing file non-check inspect,
  - missing file check failure,
  - stale file check failure,
  - cleanable stale manifest-owned files after a contract is removed,
  - no manifest behavior,
  - parser rejections,
  - help output,
  - and JSON output.

Out of scope:

- README updates.
- Release version bump.
- Changing `generate --dry-run`.

Acceptance criteria:

- `tool-call-contract artifacts` is read-only.
- `tool-call-contract artifacts --check` is a focused artifact freshness gate.
- `check` still treats generated artifacts as optional when no manifest exists.
- `artifacts --check` fails when no manifest exists.
- Command help examples parse successfully.

Implementation notes:

- Added `artifacts` as a first-class command name with global help, command-specific help, and
  parser support for `artifacts`, `artifacts --check`, `artifacts --json`, `--cwd`, `--config`,
  and `--out-dir`.
- Rejected positional file arguments, `artifacts --clean`, and `artifacts --dry-run` with explicit
  usage messages.
- Wired the command through `inspectGeneratedArtifacts` as a read-only path:
  - plain `artifacts` reports missing, stale, and cleanable files without failing when config loads,
  - `artifacts --check` converts freshness changes into blocking `artifact.stale` errors,
  - cleanable manifest-owned files are surfaced in `artifactInspection.cleanable` without reporting
    them as deleted by the read-only command.
- Added CLI coverage for fresh artifacts, missing artifacts in inspect mode, missing/stale
  `--check` failures, missing manifest failure, cleanable files, custom output directories, help,
  parser rejections, and deterministic JSON output.

Verification:

- `npm test -- test/cli.test.ts test/reporting.test.ts test/artifact-inspection.test.ts`
- `npm run typecheck`
- `npm run format`
- `npm run lint`
- `npm test`

## Phase 4: Example Project And E2E Coverage

Goal: prove the new command works in the executable example workflow.

Scope:

- Extend `test/e2e.test.ts` or equivalent example coverage:
  - copy `examples/basic` into a temp project,
  - run `generate`,
  - run `artifacts --check`,
  - mutate or remove a generated file,
  - verify `artifacts --check` fails,
  - restore or regenerate if needed before continuing other example assertions.
- Review `examples/basic` for whether package scripts should include artifact inspection.
- Add example package scripts only if materially useful; otherwise keep examples unchanged and rely
  on README docs.

Out of scope:

- New example project.
- Large example restructuring.
- Site redesign.

Acceptance criteria:

- Existing example e2e still passes.
- The example proves the clean and stale `artifacts --check` path.
- `examples/basic` does not gain unnecessary generated output churn.

Implementation notes:

- Extended the existing `examples/basic` e2e workflow to run `artifacts --check` after `generate`
  and assert the generated artifacts are fresh.
- Mutated a generated docs artifact in the temp example project, verified `artifacts --check`
  fails with `artifact.stale`, then regenerated before continuing the existing check, validation,
  redaction, and generated-test assertions.
- Reviewed `examples/basic`; it does not include package scripts today, so no example script churn
  was added in this phase.

Verification:

- `npm test -- test/e2e.test.ts`

## Phase 5: README, Help, And Product Positioning

Goal: make the generated artifact lifecycle clear to users and coding agents.

Scope:

- Update README near "Generate Artifacts" with an "Inspect Artifact Freshness" subsection.
- Explain:
  - `generate` writes artifacts,
  - `artifacts` inspects artifacts,
  - `artifacts --check` is a focused artifact CI gate,
  - `check` runs broader contract/schema/freshness checks,
  - `generate --clean` removes stale manifest-owned files,
  - and no manifest behavior for `check` versus `artifacts --check`.
- Update quickstart or CI guidance only if the new command materially improves the recommended
  sequence.
- Update command help text if implementation changed from the technical design.
- Review docs and site for stale wording about artifact freshness.
- Confirm no discontinued target product is referenced.

Out of scope:

- Publishing a new website design.
- Standalone package messaging.
- New cookbooks.

Acceptance criteria:

- README clearly distinguishes write, inspect, broad check, and clean workflows.
- Help output and README examples match parser behavior.
- Docs do not imply a standalone artifact freshness package exists.
- No discontinued target product references are present.

Implementation notes:

- Added a README "Inspect Artifact Freshness" section that distinguishes:
  - `generate` as the write path,
  - `artifacts` as read-only inspection,
  - `artifacts --check` as the focused CI freshness gate,
  - `check` as the broader contract/schema/freshness gate,
  - and `generate --clean` as the only artifact cleanup path.
- Updated README quickstart, package script examples, recommended CI, and example commands to use
  `artifacts --check` when generated artifacts are committed.
- Added `tool-contracts:artifacts` to the initializer's default package scripts so `init`,
  README, and recommended CI use the same command surface.
- Refined command help notes for `check` and `artifacts` so help output explains no-manifest
  behavior and read-only inspect mode.
- Updated the product site and `AGENTS.md` to mention the focused artifact freshness gate.
- Reviewed docs/site for discontinued target product references and stale standalone-package
  messaging; no discontinued target product references were present.

Verification:

- `npm test -- test/init.test.ts test/cli.test.ts`
- `npm run format`

## Phase 6: Cross-Command Hardening

Goal: catch regressions across artifact-related command combinations before release hardening.

Scope:

- Add or update tests for:
  - `generate --dry-run` still reports planned writes and writes nothing,
  - `generate --clean` still deletes only manifest-owned files under `outDir`,
  - unsafe manifest paths are still reported and not deleted,
  - `check` still reports stale artifacts when a manifest exists,
  - `check` still passes with no manifest when contracts are otherwise valid,
  - `artifacts --json` is deterministic,
  - `artifacts --out-dir` matches `generate --out-dir`,
  - help examples parse.
- Run focused CLI and artifact tests.
- Fix small option/help/report mismatches discovered during the sweep.

Out of scope:

- New public APIs.
- New artifact kinds.
- Manifest migration.

Acceptance criteria:

- Artifact lifecycle tests cover write, inspect, check, and clean.
- Existing v0.1-v0.4 workflows still pass.
- Command help does not drift from parser behavior.

Implementation notes:

- Added explicit CLI coverage that `check` passes with no generated manifest when contracts are
  otherwise valid, preserving broad-check optional artifact behavior.
- Strengthened `generate --dry-run` coverage to assert planned fixture, schema, doc, and manifest
  paths are not written.
- Added custom `--out-dir` clean coverage proving `generate --clean` deletes stale
  manifest-owned files under the configured output directory without touching an unrelated
  similarly named file in the default output directory.
- Added read-only unsafe manifest coverage proving `artifacts --check` reports
  `artifact.path-outside-out-dir` and does not delete the outside file.
- Existing Phase 3 tests continue to cover deterministic `artifacts --json`, `artifacts --out-dir`
  matching `generate --out-dir`, stale/missing artifact checks, and help example parsing.

Verification:

- `npm test -- test/cli.test.ts test/artifact-inspection.test.ts test/artifact-writer.test.ts`
- `npm run format`

## Phase 7: v0.5.0 Release Hardening

Goal: prepare the package for a clean v0.5.0 release.

Scope:

- Bump package version to `0.5.0`.
- Update exported CLI/package version.
- Update artifact manifest default generator version.
- Update packed-package smoke expectations.
- Update release notes:
  - `CHANGELOG.md`,
  - `docs/v0.5.0/release.md`.
- Review public exports for accidental unstable internals:
  - `artifact-planner` must not be exported from the package root.
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
- Confirm Pages/site content remains acceptable for v0.5.0.

Out of scope:

- npm publishing itself.
- GitHub release creation.
- Trusted publishing configuration changes unless verification fails because of workflow drift.

Acceptance criteria:

- `npm run verify:release` passes.
- `npm pack --dry-run --ignore-scripts` includes only expected files.
- The built CLI reports version `0.5.0`.
- Release notes accurately describe `artifacts`, `artifacts --check`, existing command
  compatibility, and internal artifact planning boundary improvements.
- The repo is ready for tagging after review.

## Deferred Post-v0.5.0 Work

These ideas are useful, but intentionally outside v0.5.0:

- Standalone artifact freshness package.
- Generic generator plugin API.
- Generator-neutral manifest migration.
- Source dependency graph tracking.
- SARIF output.
- GitHub Actions annotations.
- Watch mode.
- Automatic deletion from `artifacts`.
- Public export of the generic artifact planner.
- Additional artifact kinds beyond current fixtures, schemas, docs, and manifest.

## Phase Completion Rule

At the end of each implementation phase:

- Update tests for the behavior added in that phase.
- Run targeted tests plus any relevant verification commands.
- Run formatting when docs, generated code, or generated fixtures changed.
- Summarize changed files, commands run, and any known follow-up.
- Do not mark a phase complete with failing tests, unreviewed generated output, unpublished
  packages, manual package publication, or external infrastructure changes still required.
