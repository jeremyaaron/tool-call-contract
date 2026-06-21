# tool-call-contract Technical Design

## Overview

`tool-call-contract` is a TypeScript library and CLI for defining AI tool-call contracts once, then reusing those contracts for validation, generated fixtures, generated documentation, and provider schema export.

The MVP is Zod-first. Runtime validation delegates to the original Zod schema, while generation-oriented features use Zod 4's public JSON Schema conversion as the intermediate representation. This avoids building the MVP on private Zod internals and gives the project a clear bridge to future JSON Schema and Valibot support.

The design keeps the contract model independent from the CLI so the package can later support provider adapters, test-runner matchers, editor integrations, and CI annotations without duplicating validation logic.

## Design Goals

- Keep contracts application-owned and provider-neutral.
- Use public schema APIs wherever possible.
- Make validation deterministic and side-effect-free.
- Keep generated artifacts stable enough to commit.
- Separate contract definition, config loading, validation, generation, reporting, and file writes.
- Treat captured model output as untrusted input.
- Avoid live model calls and network access in all MVP commands.
- Keep v0.1 useful without requiring a plugin architecture.

## Runtime and Packaging

The package is published as `tool-call-contract` and exposes one CLI binary:

```json
{
  "name": "tool-call-contract",
  "type": "module",
  "bin": {
    "tool-call-contract": "./dist/cli/index.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

Initial runtime target:

- Node.js 20 or newer.
- TypeScript 5.5 or newer.
- Zod 4 as a peer dependency.

Zod 4 is required for the MVP because it provides first-party JSON Schema conversion through `z.toJSONSchema()`. Supporting Zod 3 can be revisited later through an adapter package or a compatibility layer.

## Public API

### `defineToolContract`

Contracts are plain immutable objects with enough metadata for validation and generation.

```ts
import type * as z from "zod";

type ZodType = z.ZodType;

export interface DefineToolContractInput<TSchema extends ZodType> {
  name: string;
  description: string;
  input: TSchema;
  examples?: unknown[];
}

export interface ToolContract<TSchema extends ZodType = ZodType> {
  readonly kind: "tool-call-contract";
  readonly name: string;
  readonly description: string;
  readonly input: TSchema;
  readonly examples: readonly unknown[];
}

export function defineToolContract<TSchema extends ZodType>(
  input: DefineToolContractInput<TSchema>,
): ToolContract<TSchema>;
```

`defineToolContract` should perform cheap structural validation:

- `name` is non-empty.
- `description` is non-empty.
- `input` looks like a Zod schema.
- `examples`, when provided, are stored but not validated until `check` or generation.

It should not validate global uniqueness because uniqueness depends on the configured contract set.

### `defineConfig`

```ts
export interface ToolCallContractConfig {
  contracts: ToolContract[];
  outDir?: string;
  examples?: Record<string, unknown[]>;
  include?: string[];
  exclude?: string[];
}

export function defineConfig(config: ToolCallContractConfig): ToolCallContractConfig;
```

`examples` in config are merged with per-contract examples. Per-contract examples come first because they live closest to the contract definition.

### Validation Helpers

```ts
export interface NormalizedToolCall {
  name: string;
  arguments: unknown;
  id?: string;
  source?: ToolCallSource;
}

export type ToolCallSource = "normalized" | "openai-chat" | "openai-responses" | "unknown";

export interface ToolCallIssue {
  code: string;
  message: string;
  path?: Array<string | number>;
}

export type ToolCallValidationResult<T = unknown> =
  | {
      ok: true;
      contractName: string;
      value: T;
      call: NormalizedToolCall;
    }
  | {
      ok: false;
      contractName?: string;
      call?: NormalizedToolCall;
      issues: ToolCallIssue[];
    };

export function validateToolCall<TSchema extends ZodType>(
  contract: ToolContract<TSchema>,
  call: unknown,
): ToolCallValidationResult<z.infer<TSchema>>;

