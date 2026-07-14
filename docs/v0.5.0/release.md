# tool-call-contract v0.5.0 Release Notes

`v0.5.0` is a generated artifact freshness and CI ergonomics release.

The release keeps the existing contract, capture, normalization, redaction, and generated-test
workflow intact, while making generated artifact ownership easier to inspect and enforce.

## Highlights

- New `artifacts` CLI command for read-only generated artifact inspection.
- New `artifacts --check` focused CI gate for generated artifact freshness.
- Clearer command boundaries:
  - `generate` writes fixtures, schemas, docs, and the manifest;
  - `artifacts` inspects generated output without writing or deleting;
  - `artifacts --check` fails when generated artifacts or the manifest are missing, stale, or
    unsafe;
  - `check` remains the broader contract, schema, and artifact freshness check;
  - `generate --clean` remains the only cleanup path for stale manifest-owned files.
- `init` now adds a `tool-contracts:artifacts` package script.
- README, `AGENTS.md`, help text, and the product site now describe the focused artifact freshness
  workflow.
- Artifact planning is internally separated from artifact writing so inspect, check, generate, and
  clean behavior share the same path-safety rules.

## Artifact Workflow

Generate reviewable artifacts:

```sh
tool-call-contract generate
```

Inspect generated output without changing files:

```sh
tool-call-contract artifacts
```

Gate committed generated output in CI:

```sh
tool-call-contract artifacts --check
```

Remove stale manifest-owned files when a contract is removed:

```sh
tool-call-contract generate --clean
```

For custom output directories, use the same `--out-dir` with both commands:

```sh
tool-call-contract generate --out-dir generated/tool-contracts
tool-call-contract artifacts --out-dir generated/tool-contracts --check
```

## Compatibility

- Report `schemaVersion` remains `1`.
- Existing v0.1-v0.4 public exports remain supported.
- Existing v0.4 artifact manifests remain readable.
- `check` still treats generated artifacts as optional when no manifest exists.
- `generate`, `generate --dry-run`, and `generate --clean` preserve their existing write behavior.
- The internal artifact planner boundary is not exported from the package root.

## Verification

The release verification path is:

```sh
npm run verify:release
```

This runs linting, formatting, typecheck, tests, build, `pkg-guard` experimental diagnostics,
stable `pkg-guard check`, `npm pack --dry-run`, and the packed-package smoke test.
