# tool-call-contract v0.5.0 Technical Design

## Overview

`tool-call-contract` v0.5.0 makes generated artifact freshness visible as its own workflow.

The package already has the core mechanics:

- deterministic artifact generation in `src/artifacts.ts`;
- manifest loading and write planning in `src/artifact-writer.ts`;
- freshness findings during `check`;
- dry-run and clean behavior during `generate`.

The design adds a read-only `artifacts` command and refactors the artifact planning internals so
the reusable mechanics are less coupled to tool contracts. The release should still present this as
a `tool-call-contract` feature, not as a generic standalone package.

## Design Decisions

| Question                  | Decision                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Command shape             | Add `tool-call-contract artifacts`. It inspects generated artifact state without writing files.                                          |
| Check behavior            | Add `artifacts --check`. It fails when generated artifacts are missing, stale, or unsafe.                                                |
| Default exit behavior     | `artifacts` without `--check` exits `0` when config loads, even if files would be created or updated. It is inspection, not enforcement. |
| Clean behavior            | Do not add deletion to `artifacts`. Report cleanable manifest-owned files; keep actual deletion in `generate --clean`.                   |
| Finding IDs               | Keep public stale/missing freshness findings under `artifact.stale` for compatibility. Use severity to distinguish inspect vs check.     |
| Manifest format           | Keep the v0.4 manifest shape. Do not migrate to a generator-neutral manifest in v0.5.                                                    |
| Internal extraction       | Add an internal generic planning module. Keep existing public exports from `src/artifact-writer.ts` compatible.                          |
| Public API surface        | Do not export the new generic planner from the package root in v0.5.                                                                     |
| Documentation positioning | Document artifact freshness as part of `tool-call-contract`; do not reference discontinued target products or promise a package split.   |

## Runtime And Dependencies

Runtime targets remain unchanged:

- Node.js 20 or newer.
- TypeScript 5.5 or newer.
- Zod 4 as a peer dependency.

No new runtime dependencies are required.

## CLI Design

### Command Set

Extend command recognition with `artifacts`.

```ts
export type CommandName =
  | "check"
  | "generate"
  | "validate"
  | "redact"
  | "generate-tests"
  | "normalize"
  | "init"
  | "artifacts";
```

Global help should include:

```text
artifacts             Inspect generated artifact freshness
```

Command-specific help:

```text
tool-call-contract artifacts

Inspect generated artifact freshness.

Usage:
  tool-call-contract artifacts [options]

Options:
  --check              Fail when generated artifacts are missing, stale, or unsafe.
  --json               Print a machine-readable command report.
  --cwd <path>         Run from a different working directory.
  --config <path>      Load a specific config file.
  --out-dir <path>     Inspect generated artifacts under a custom output directory.

Examples:
  tool-call-contract artifacts
  tool-call-contract artifacts --check
  tool-call-contract artifacts --out-dir generated/tool-contracts --json

Notes:
  This command does not write or delete files.
  Run tool-call-contract generate to update artifacts.
  Run tool-call-contract generate --clean to remove stale manifest-owned files.
```

### Parser Behavior

`--check` is already parsed globally for `redact` and `normalize`. v0.5 should allow it for
`artifacts` as well.

`artifacts` should reject file arguments:

```text
artifacts does not accept file arguments.
```

`artifacts --clean` should be a usage error if `--clean` remains parsed globally:

```text
--clean can only be used with generate.
```

`artifacts --dry-run` should also be a usage error:

```text
--dry-run is not needed with artifacts because artifacts never writes files.
```

If implementation cost is lower, the parser may initially reject `--dry-run` for all commands that
do not support it with a more general message. The user-facing behavior should be deterministic and
tested.

## Artifact Inspection Flow

Add a shared helper in CLI or artifact-domain code:

