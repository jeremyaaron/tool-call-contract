# tool-call-contract PRD

## Summary

`tool-call-contract` is a TypeScript library and CLI that helps developers define, document, mock, and test AI tool-call contracts.

The first version focuses on teams building agentic TypeScript applications with schema-defined tools. It turns each tool definition into a reusable contract that can validate captured model calls, generate deterministic fixtures, produce lightweight documentation, and export provider-friendly tool schemas.

The product should feel like a practical test harness for AI tools: small enough to add to any project, strict enough to catch contract drift, and transparent enough that developers can trust what it is validating.

## Package Identity

The project publishes as the unscoped npm package `tool-call-contract` and exposes the binary `tool-call-contract`.

The repository and package name are settled as `tool-call-contract`. At PRD drafting time, the npm registry did not return an existing package for that name. The unscoped name is preferred because this is a general-purpose OSS tool intended to be installed directly as a dev dependency and run through `npx`.

If the project later grows into multiple packages, use an organization scope such as `@tool-call-contract/*` for adapters and supporting packages while keeping the primary package and binary as `tool-call-contract`.

## Problem

AI applications increasingly depend on tool calls, function calls, structured outputs, and agent actions. Those calls are only as reliable as the contract between the model, the application runtime, and the tool implementation.

Common failure modes include:

- Tool definitions drifting from runtime validators.
- Model calls using the wrong argument shape.
- Optional fields, defaults, enums, and nullable values being misunderstood.
- Mocked tool calls in tests not matching production tool schemas.
- Provider-specific tool definitions becoming the source of truth instead of application-owned contracts.
- Fixtures going stale as schemas evolve.
- Tool documentation living separately from executable validation.
- Tests covering happy paths while malformed tool calls are only discovered in production traces.
- Agent frameworks representing tool calls differently, making regression tests hard to share.

Existing schema libraries, AI SDKs, and test runners solve pieces of this problem, but developers still have to wire the contract, fixtures, mocks, docs, provider schemas, and regression validation themselves. `tool-call-contract` should provide one focused workflow for keeping AI tool calls testable.

## Goals

- Let TypeScript developers define AI tool contracts once and reuse them across validation, tests, fixtures, docs, and provider schemas.
- Catch malformed or stale tool calls before they reach production.
- Make generated fixtures deterministic and reviewable.
- Support captured-call regression tests without requiring live model calls.
- Provide useful Markdown documentation for tools from the same source of truth.
- Start with Zod support and keep the architecture open to Valibot and JSON Schema later.
- Keep the default experience local, fast, deterministic, and CI-friendly.

## Non-Goals

- Replacing Zod, Valibot, JSON Schema, Vitest, Jest, or AI SDKs.
- Running live LLM evaluations in the MVP.
- Judging semantic answer quality or model reasoning quality.
- Guaranteeing that a tool call is safe to execute.
- Generating exhaustive property-based test suites for every possible schema.
- Supporting every AI provider or agent framework on day one.
- Providing a hosted trace store, dashboard, or observability product.
- Becoming a general-purpose API contract testing framework.

## Target Users

### Primary User

A TypeScript developer building an AI agent, chatbot, workflow assistant, or automation system that calls application tools.

They already define tool arguments with Zod or a similar schema library, but they want confidence that model calls, mocks, fixtures, and docs stay aligned.

### Secondary Users

- Library authors shipping reusable AI tool kits.
- Teams using Vercel AI SDK, Mastra, LangChain, OpenAI SDKs, or custom agent runtimes.
- Developers converting prompt experiments into tested application code.
- QA and platform engineers who want captured AI calls validated in CI.
- Documentation authors who want tool reference docs generated from executable contracts.

## Positioning

`tool-call-contract` should be positioned as a contract test harness for AI tool calls, not as an agent framework.

Suggested tagline:

> Define AI tools once. Validate calls, generate fixtures, and catch contract drift.

## Product Principles

- Keep the application-owned contract as the source of truth.
- Prefer deterministic generation over clever randomness.
- Validate real captured calls without requiring network access.
- Make provider adapters explicit and inspectable.
- Treat generated files as reviewable artifacts.
- Fail loudly on unsupported schema features instead of pretending coverage is complete.
- Start narrow, then earn broader schema and framework support.
- Keep the runtime library small and the CLI behavior predictable.

## MVP Scope

The MVP targets:

- TypeScript projects.
- Zod-defined tool input schemas.
- Local and CI usage.
- Single-package repositories.
- Provider-neutral normalized tool-call validation.
- OpenAI-compatible tool schema export.
- Markdown docs and JSON fixture generation.
- Vitest-friendly test helpers.

The MVP exposes both a library API and a CLI.

Settled MVP decisions:

- Use `tool-call-contract` as the package, binary, and repository identity.
- Include OpenAI-compatible schema export and OpenAI tool-call normalization in v0.1 because captured OpenAI-style calls are common and the output shape is still small.
- Treat generated artifacts as commit-friendly by default. `check` validates freshness when artifacts are present, and teams may ignore the output directory if they prefer generated build output.
- Do not require explicit examples for every contract. Examples are optional; unsupported fixture generation should produce an actionable warning and can use developer-provided examples when available.
- Keep test helpers assertion-library neutral in v0.1. Vitest-specific matchers can be added later if the generic helpers prove too verbose.