export function validateToolCalls(
  contracts: ToolContract[],
  input: unknown,
): ToolCallValidationResult[];
```

The public helper layer stays assertion-library neutral. Vitest and Jest matchers are deferred until the generic result shape proves stable.

## Commands

### `tool-call-contract check`

Read-only project audit command.

Flow:

1. Parse CLI options.
2. Find and load config.
3. Build a `ContractRegistry`.
4. Analyze each contract for definition problems and unsupported generation/export features.
5. If generated artifacts exist, generate artifacts in memory and compare expected hashes to disk.
6. Apply ignore and strictness policy.
7. Print human or JSON output.
8. Exit with the correct status code.

Options:

```text
--config <path>      Load a specific config file.
--cwd <path>         Run from a different working directory.
--json               Print JSON instead of human output.
--strict             Treat warnings as errors.
--ignore <id...>     Ignore finding IDs for this run.
```

`check` does not write files. Artifact freshness is checked only when the output manifest or generated artifact directory exists.

### `tool-call-contract generate`

Artifact generation command.

Flow:

1. Parse CLI options.
2. Load config and build registry.
3. Run contract analysis.
4. Generate fixtures, OpenAI schemas, docs, and manifest in memory.
5. Compare planned artifacts to disk.
6. Print planned changes.
7. Write files unless `--dry-run` is set.
8. If `--clean` is set, remove stale files owned by the previous manifest.

Options:

```text
--config <path>      Load a specific config file.
--cwd <path>         Run from a different working directory.
--out-dir <path>     Override configured output directory.
--dry-run            Show changes without writing.
--clean              Remove stale generated files owned by the manifest.
--json               Print machine-readable output.
```

Writes are restricted to the resolved output directory. `--clean` may delete only paths listed in the previous manifest and only if they still live under the output directory.

### `tool-call-contract validate <files...>`

Captured-call validation command.

Flow:

1. Parse CLI options and file arguments.
2. Load config and build registry.
3. Read each JSON file.
4. Normalize supported call shapes.
5. Match each call to a contract by name.
6. Validate arguments through the original Zod schema.
7. Print grouped validation results.
8. Exit non-zero when any file or call is invalid.

Options:

```text
--config <path>      Load a specific config file.
--cwd <path>         Run from a different working directory.
--json               Print machine-readable output.
--allow-unknown      Downgrade unknown tool names from errors to warnings.
```

The command accepts:

- A single normalized call.
- An array of normalized calls.
- A capture object with a `calls` array.
- OpenAI Chat Completions-style objects with `tool_calls[].function`.
- OpenAI Responses-style function call output items when they expose a function name and JSON arguments.

## Core Data Model

### `ContractRegistry`

The registry is the normalized in-memory view of configured contracts.

```ts
export interface ContractRegistry {
  contracts: ToolContract[];
  byName: Map<string, ToolContract>;
  duplicates: Map<string, ToolContract[]>;
  examplesByName: Map<string, unknown[]>;
}
```

Registry construction should preserve input order. Reports and generated files should sort by contract name only at output boundaries to keep output deterministic.

### `Finding`

Findings describe project or contract problems outside a single captured-call validation result.

```ts
export type Severity = "error" | "warning" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  message: string;
  impact?: string;
  suggestion?: string;
  contractName?: string;
  file?: string;
  path?: string;
}
```

Finding IDs use dotted namespaces:

```text
config.not-found
config.load-failed
contract.duplicate-name
contract.invalid-name
contract.description-missing
schema.json-schema-unsupported
schema.fixture-unsupported
schema.example-invalid
artifact.stale
artifact.write-failed
```

### `GeneratedArtifact`

```ts
export interface GeneratedArtifact {
  path: string;
  kind: "fixture" | "schema" | "doc" | "manifest";
  content: string;
  hash: string;
}

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
    kind: GeneratedArtifact["kind"];
    hash: string;
  }>;
}
```

`generatedAt` is intentionally `null` in the MVP to keep the manifest deterministic. A timestamp can be added later behind an explicit option if needed.

### `SchemaAnalysis`

```ts
export interface SchemaAnalysis {
  contractName: string;
  jsonSchema?: JsonObject;
  capabilities: {
    validate: true;
    fixture: "supported" | "example-only" | "unsupported";
    openai: "supported" | "unsupported";
    docs: "supported" | "partial" | "unsupported";
  };
  findings: Finding[];
}
```

Validation is always considered supported when the contract contains a usable Zod schema because validation delegates to `safeParse`. Generation capabilities depend on JSON Schema conversion and fixture-generator support.

## Config Loading

Default lookup order:

1. `tool-call-contract.config.ts`
2. `tool-call-contract.config.mts`
3. `tool-call-contract.config.js`
4. `tool-call-contract.config.mjs`

The CLI should use a focused runtime loader such as `jiti` to load TypeScript and ESM config files. Config loading executes user code, so error messages and docs must state that config files are trusted project code.

Invalid config should produce exit code `2`:

- Config file missing when required by a command.
- Default export missing.
- `contracts` is not an array.
- A contract is structurally invalid.
- `outDir` escapes the project when resolved.

Config merge order:

1. Built-in defaults.
2. Config file.
3. CLI options.

Built-in default:

```ts
{
  outDir: ".tool-call-contract";
}
```

## Contract Validation

`validateToolCall` first normalizes the input into a `NormalizedToolCall`, then checks the name, then delegates argument validation to Zod.

Validation rules:

- Unknown tool name returns `call.unknown-tool`.
- Missing `arguments` returns `call.arguments-missing`.
- JSON-encoded `arguments` are parsed before schema validation.
- Malformed JSON arguments return `call.invalid-json`.
- Zod issues are converted into stable `ToolCallIssue` objects.
- Parsed values returned by Zod are exposed as `value` on success, including defaults.

Zod error mapping should preserve:

- issue code where useful
- path
- expected type or enum value when available
- the original Zod message as a fallback

The helper should not throw for expected validation failures. It may throw only for programmer errors such as passing a non-contract object to a contract-specific helper.

## Call Normalization

Normalization converts supported provider or capture shapes into `{ name, arguments, id, source }`.

Supported MVP shapes:

```ts
{ name: string; arguments: unknown }
{ toolName: string; args: unknown }
{ calls: unknown[] }
unknown[]
```

OpenAI Chat Completions-style shape:

```ts
{
  tool_calls: [
    {
      id?: string;
      function: {
        name: string;
        arguments: string;
      };
    }
  ];
}
```

OpenAI Responses-style shape:

```ts
{
  type: "function_call";
  call_id?: string;
  name: string;
  arguments: string;
}
```

Normalization should recurse through common wrapper objects only when doing so is deterministic, such as:

- `{ calls: [...] }`
- `{ output: [...] }`
- `{ choices: [{ message: { tool_calls: [...] } }] }`

Unsupported shapes should return a validation issue, not an empty success result.

## JSON Schema Conversion

The schema pipeline is:

1. Start with the contract's Zod input schema.
2. Convert with `z.toJSONSchema(schema, { io: "input", cycles: "throw", reused: "inline", unrepresentable: "throw" })`.
3. Catch conversion errors and emit `schema.json-schema-unsupported`.
4. Use the converted JSON Schema for docs, fixtures, and provider export.

The MVP should not inspect private Zod internals for generation. If JSON Schema conversion cannot represent a schema, validation still works but generation/export capabilities become partial or unsupported.

## OpenAI Export

The MVP generates one JSON file per contract:

```json
{
  "type": "function",
  "name": "create_issue",
  "description": "Create a GitHub issue.",
  "parameters": {
    "type": "object",
    "properties": {}
  },
  "strict": false
}
```

The exporter should preserve the JSON Schema generated from Zod. It should set `strict: false` in v0.1 to avoid changing the semantics of optional fields. A future strict exporter can add an explicit compatibility mode that requires every object to set `additionalProperties: false` and every property to be listed in `required`, with optional values modeled as nullable.

Provider export findings:

- Root schema is not an object: `schema.root-not-object`.
- JSON Schema conversion failed: `schema.json-schema-unsupported`.
- Contract name is not provider-safe: `contract.invalid-name`.
- Description is missing: `contract.description-missing`.

Provider-safe names should match:

```text
^[a-zA-Z0-9_-]{1,64}$
```

This is intentionally stricter than arbitrary JavaScript names and compatible with common AI provider tool-name constraints.

## Fixture Generation

Fixture generation consumes JSON Schema, not Zod internals.

Generated files:

```text
.tool-call-contract/fixtures/<name>.valid.json
.tool-call-contract/fixtures/<name>.invalid.json
```

Valid fixture strategy:

1. If explicit examples exist, choose the first example that validates.
2. Otherwise synthesize a deterministic value from JSON Schema.
3. Wrap the argument object in normalized call shape:

```json
{
  "name": "create_issue",
  "arguments": {}
}
```

Invalid fixture strategy:

1. Remove the first required property when one exists.
2. Otherwise set the first known property to a clearly invalid type.
3. Otherwise use a malformed argument shape such as `"arguments": null`.

Supported JSON Schema constructs for synthesis:

- `type: "object"`
- `type: "string"`
- `type: "number"` and `type: "integer"`
- `type: "boolean"`
- `type: "array"`
- `enum`
- `const`
- nullable type arrays such as `["string", "null"]`
- `default`
- `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`

Unsupported constructs should produce `schema.fixture-unsupported` unless a validating explicit example is available. Unsupported fixture generation should not block docs or validation.

## Documentation Generation

Generated docs are Markdown files:

```text
.tool-call-contract/docs/<name>.md
```

Each document includes:

- Tool name.
- Description.
- Input field table.
- Required/optional/nullability information.
- Defaults and enum values when present.
- Valid call fixture.
- Invalid call fixture.
- OpenAI schema artifact path.

Docs should be generated from the contract metadata, JSON Schema, and generated fixtures. They should not infer runtime behavior beyond the schema and descriptions.

Field descriptions should come from JSON Schema metadata produced by Zod `.describe()` or `.meta({ description })` when present.

## Artifact Writing

Artifact generation should be idempotent.

Rules:

- Normalize all JSON with two-space indentation and trailing newline.
- Normalize Markdown with trailing newline.
- Sort object keys only for generated metadata where key order is not meaningful.
- Preserve contract order for summaries, but sort artifact filenames by contract name.
- Use SHA-256 hashes over final file content.
- Avoid timestamps and absolute paths in generated content.

Write plan:

```ts
export interface WritePlan {
  creates: GeneratedArtifact[];
  updates: GeneratedArtifact[];
  unchanged: GeneratedArtifact[];
  deletes: string[];
}
```

`--dry-run` reports the write plan without mutating the filesystem. Normal generation writes creates and updates. `--clean` additionally deletes stale manifest-owned files.

## Reporters

### Human Reporter

The default reporter prints:

- command summary
- severity
- finding or issue code
- contract name or file
- concise message
- impact and suggested fix when present

Use color only when stdout is a TTY and color is not disabled.

### JSON Reporter

The JSON reporter is the stable integration surface for the MVP.

Common envelope:

```ts
export interface JsonReport {
  schemaVersion: 1;
  command: "check" | "generate" | "validate";
  success: boolean;
  summary: Record<string, number>;
  findings?: Finding[];
  results?: ToolCallValidationResult[];
  artifacts?: {
    created: string[];
    updated: string[];
    unchanged: string[];
    deleted: string[];
  };
}
```

Future reporters:

- GitHub Actions annotations.
- SARIF.
- Markdown summary.

## Exit Codes

```text
0  Success with no blocking issues.
1  Check or validation failures.
2  Usage error, invalid options, missing config, or invalid config.
3  Unexpected internal error.
```

Expected project problems should become findings whenever possible. Internal stack traces should be hidden by default and shown only under a future `--debug` option.

## Testing Strategy

Use fixture projects and focused unit tests.

Unit test areas:

- `defineToolContract` structural validation.
- registry construction and duplicate detection.
- call normalization.
- Zod issue mapping.
- JSON Schema conversion error handling.
- fixture synthesis from JSON Schema.
- OpenAI export.
- artifact hashing and write-plan calculation.
- human and JSON reporters.

Fixture integration tests:

- valid three-tool config.
- duplicate tool names.
- invalid examples.
- schema that validates but cannot export to JSON Schema.
- stale generated artifacts.
- normalized captured call file.
- OpenAI Chat Completions-style captured call file.
- OpenAI Responses-style captured call file.

The test suite should avoid network access. Tests that load config files should use temporary directories and local fixture files.

## Dependency Choices

Recommended initial dependencies:

- CLI parser: `commander` or `cac`.
- Config loader: `jiti`.
- Terminal colors: `picocolors`.
- Hashing and filesystem: Node.js standard library.
- Schema validation and conversion: `zod` peer dependency.
- Test runner: `vitest`.
- TypeScript execution/build: `tsx` for development and `tsup` for package builds.

Avoid dependencies that execute generated code, call model APIs, or bring large transitive graphs unless they remove significant implementation risk.

## Security Considerations

- Config loading executes trusted project code; document this clearly.
- Captured calls are untrusted JSON and must never cause tool handlers to run.
- Do not call live model APIs.
- Do not read environment variables except ordinary process settings needed by the CLI runtime.
- Do not print full captured-call payloads in error summaries by default.
- Keep writes restricted to the configured output directory.
- `--clean` may delete only manifest-owned files.
- Avoid embedding absolute local paths in generated artifacts.

## Known Limitations

- Zod 3 is not supported in v0.1.
- Valibot and JSON Schema input contracts are deferred.
- OpenAI export starts with non-strict schemas to preserve optional-field semantics.
- Complex JSON Schema constructs may not synthesize fixtures in v0.1.
- Custom Zod refinements validate at runtime but may not be representable in docs or provider schemas.
- Source scanning for contracts is deferred in favor of explicit config.
- Monorepo orchestration is deferred.

## Implementation Plan

Implementation is tracked in [implementation-plan.md](implementation-plan.md). That document should break this design into reviewable phases sized around one code-review-commit cycle.

## References

- Zod JSON Schema docs: https://zod.dev/json-schema
- OpenAI function calling docs: https://platform.openai.com/docs/guides/function-calling