```ts
async function inspectGeneratedArtifacts(input: {
  cwd: string;
  outDir: string;
  registry: ContractRegistry;
  includeCleanable: boolean;
  staleSeverity: "info" | "error";
}): Promise<ArtifactInspectionResult>;
```

Suggested result:

```ts
interface ArtifactInspectionResult {
  plan: ToolContractArtifactPlan;
  findings: Finding[];
  report: ArtifactInspectionReportMetadata;
}
```

Flow:

1. Generate expected artifacts in memory with `generateArtifacts`.
2. Load the existing manifest if present.
3. Plan artifact writes against disk.
4. Plan cleanable files from the manifest without deleting them.
5. Convert stale/missing writes into `artifact.stale` findings.
6. Return additive report metadata for human and JSON output.

`check` should continue to use the same helper with `staleSeverity: "error"` and
`includeCleanable: false`.

`artifacts` should use:

- `staleSeverity: "info"` when `--check` is absent;
- `staleSeverity: "error"` when `--check` is present;
- `includeCleanable: true`.

This keeps inspection non-blocking while making check mode a focused CI gate.

## Internal Generic Artifact Planner

Current `src/artifact-writer.ts` does three things:

1. generic path-safe artifact planning;
2. manifest parsing and clean planning;
3. `tool-call-contract`-specific findings and report summaries.

v0.5 should separate these concerns without breaking public exports.

### New Internal Module

Add:

```text
src/artifact-planner.ts
```

This module is internal in v0.5. Do not export it from `src/index.ts`.

Suggested generic types:

```ts
export interface PlannedArtifact {
  path: string;
  content: string;
  hash?: string;
  kind?: string;
}

export type PlannedArtifactWriteAction = "create" | "update" | "unchanged";

export interface PlannedArtifactWriteEntry {
  artifact: PlannedArtifact;
  action: PlannedArtifactWriteAction;
  absolutePath: string;
}

export interface PlannedArtifactDeleteEntry {
  path: string;
  absolutePath: string;
}

export interface ArtifactPlanIssue {
  code:
    | "artifact.path-outside-out-dir"
    | "artifact.read-failed"
    | "artifact.write-failed"
    | "artifact.manifest-invalid";
  path: string;
  message: string;
  cause?: unknown;
}

export interface ArtifactPlan {
  entries: PlannedArtifactWriteEntry[];
  cleanable: PlannedArtifactDeleteEntry[];
  issues: ArtifactPlanIssue[];
}
```

Suggested functions:

```ts
export async function planArtifactChanges(input: {
  artifacts: readonly PlannedArtifact[];
  cwd: string;
  outDir: string;
  previousManifest?: GenericArtifactManifest;
  includeCleanable?: boolean;
}): Promise<ArtifactPlan>;

export async function writeArtifactChanges(plan: ArtifactPlan): Promise<ArtifactPlanIssue[]>;

export function summarizeArtifactPlan(plan: ArtifactPlan): {
  created: string[];
  updated: string[];
  unchanged: string[];
  cleanable: string[];
};
```

The generic module should not import:

- `Finding`;
- `CommandReport`;
- `ContractRegistry`;
- `ToolContract`;
- schema or fixture modules.

It may import Node filesystem/path APIs.

### Compatibility Facade

Keep `src/artifact-writer.ts` as the `tool-call-contract` facade over the generic planner.

Existing exports should continue to work:

```ts
planArtifactWrites;
writeArtifactPlan;
loadArtifactManifest;
collectArtifactFreshnessFindings;
```

This matters because `src/index.ts` currently exports these APIs. v0.5 should not create an
accidental public API break while doing internal extraction.

The facade should:

- adapt `GeneratedArtifact` to `PlannedArtifact`;
- adapt generic planner issues into existing `Finding` objects;
- preserve existing artifact summary fields;
- preserve existing clean behavior for `generate --clean`;
- preserve current manifest parsing rules.

## Manifest Design

Keep the current manifest shape:

