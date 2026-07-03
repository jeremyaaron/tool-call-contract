# tool-call-contract v0.4.0 Release Notes

`v0.4.0` is an adoption and operability release for the local tool-call regression workflow.

The release keeps the v0.3 contract model intact, but makes the workflow easier to start, explain,
and verify in real TypeScript agent projects.

## Highlights

- New `init` CLI command for starter project setup.
- `init --dry-run` and `init --force` for safer bootstrap changes.
- Command-specific help for `init`, `check`, `generate`, `normalize`, `redact`, `validate`, and
  `generate-tests`.
- README updates that distinguish raw traces, normalized captures, and reviewed regression
  fixtures.
- New agent integration guide in `AGENTS.md`.
- Provider and framework cookbooks for:
  - OpenAI Responses;
  - Vercel AI SDK;
  - LangChain.
- Expanded smoke coverage for the bootstrap-to-regression command path.
- Release verification now exercises `pkg-guard`'s experimental diagnostics API before the stable
  package check.

## Starter Workflow

Bootstrap a small local regression setup:

```sh
tool-call-contract init
```

Preview the writes first:

```sh
tool-call-contract init --dry-run
```

Then run the generated package scripts:

```sh
npm run tool-contracts:check
npm run tool-contracts:normalize:check
npm run tool-contracts:redact
npm run tool-contracts:validate
npm run tool-contracts:tests -- --dry-run
```

## Help And Docs

Every command now has focused help:

```sh
tool-call-contract help normalize
tool-call-contract generate-tests --help
```

The docs intentionally keep `tool-call-contract` scoped to contract validation, fixture curation,
normalization, redaction, generated artifacts, and regression tests. It is not a telemetry backend,
runtime recorder, hosted trace store, model runner, or PII detector.

## Compatibility

- Report `schemaVersion` remains `1`.
- Existing v0.1-v0.3 commands and public exports remain supported.
- Existing config fields, CLI option names, and report fields are not renamed.
- `pkg-guard` remains a development-only release verification dependency.

## Verification

The release verification path is:

```sh
npm run verify:release
```

This runs linting, formatting, typecheck, tests, build, `pkg-guard` experimental diagnostics,
stable `pkg-guard check`, `npm pack --dry-run`, and the packed-package smoke test.