### Library API

Developers define contracts in TypeScript:

```ts
import { defineToolContract } from "tool-call-contract";
import { z } from "zod";

export const createIssue = defineToolContract({
  name: "create_issue",
  description: "Create a GitHub issue.",
  input: z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    labels: z.array(z.string()).default([]),
  }),
});
```

Expected library capabilities:

- Define a named tool contract with description and input schema.
- Validate normalized tool calls against a contract.
- Return structured validation results without throwing by default.
- Parse valid calls into typed arguments.
- Generate deterministic valid and invalid fixtures for supported schema shapes.
- Convert supported contracts to OpenAI-compatible tool definitions.
- Provide test helpers that work naturally inside Vitest or any assertion library.

Example test usage:

```ts
import { validateToolCall } from "tool-call-contract";
import { createIssue } from "../src/tools/create-issue";

test("captured call still matches create_issue", () => {
  const result = validateToolCall(createIssue, {
    name: "create_issue",
    arguments: {
      title: "Bug in billing export",
      body: "The CSV contains duplicate rows.",
      labels: ["bug"],
    },
  });

  expect(result.ok).toBe(true);
});
```

### CLI Commands

The MVP exposes three commands:

```sh
tool-call-contract check
tool-call-contract generate
tool-call-contract validate <files...>
```

### Configuration

The CLI reads a TypeScript config file:

```ts
import { defineConfig } from "tool-call-contract";
import { createIssue } from "./src/tools/create-issue";

export default defineConfig({
  contracts: [createIssue],
  outDir: ".tool-call-contract",
});
```

Default config lookup:

- `tool-call-contract.config.ts`
- `tool-call-contract.config.mts`
- `tool-call-contract.config.js`
- `tool-call-contract.config.mjs`

### `tool-call-contract check`

Runs read-only validation of contract definitions and generated artifact freshness.

Expected behavior:

- Load the project config.
- Validate contract names are unique and provider-safe.
- Validate each contract has a non-empty description.
- Validate each input schema is supported by the MVP generator and exporters.
- Validate checked-in generated artifacts are fresh when present.
- Print grouped findings with severity, rationale, and suggested fix.
- Support `--json` for CI and editor integrations.
- Support `--strict` to treat warnings as errors.

Example:

```sh
$ tool-call-contract check

tool-call-contract found 2 issues

error contract.duplicate-name
  Two contracts are named "create_issue".

  Impact:
    Captured calls and provider schemas cannot be mapped back to one source contract.

  Fix:
    Rename one contract so each tool name is unique.

warning schema.fixture-unsupported
  Tool "search_docs" uses a schema feature that deterministic fixture generation does not support yet.

  Fix:
    Add explicit examples for this contract or simplify the schema shape.
```

### `tool-call-contract generate`

Generates deterministic artifacts from configured contracts.

Expected output:

```text
.tool-call-contract/
  fixtures/
    create_issue.valid.json
    create_issue.invalid.json
  schemas/
    create_issue.openai.json
  docs/
    create_issue.md
  manifest.json
```

Expected behavior:

- Generate valid fixtures for supported schemas.
- Generate at least one invalid fixture that should fail validation.
- Generate OpenAI-compatible JSON tool definitions.
- Generate concise Markdown reference docs.
- Write a manifest containing generator version, contract names, and content hashes.
- Support `--dry-run` to preview changed artifacts.
- Support `--clean` to remove stale generated artifacts owned by the manifest.

Generated artifacts should be stable across runs when contracts have not changed. They are designed to be checked into source control by default. Teams that prefer local build output can add the output directory to `.gitignore`; `check` should validate freshness only when generated artifacts or a manifest are present.

### `tool-call-contract validate <files...>`

Validates captured tool calls or fixture files against configured contracts.

Expected behavior:

- Load configured contracts.
- Read one or more JSON files.
- Accept a single call, an array of calls, or a named capture object.
- Normalize supported call shapes into `{ name, arguments }`.
- Validate each call against the matching contract.
- Report missing contracts, schema failures, and malformed JSON.
- Exit non-zero when any call is invalid.
- Support `--json` for machine-readable CI output.

Supported MVP normalized call shape:

```json
{
  "name": "create_issue",
  "arguments": {
    "title": "Bug in billing export",
    "body": "The CSV contains duplicate rows.",
    "labels": ["bug"]
  }
}
```

OpenAI-style tool call normalization is included in the MVP for the common `tool_calls[].function.name` and JSON-encoded `tool_calls[].function.arguments` shape, plus Responses-style function call output items when they can be normalized without executing application code. Broader provider compatibility remains adapter-driven future work.

## Schema Support

The MVP supports enough Zod functionality to be useful while keeping fixture generation deterministic.