```ts
export interface ArtifactManifest {
  schemaVersion: 1;
  generator: {
    name: "tool-call-contract";
    version: string;
  };
  generatedAt: null;
  contracts: Array<{
    name: string;
    inputHash: string;
    artifacts: string[];
  }>;
  files: Array<{
    path: string;
    kind: GeneratedArtifactKind;
    hash: string;
  }>;
}
```

Rationale:

- Existing v0.4 manifests remain readable.
- The current manifest already contains enough data for freshness and clean planning.
- A generator-neutral manifest would be premature before there is another real consumer.

The internal generic planner may use a narrower generic manifest view:

```ts
export interface GenericArtifactManifest {
  files: Array<{
    path: string;
    kind?: string;
    hash?: string;
  }>;
}
```

`tool-call-contract` manifest parsing should stay in the facade. After parsing, the facade can pass
only the generic file list to the planner.

## Report Model

The existing `CommandReport.artifacts` shape is useful for write summaries:

```ts
artifacts?: {
  created: string[];
  updated: string[];
  unchanged: string[];
  deleted: string[];
};
```

For `artifacts`, add optional inspection metadata:

```ts
export interface ArtifactInspectionReportMetadata {
  checked: boolean;
  fresh: boolean;
  manifest: {
    path: string;
    found: boolean;
    valid: boolean;
  };
  cleanable: string[];
}
```

Extend `CommandReport`:

```ts
artifactInspection?: ArtifactInspectionReportMetadata;
```

`artifacts` should also populate `artifacts` with:

- `created`: files missing from disk;
- `updated`: files whose content would change;
- `unchanged`: files matching current expected content;
- `deleted`: always `[]`, because the command never deletes.

Cleanable files should live in `artifactInspection.cleanable`.

### JSON Examples

Clean output:

```json
{
  "schemaVersion": 1,
  "command": "artifacts",
  "success": true,
  "summary": {
    "errors": 0,
    "warnings": 0,
    "info": 0,
    "validResults": 0,
    "invalidResults": 0
  },
  "artifacts": {
    "created": [],
    "updated": [],
    "unchanged": [".tool-call-contract/manifest.json"],
    "deleted": []
  },
  "artifactInspection": {
    "checked": false,
    "fresh": true,
    "manifest": {
      "path": ".tool-call-contract/manifest.json",
      "found": true,
      "valid": true
    },
    "cleanable": []
  }
}
```

Stale check output should include `artifact.stale` findings with `severity: "error"`.

Stale non-check output may include `artifact.stale` findings with `severity: "info"` or may rely
only on `artifacts.updated` and `artifactInspection.fresh: false`. Prefer the metadata-only
approach for non-check mode if it keeps human output cleaner. The implementation plan should choose
the smallest path that preserves deterministic JSON output.

## Human Reporting

Extend `renderHumanReport` to handle `artifactInspection`.

Clean state:

```text
tool-call-contract artifacts
Artifacts: 0 created, 0 updated, 5 unchanged, 0 deleted.
Generated artifacts are fresh.
```

Stale inspect state:

```text
tool-call-contract artifacts
Artifacts: 0 created, 2 updated, 3 unchanged, 0 deleted.
Generated artifacts are not fresh. Run tool-call-contract generate.
```

Stale check state:

```text
tool-call-contract artifacts --check
Findings: 1 error(s), 0 warning(s), 0 info.

error artifact.stale
  Generated artifact is stale
  Location: .tool-call-contract/docs/search_docs.md
  Generated artifact ".tool-call-contract/docs/search_docs.md" does not match the current contracts.

  Fix:
    Run tool-call-contract generate to update generated artifacts.

Artifacts: 0 created, 1 updated, 4 unchanged, 0 deleted.
Generated artifacts are not fresh. Run tool-call-contract generate.
```

If cleanable files exist:

```text
Cleanable manifest-owned files:
  .tool-call-contract/docs/old_tool.md

Run tool-call-contract generate --clean to remove stale manifest-owned files.
```

