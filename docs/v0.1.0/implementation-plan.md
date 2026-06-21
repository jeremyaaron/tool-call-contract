# tool-call-contract Implementation Plan

## Purpose

This plan breaks the PRD and technical design into implementation phases sized for one normal code-review-commit cycle. Each phase should leave the repository in a working state with tests passing and a coherent diff.

The phases are intentionally smaller than product milestones. The PRD describes the v0.1 product, the technical design describes the architecture, and this plan describes the practical build order.

## Phase Sizing

A phase should usually fit in one focused implementation pass when:

- It changes a small number of architectural surfaces.
- It has clear acceptance criteria.
- It can be reviewed without understanding unrelated future phases.
- It leaves the package buildable, testable, or more complete in an obvious way.
- It avoids combining validation, generation, config loading, reporting, and file mutation in one diff.

If a phase starts producing broad incidental refactors, split it before continuing.

## Phase 0: Repository Scaffold

Goal: turn the blank repository into a working TypeScript package and CLI skeleton.

Scope:

- Create `package.json` for the unscoped `tool-call-contract` package.
- Configure TypeScript for ESM output.
- Add `src/index.ts` and `src/cli/index.ts`.
- Add a minimal CLI that renders help.
- Add build, typecheck, test, lint, and format scripts.
- Add Vitest configuration.
- Add README usage stub.
- Add basic CI workflow for install, typecheck, test, and build.

Out of scope:

- Real contract APIs.
- Config loading.
- CLI commands beyond help output.
- Generated artifacts.

Acceptance criteria:

- `npm test`, `npm run typecheck`, and `npm run build` pass.
- The package exposes the `tool-call-contract` binary after build.
- `tool-call-contract --help` renders without throwing.
- CI workflow uses the same verification commands as local development.

## Phase 1: Public Contract API

Goal: establish the library API that user projects will import.

Scope:

- Implement `defineToolContract`.
- Implement `defineConfig`.
- Add exported TypeScript types for:
  - `ToolContract`
  - `DefineToolContractInput`
  - `ToolCallContractConfig`
- Add structural runtime checks for malformed contract definitions.
- Preserve generic inference from Zod input schemas.
- Add unit tests for valid contracts, invalid names, missing descriptions, invalid inputs, and example storage.

Out of scope:

- Global duplicate-name detection.
- Runtime call validation.
- Config file loading.
- JSON Schema conversion.

Acceptance criteria:

- A Zod schema passed to `defineToolContract` is preserved with usable inferred types.
- Invalid local contract definitions fail with clear programmer-facing errors.
- The root package export exposes the public API.
- Unit tests cover the API without invoking the CLI.

## Phase 2: Call Normalization and Validation

Goal: make the core library useful for validating captured tool calls.

Scope:

- Implement `NormalizedToolCall`, `ToolCallIssue`, and `ToolCallValidationResult`.
- Implement normalization for:
  - `{ name, arguments }`
  - `{ toolName, args }`
  - arrays of calls
  - `{ calls: [...] }`
- Implement OpenAI Chat Completions-style normalization from `tool_calls[].function`.
- Implement OpenAI Responses-style normalization for function call output items.
- Implement `validateToolCall`.
- Implement `validateToolCalls`.
- Map Zod issues to stable issue codes and paths.
- Add unit tests for valid calls, unknown tools, malformed JSON arguments, missing arguments, invalid argument types, defaults, and arrays of calls.

Out of scope:

- CLI `validate`.
- Config loading.
- Provider adapters beyond the MVP OpenAI normalization rules.
- Generated fixtures.

Acceptance criteria:

- Library validation succeeds for valid normalized and OpenAI-style calls.
- Library validation returns structured failures without throwing for expected bad input.
- Parsed values include Zod defaults.
- Tests cover both single-contract and multi-contract validation.

## Phase 3: CLI Shell, Exit Codes, and Reporters

Goal: establish command structure and output contracts before project loading and generation.

Scope:

- Implement CLI commands:
  - `check`
  - `generate`
  - `validate <files...>`
- Add shared option parsing for `--cwd`, `--config`, `--json`, and command-specific flags.
- Add `Finding` and `Severity` types.
- Add exit-code handling for success, expected failures, usage errors, and internal errors.
- Add human reporter for findings and validation results.
- Add JSON reporter with `schemaVersion`, `command`, `success`, and summary fields.
- Add tests for reporter output and exit-code decisions.

Out of scope:

- Loading config files.
- Real command behavior.
- Filesystem writes.

Acceptance criteria:

- Each command can run in placeholder mode without crashing.
- `--json` output is valid JSON.
- Reporter tests cover errors, warnings, info findings, and validation failures.
- Usage errors exit with code `2`.

## Phase 4: Config Loading and Contract Registry

Goal: load user-defined contracts from project config and normalize them into a registry.

Scope:

- Implement default config lookup:
  - `tool-call-contract.config.ts`
  - `tool-call-contract.config.mts`
  - `tool-call-contract.config.js`
  - `tool-call-contract.config.mjs`
- Add explicit `--config` support.
- Use a runtime loader for TypeScript and ESM config files.
- Validate config shape.
- Resolve and validate `outDir`.
- Build `ContractRegistry`.
- Detect duplicate contract names.
- Merge per-contract and config-level examples.
- Add fixture tests for TypeScript config, JavaScript config, missing config, invalid config, duplicate names, and output directory escaping.

Out of scope:

- JSON Schema conversion.
- Artifact generation.
- Full `check` findings beyond config and registry problems.

Acceptance criteria:

- CLI commands can load a TypeScript config in a fixture project.
- Missing or invalid config produces exit code `2`.
- Duplicate contract names become structured findings.
- Registry construction preserves configured contract order.

## Phase 5: `check` Command Baseline

Goal: make `tool-call-contract check` useful for validating project contract definitions.

Scope:

- Wire config loading and registry construction into `check`.
- Validate provider-safe tool names.
- Validate non-empty descriptions.
- Validate examples against their contracts.
- Add ignore policy through `--ignore`.
- Add `--strict` warning upgrade behavior.
- Report findings in human and JSON mode.
- Add fixture integration tests for clean config, duplicate names, invalid names, missing descriptions, invalid examples, ignores, and strict mode.

Out of scope:

- JSON Schema conversion.
- Generated artifact freshness.
- Fixture generation.
- OpenAI schema export.

Acceptance criteria:

- `tool-call-contract check` exits `0` for a valid simple config.
- Contract-definition problems produce stable finding IDs.
- `--json` includes deterministic findings.
- `--ignore` suppresses selected finding IDs.
- `--strict` turns warnings into blocking failures.

## Phase 6: JSON Schema Analysis and OpenAI Export

Goal: add generation-oriented schema analysis and the first provider artifact.

Scope:

- Implement Zod 4 JSON Schema conversion using public Zod APIs.
- Add `SchemaAnalysis` with capability reporting.
- Detect JSON Schema conversion failures.
- Implement OpenAI-compatible tool schema export.
- Validate root schema is an object for OpenAI export.
- Add unit tests for supported schemas:
  - object
  - string
  - number
  - boolean
  - array
  - enum
  - literal
  - optional fields
  - nullable fields
  - defaults
- Add tests for unsupported schema conversion behavior.

Out of scope:

- Writing schema files.
- Fixture synthesis.
- Documentation generation.
- Strict OpenAI schema mode.

Acceptance criteria:

- Supported Zod schemas convert to stable JSON Schema.
- OpenAI export includes `type`, `name`, `description`, `parameters`, and `strict: false`.
- Unsupported conversion produces structured findings without disabling runtime validation.
- No code depends on private Zod internals.

## Phase 7: Deterministic Fixture Generation

Goal: generate valid and invalid call fixtures from JSON Schema and examples.

Scope:

- Implement valid fixture synthesis from supported JSON Schema constructs.
- Prefer the first validating explicit example when available.
- Implement invalid fixture synthesis.
- Wrap fixtures in normalized call shape.
- Add capability reporting for unsupported fixture-generation constructs.
- Add unit tests for every supported primitive and object shape.
- Add tests for example fallback, invalid examples, and unsupported constructs.

Out of scope:

- Writing fixture files.
- Markdown docs.
- CLI `generate`.

Acceptance criteria:

- Fixture generation is deterministic across repeated runs.
- Generated valid fixtures pass `validateToolCall`.
- Generated invalid fixtures fail `validateToolCall`.
- Unsupported fixture synthesis returns `schema.fixture-unsupported` unless a valid example is available.

## Phase 8: Documentation and Manifest Generation

Goal: generate all artifact content in memory.

Scope:

- Implement Markdown documentation generation.
- Include tool name, description, field table, defaults, enum values, valid fixture, invalid fixture, and OpenAI schema path.
- Implement generated artifact model.
- Implement deterministic JSON formatting.
- Implement deterministic Markdown formatting.
- Implement SHA-256 content hashing.
- Implement deterministic manifest content with `generatedAt: null`.
- Add unit tests for doc content, JSON formatting, hashes, manifest structure, and stable ordering.

Out of scope:

- Writing artifacts to disk.
- Stale artifact detection.
- `--clean`.

Acceptance criteria:

- A contract set can be turned into a complete in-memory artifact list.
- Re-generating unchanged contracts produces identical artifact content and hashes.
- Generated docs do not contain absolute local paths or timestamps.

## Phase 9: Artifact Write Planner and `generate`

Goal: make `tool-call-contract generate` write deterministic artifacts safely.

Scope:

- Implement output directory resolution.
- Implement write-plan calculation for creates, updates, and unchanged files.
- Implement file writes restricted to `outDir`.
- Wire artifact generation into `tool-call-contract generate`.
- Add `--dry-run`.
- Add `--out-dir`.
- Report planned and written artifacts in human and JSON mode.
- Add fixture integration tests for first generate, no-op second generate, dry run, output directory override, and write failures.

Out of scope:

- `--clean`.
- Artifact freshness checks in `check`.
- Advanced provider adapters.

Acceptance criteria:

- `generate` creates fixtures, schemas, docs, and manifest.
- Running `generate` twice produces no second diff.
- `generate --dry-run` reports changes without writing.
- Writes cannot escape the configured output directory.

## Phase 10: Artifact Freshness and Clean

Goal: close the loop between generated artifacts and `check`.

Scope:

- Load existing manifest when present.
- Compare generated hashes against files on disk.
- Add `artifact.stale` findings to `check`.
- Add `generate --clean` support for manifest-owned stale files.
- Ensure clean deletes only manifest-owned files under `outDir`.
- Add fixture tests for stale files, missing files, changed contract output, clean deletion, and refusal to delete unsafe paths.

Out of scope:

- Git integration.
- Watching files.
- Source scanning.

Acceptance criteria:

- `check` reports stale generated artifacts when the manifest exists.
- `generate` updates stale artifacts.
- `generate --clean` removes stale manifest-owned files only.
- Unsafe manifest paths are ignored or reported without deletion.

## Phase 11: `validate` Command Integration

Goal: make the CLI validate captured call files end to end.

Scope:

- Wire config loading and registry construction into `validate`.
- Read one or more JSON files.
- Support single call, call arrays, `{ calls: [...] }`, OpenAI Chat Completions-style captures, and OpenAI Responses-style captures.
- Add malformed JSON handling.
- Add `--allow-unknown`.
- Report per-file and per-call results.
- Add fixture integration tests for valid captures, invalid captures, malformed files, multiple files, unknown tools, and OpenAI-style captures.

Out of scope:

- Non-JSON trace formats.
- Provider adapters beyond MVP OpenAI normalization.
- Live model calls.

Acceptance criteria:

- `validate` exits `0` when every call is valid.
- `validate` exits `1` when any call is invalid.
- Malformed JSON and unsupported shapes produce clear structured failures.
- JSON output is deterministic and includes per-call results.

## Phase 12: End-to-End Example and README

Goal: make the package understandable and usable from a fresh project.

Scope:

- Add an example project or fixture demonstrating three realistic contracts.
- Add sample captured-call files.
- Document install, config, check, generate, and validate workflows in README.
- Document generated artifact policy.
- Document config loading as trusted code execution.
- Document Zod 4 requirement and known limitations.
- Add an end-to-end test that exercises check, generate, and validate in sequence.

Out of scope:

- Publishing automation.
- Website or hosted docs.
- Provider adapter docs beyond OpenAI MVP output.

Acceptance criteria:

- README has copy-pasteable MVP usage.
- Example contracts can generate artifacts and validate captures.
- End-to-end test passes without network access.
- Known limitations match the technical design.

## Phase 13: v0.1 Hardening

Goal: prepare the MVP for a first tagged release.

Scope:

- Review public exports for accidental internals.
- Add package metadata:
  - `description`
  - `license`
  - `repository`
  - `files`
  - `engines`
  - `peerDependencies`
- Verify packed package contents.
- Add changelog or release notes stub.
- Run the full verification suite.
- Smoke-test the built binary through `npx` or local package installation.
- Resolve documentation drift between PRD, technical design, implementation plan, and README.

Out of scope:

- Expanding schema support.
- Adding new providers.
- Adding Vitest or Jest custom matchers.

Acceptance criteria:

- `npm test`, `npm run typecheck`, `npm run build`, and lint/format checks pass.
- `npm pack --dry-run` includes only expected files.
- Built package can be installed into a temporary project and used from both library imports and CLI.
- Docs accurately describe the shipped v0.1 behavior.

## Deferred Post-MVP Phases

These are intentionally excluded from v0.1 unless the MVP lands earlier than expected:

- Valibot input support.
- JSON Schema input support.
- Vitest and Jest custom matchers.
- Vercel AI SDK, Mastra, LangChain, Anthropic, Gemini, and MCP adapters.
- Strict OpenAI schema compatibility mode.
- Source scanning for contract discovery.
- SARIF and GitHub Actions annotation reporters.
- Seeded fuzz fixture generation.
- Contract diffing for pull requests.
- Schema coverage reports for captured calls.
- Redaction helpers for sensitive captured-call fields.

## Phase Completion Rule

At the end of each implementation phase:

- Update tests for the behavior added in that phase.
- Run the relevant local verification commands.
- Update README or docs only when user-facing behavior changed.
- Check `git status --short`.
- Commit only the scoped phase diff when the user asks to commit.

Each completed phase should leave the repository ready for the next phase without relying on uncommitted generated output or manual setup outside the repo.