Initial supported input schema shapes:

- `z.object`
- `z.string`
- `z.number`
- `z.boolean`
- `z.array`
- `z.enum`
- `z.literal`
- Optional object fields
- Nullable values
- Defaults where they can be observed through parsing
- Basic string and number constraints for validation

Initial unsupported or warning-only shapes:

- Recursive schemas.
- Unions beyond simple literal discriminators.
- Transforms with side effects.
- Async refinements.
- Custom refinements that cannot be represented in generated docs or JSON Schema.
- Schema features that cannot be introspected reliably.

Unsupported features should not crash the CLI. They should produce structured findings that explain which capability is unavailable: validation, fixture generation, docs, or provider export.

## Generated Documentation

Markdown docs should be useful in a repo without becoming a documentation framework.

Each tool doc should include:

- Tool name.
- Description.
- Input fields.
- Required versus optional fields.
- Defaults when discoverable.
- Enum or literal options.
- Example valid call.
- Example invalid call.
- Provider export notes when relevant.

Docs should avoid claiming semantic behavior that is not present in the contract. The tool description and field descriptions come from developer-authored contract metadata.

## Validation Model

Validation results should be structured and reporter-neutral.

Conceptual result shape:

```ts
export type ToolCallValidationResult =
  | {
      ok: true;
      contractName: string;
      value: unknown;
    }
  | {
      ok: false;
      contractName?: string;
      issues: ToolCallIssue[];
    };
```

Issues should include stable codes, human-readable messages, and paths into the argument object when available.

Example issue codes:

```text
call.unknown-tool
call.invalid-json
call.arguments-missing
call.arguments-not-object
schema.required-field-missing
schema.invalid-type
schema.invalid-enum-value
contract.duplicate-name
contract.description-missing
artifact.stale
artifact.write-failed
```

## Provider and Framework Compatibility

The MVP should keep the core contract format independent from any provider or framework.

Initial provider output:

- OpenAI-compatible tool/function schema JSON.

Future adapters may support:

- Vercel AI SDK tool definitions.
- Mastra tools.
- LangChain structured tools.
- Anthropic tool definitions.
- Google Gemini function declarations.
- Model Context Protocol tool schemas.
- OpenAPI-style docs.

Provider adapters should be generated from contracts. They should not become separate sources of truth.

## Configuration Principles

Configuration should stay small in the MVP.

Supported config fields:

```ts
export interface ToolCallContractConfig {
  contracts: ToolContract[];
  outDir?: string;
  examples?: Record<string, unknown[]>;
  include?: string[];
  exclude?: string[];
}
```

The MVP should not require users to adopt a file naming convention for individual tools. Explicit config is acceptable because it is predictable and avoids fragile source scanning.

Explicit examples are optional. They should be used as fixture seeds when present and as a fallback for schemas whose validation is supported but deterministic fixture generation is not.

Source scanning can be explored later once the contract format stabilizes.

## Output and CI Behavior

CLI output should work well locally and in CI.

Human output:

- Group findings by command context.
- Show severity, stable code, and affected tool or file.
- Include concise impact and fix guidance.
- Avoid stack traces for expected user errors.

JSON output:

- Include schema version.
- Include command name.
- Include findings or validation results.
- Include generated artifact paths when relevant.
- Avoid non-deterministic ordering.

Exit codes:

- `0`: command succeeded with no blocking issues.
- `1`: validation or check failures.
- `2`: usage error or invalid CLI options.
- Unexpected internal errors should still be reported cleanly.

## Security and Safety

`tool-call-contract` reduces contract risk, but it does not make tool execution safe by itself.

MVP safety expectations:

- `check` and `validate` are read-only.
- `generate` writes only under the configured output directory unless explicitly configured otherwise.
- `generate --clean` deletes only files owned by the generated manifest.
- The CLI should not call live model APIs.
- The CLI should not execute tool handlers.
- Config loading should be documented as code execution, because TypeScript config files are executable.
- Captured calls should be treated as untrusted input and validated without executing application behavior.

## Success Metrics

For v0.1, success means:

- A developer can define at least three realistic Zod-backed tool contracts.
- `tool-call-contract generate` creates stable fixtures, docs, and OpenAI-compatible schemas.
- `tool-call-contract validate` catches malformed captured calls with clear messages.
- A project can run validation in CI without network access.
- Generated artifacts are deterministic enough to commit.
- Unsupported schema features produce actionable findings instead of crashes.

## Future Directions

Potential post-MVP features:

- Valibot support.
- JSON Schema as an input format.
- Provider adapters for Vercel AI SDK, Mastra, LangChain, Anthropic, Gemini, and MCP.
- Test-runner integrations for Vitest and Jest matchers.
- Captured trace import from common AI SDK logs.
- Fixture generation with seeded fuzzing.
- Contract diffing for pull requests.
- Backward-compatibility checks for published tool kits.
- OpenAPI-style generated documentation.
- Schema coverage reports showing which tool fields appear in captured calls.
- Redaction helpers for sensitive captured-call fields.