## Command Integration

### `generate`

Keep current behavior:

- creates missing artifacts;
- updates stale artifacts;
- skips unchanged artifacts;
- deletes manifest-owned stale files only when `--clean` is passed;
- writes nothing when `--dry-run` is passed.

Internally, route through the generic planner facade.

### `check`

Keep current behavior:

- contract checks;
- schema analysis;
- artifact freshness checks when a manifest exists.

Refactor freshness checks to share the new artifact inspection helper.

Important compatibility rule: if no manifest exists, `check` should not fail because artifacts have
not been generated. This preserves the existing "generated artifacts are optional" behavior.

### `artifacts`

New behavior:

- loads config;
- generates expected artifacts in memory;
- plans file state;
- loads manifest and cleanable files when present;
- never writes or deletes files;
- exits `0` unless config loading fails or `--check` finds stale/missing/unsafe artifacts.

If no manifest exists:

- report expected artifacts as `created`;
- report `artifactInspection.manifest.found: false`;
- `artifacts --check` should fail because committed/generated artifact freshness cannot be true
  when no generated manifest exists.

This differs from `check`, intentionally. `check` treats artifacts as optional; `artifacts --check`
is an explicit artifact freshness gate.

## Testing Strategy

### Unit Tests

Add focused tests for the generic planner:

- missing file -> `create`;
- changed file -> `update`;
- matching file -> `unchanged`;
- artifact path outside `outDir` -> issue;
- cleanable previous-manifest file under `outDir` -> cleanable entry;
- unsafe previous-manifest path -> issue;
- duplicate manifest paths are deduped for cleanable files.

Keep existing `artifact-writer` tests for facade compatibility.

### CLI Tests

Add tests for:

- `artifacts` clean state after `generate`;
- `artifacts` reports missing files without writing;
- `artifacts --check` exits non-zero for missing files;
- `artifacts --check` exits non-zero for stale files;
- `artifacts` reports cleanable stale manifest-owned files after a contract is removed;
- `artifacts` rejects file arguments;
- `artifacts --clean` rejects with a usage error;
- `artifacts --json` includes deterministic `artifacts` and `artifactInspection` metadata;
- `check` behavior is unchanged when no manifest exists;
- `check` behavior is unchanged when a manifest exists and artifacts are stale.

### E2E Tests

Extend the existing basic example project flow:

1. Run `generate`.
2. Run `artifacts --check`.
3. Modify or remove a generated file in the copied fixture project.
4. Verify `artifacts --check` fails.

Keep the mutation inside the temporary copied fixture project.

## Documentation

Update README:

- Add an "Inspect Artifact Freshness" subsection near "Generate Artifacts".
- Explain:
  - `generate` writes artifacts;
  - `artifacts` inspects artifacts;
  - `artifacts --check` is a focused artifact CI gate;
  - `check` still runs broad contract/schema/freshness checks;
  - `generate --clean` removes stale manifest-owned files.

Update command help with `artifacts`.

Do not add docs that imply a separate package exists.

## Release Notes Guidance

Describe v0.5.0 as:

- a generated artifact freshness and CI ergonomics release;
- adding a focused `artifacts` command;
- preserving existing generation and check behavior;
- improving internal artifact planning boundaries for future maintainability.

Avoid describing v0.5.0 as:

- a standalone artifact freshness framework;
- a generic generator plugin system;
- a manifest standard for the ecosystem.

## Compatibility

- Existing public root exports should remain available.
- Existing manifests should remain valid.
- Existing report `schemaVersion` remains `1`.
- Existing commands should keep their current behavior.
- New report metadata is additive.

## Deferred Work

- Standalone artifact freshness package.
- Generic generator plugin API.
- Generator-neutral manifest migration.
- Source dependency graph tracking.
- SARIF output for artifact freshness.
- GitHub Actions annotations.
- Watch mode.
- Automatic deletion from `artifacts`.
