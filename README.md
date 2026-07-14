# tool-call-contract

Define AI tool contracts once, then validate captured calls and generate reviewable test artifacts.

`tool-call-contract` is a TypeScript library and CLI for teams building agentic apps with schema-defined tools. A contract gives you one source of truth for:

- runtime call validation with Zod
- raw provider trace normalization into curated regression fixtures
- generated valid and invalid fixtures
- OpenAI-compatible tool schema export
- lightweight Markdown tool docs
- stale artifact checks in CI

## What This Is

`tool-call-contract` defines and tests contracts for AI tool calls.

It validates tool calls wherever you have them, normalizes selected raw provider/framework traces into the canonical capture shape, redacts configured paths, and generates regression tests from reviewed fixtures.

Use it when you want a small local/CI workflow for contract drift, fixture validation, and repeatable tool-call regression tests.

## What This Is Not

`tool-call-contract` is not a telemetry backend, model runner, tool orchestrator, runtime instrumentation package, hosted dashboard, or PII detector.

Raw traces are operational data. Keep production-scale traces in logs, object storage, databases, or observability systems. Commit only small, reviewed, redacted regression fixtures.

## Install

```sh
npm install -D tool-call-contract zod
```

`zod` is a peer dependency. The package targets Zod 4.

## Quickstart

Create a starter config, sample raw trace, normalized regression fixture, and package scripts:

```sh
npx tool-call-contract init
```

Preview first if the project already has files you care about:

```sh
npx tool-call-contract init --dry-run
```

Then run the starter workflow:

```sh
npm run tool-contracts:check
npm run tool-contracts:artifacts
npm run tool-contracts:normalize:check
npm run tool-contracts:redact
npm run tool-contracts:validate
npm run tool-contracts:tests -- --dry-run
```

For command-specific options and examples:

```sh
npx tool-call-contract help init
npx tool-call-contract help normalize
```

## Define Contracts

Create `tool-call-contract.config.ts` in your project root:

```ts
import { z } from "zod";
import { defineConfig, defineToolContract } from "tool-call-contract";

const searchKnowledgeBase = defineToolContract({
  name: "search_knowledge_base",
  description: "Search internal product documentation for a user question.",
  input: z.object({
    query: z.string().min(1),
    product: z.enum(["billing", "analytics", "platform"]),
    limit: z.number().int().min(1).max(10).default(5),
  }),
});

const createIssue = defineToolContract({
  name: "create_issue",
  description: "Create an engineering issue from a validated support escalation.",
  input: z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    labels: z.array(z.string()).default([]),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
  }),
});

export default defineConfig({
  contracts: [searchKnowledgeBase, createIssue],
  captures: {
    raw: ["captures/raw/*.json"],
    smoke: ["captures/smoke/*.json"],
    regression: ["captures/regression/*.json"],
  },
  redaction: {
    paths: ["arguments.email", "metadata.authorization"],
  },
});
```

## Check Contracts

```sh
npx tool-call-contract check
```

`check` validates contract names, descriptions, examples, schema export support, and generated artifact freshness when a manifest exists.

Useful options:

```sh
npx tool-call-contract check --strict
npx tool-call-contract check --ignore schema.fixture-unsupported
npx tool-call-contract check --json
```

## Generate Artifacts

```sh
npx tool-call-contract generate
```

By default this writes:

```text
.tool-call-contract/
  fixtures/
  schemas/
  docs/
  manifest.json
```

Use `--dry-run` to preview writes:

```sh
npx tool-call-contract generate --dry-run
```

Use `--out-dir` to choose a different output directory inside the project:

```sh
npx tool-call-contract generate --out-dir generated/tool-contracts
```

Use `--clean` to remove stale files that are owned by the previous manifest:

```sh
npx tool-call-contract generate --clean
```

Generated artifacts are deterministic and safe to commit. If you prefer local build output, add the output directory to `.gitignore`.

## Inspect Artifact Freshness

Use `artifacts` when you want to inspect generated files without writing or deleting anything:

```sh
npx tool-call-contract artifacts
```

Use `artifacts --check` as a focused CI gate for generated output:

```sh
npx tool-call-contract artifacts --check
```

The artifact lifecycle is:

- `generate` writes fixtures, schemas, docs, and `manifest.json`.
- `artifacts` reports whether generated files are fresh, missing, stale, or cleanable, but exits `0` when config loads.
- `artifacts --check` exits non-zero when generated files or the manifest are missing, stale, or unsafe.
- `check` runs broader contract, schema, and artifact freshness checks. It verifies artifacts only when a generated manifest exists, so projects can use local ignored output without failing broad contract checks.
- `generate --clean` removes stale manifest-owned files. `artifacts` never deletes files.

If you use a custom output directory, pass the same directory to both commands:

```sh
npx tool-call-contract generate --out-dir generated/tool-contracts
npx tool-call-contract artifacts --out-dir generated/tool-contracts --check
```

## Validate Captures

Validate one or more captured JSON files:

```sh
npx tool-call-contract validate captures/*.json
```

Or define named capture suites in config and validate them with a stable CI command:

```sh
npx tool-call-contract validate --suite smoke
npx tool-call-contract validate --suite regression --json
```

Supported capture shapes:

```json
{
  "name": "search_knowledge_base",
  "arguments": {
    "query": "How do billing exports work?",
    "product": "billing"
  }
}
```

```json
[
  {
    "toolName": "search_knowledge_base",
    "args": {
      "query": "retention policy",
      "product": "platform"
    }
  }
]
```

```json
{
  "calls": [
    {
      "name": "create_issue",
      "arguments": {
        "title": "Export is delayed",
        "body": "Customer reports yesterday's export has not arrived."
      }
    }
  ]
}
```

OpenAI Chat Completions-style `choices[].message.tool_calls` and OpenAI Responses-style `output[]` function calls are also accepted by validation.

Unknown tools fail validation by default. To allow mixed traces while still reporting unknown calls as warnings:

```sh
npx tool-call-contract validate --allow-unknown captures/*.json
```

Use `--json` for deterministic machine-readable output:

```sh
npx tool-call-contract validate --json captures/*.json
```

JSON validation reports include grouped metadata for suites, files, and contracts while preserving the per-call `results` array.

## Normalize Raw Traces

Most agent frameworks do not emit `tool-call-contract`'s canonical capture shape directly. Use `normalize` to turn selected raw provider or framework traces into deterministic regression fixtures:

```sh
npx tool-call-contract normalize captures/raw/openai.json --format openai-responses --out captures/regression/openai.json
npx tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression
```

Then validate the normalized suite:

```sh
npx tool-call-contract validate --suite regression
```

In CI, use `--check` to fail when committed normalized captures are missing or stale:

```sh
npx tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression --check
```

Use `--dry-run` while wiring a new capture source:

```sh
npx tool-call-contract normalize captures/raw/langchain.json --format langchain --dry-run --json
```

Supported normalization formats:

| Format             | Typical input shape                                         |
| ------------------ | ----------------------------------------------------------- |
| `normalized`       | Existing `{ "name": "...", "arguments": { ... } }` captures |
| `openai-chat`      | Chat Completions `choices[].message.tool_calls[]` traces    |
| `openai-responses` | Responses API `output[]` items with `type: "function_call"` |
| `vercel-ai-sdk`    | Vercel AI SDK `toolCalls[]` or `parts[]` tool call records  |
| `langchain`        | LangChain message objects with `tool_calls[]`               |
| `generic`          | Custom JSON selected with configured dot paths              |

OpenAI Responses example:

```json
{
  "output": [
    {
      "type": "function_call",
      "call_id": "call_search",
      "name": "search_knowledge_base",
      "arguments": "{\"query\":\"billing exports\",\"product\":\"billing\"}"
    }
  ]
}
```

LangChain example:

```json
{
  "tool_calls": [
    {
      "id": "call_summary",
      "name": "summarize_thread",
      "args": {
        "messages": [{ "role": "user", "content": "The export is late." }],
        "maxWords": 80
      }
    }
  ]
}
```

Generic normalization is useful for simple custom trace envelopes. Configure the paths once:

```ts
export default defineConfig({
  contracts: [searchKnowledgeBase],
  captures: {
    rawCustom: ["captures/raw/custom/*.json"],
    regression: ["captures/regression/*.json"],
  },
  normalization: {
    generic: {
      callsPath: "events.*.toolCall",
      namePath: "name",
      argumentsPath: "arguments",
      idPath: "id",
    },
  },
});
```

Then run:

```sh
npx tool-call-contract normalize --suite rawCustom --format generic --out-dir captures/regression
```

Normalization is not redaction. Normalize first to get a stable contract shape, then run `redact --check` before committing fixtures that may contain sensitive data.

## Redact Captures

Captured traces often include customer text, emails, request metadata, or tokens. Configure deterministic redaction paths:

```ts
export default defineConfig({
  contracts: [searchKnowledgeBase, createIssue],
  redaction: {
    paths: ["arguments.email", "metadata.authorization"],
    replacement: "[REDACTED]",
  },
});
```

Then redact files in place:

```sh
npx tool-call-contract redact captures/raw.json
```

Preview or enforce redaction in CI:

```sh
npx tool-call-contract redact --dry-run --suite regression
npx tool-call-contract redact --check --suite regression
```

Write redacted copies instead of mutating the source files:

```sh
npx tool-call-contract redact captures/raw.json --out captures/safe/raw.json
npx tool-call-contract redact --suite regression --out-dir captures/redacted
```

Redaction is deterministic path replacement, not PII detection. Choose paths that match your capture format before committing traces.

## Generate Regression Tests

Turn configured capture suites into a plain Vitest test file:

```sh
npx tool-call-contract generate-tests --suite regression
```

By default this writes:

```text
test/tool-call-contract.generated.test.ts
```

Use a custom output path or preview the write:

```sh
npx tool-call-contract generate-tests --out tests/tool-calls.generated.test.ts
npx tool-call-contract generate-tests --suite regression --dry-run
```

Generated tests read capture JSON at runtime and call `validateToolCalls(config.contracts, capture)`. They do not call model APIs and do not execute tool handlers.

Useful package scripts:

```json
{
  "scripts": {
    "tool-contracts:check": "tool-call-contract check",
    "tool-contracts:generate": "tool-call-contract generate",
    "tool-contracts:artifacts": "tool-call-contract artifacts --check",
    "tool-contracts:normalize": "tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression",
    "tool-contracts:normalize:check": "tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression --check",
    "tool-contracts:validate": "tool-call-contract validate --suite regression",
    "tool-contracts:redact": "tool-call-contract redact --check --suite regression",
    "tool-contracts:tests": "tool-call-contract generate-tests --suite regression"
  }
}
```

## Recommended CI

For projects that commit reviewed regression fixtures, use this order:

```sh
npx tool-call-contract check
npx tool-call-contract artifacts --check
npx tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression --check
npx tool-call-contract redact --check --suite regression
npx tool-call-contract validate --suite regression
npx tool-call-contract generate-tests --suite regression --dry-run
```

Use `generate --dry-run` as an additional local review step when generated artifacts are not committed. Use `artifacts --check` when generated artifacts are committed and should remain fresh. `check` remains the broad contract/schema gate and treats generated artifacts as optional until a manifest exists.

## Library Usage

```ts
import { validateToolCall } from "tool-call-contract";
import { createIssue } from "./tools";

const result = validateToolCall(createIssue, {
  name: "create_issue",
  arguments: {
    title: "Billing export duplicates rows",
    body: "The monthly CSV has duplicate entries.",
  },
});

if (!result.ok) {
  console.error(result.issues);
}
```

## Example Project

This repository includes an executable example at [examples/basic](examples/basic).

```sh
npx tool-call-contract check --cwd examples/basic
npx tool-call-contract generate --cwd examples/basic
npx tool-call-contract artifacts --cwd examples/basic --check
npx tool-call-contract normalize --cwd examples/basic --suite raw --format openai-responses --out-dir captures/regression --check
npx tool-call-contract normalize --cwd examples/basic --suite rawLangchain --format langchain --out-dir captures/regression --check
npx tool-call-contract validate --cwd examples/basic --suite smoke
npx tool-call-contract redact --cwd examples/basic --check --suite regression
npx tool-call-contract validate --cwd examples/basic --suite regression
npx tool-call-contract generate-tests --cwd examples/basic --suite regression
```

The example defines three contracts and includes direct captures, OpenAI-style captures, raw OpenAI Responses and LangChain traces, normalized regression captures, redaction checks, capture suites, and generated-test output.

## Guides And Cookbooks

- [Agent integration guide](AGENTS.md)
- [OpenAI Responses capture cookbook](docs/cookbooks/openai-responses.md)
- [Vercel AI SDK capture cookbook](docs/cookbooks/vercel-ai-sdk.md)
- [LangChain capture cookbook](docs/cookbooks/langchain.md)

## Config Loading Is Trusted Code

The CLI loads `tool-call-contract.config.ts` as code. Treat config files as trusted project code, the same way you would treat `vite.config.ts`, `eslint.config.js`, or a test setup file. Do not run the CLI against untrusted repositories or unreviewed config files.

## Release Verification

Before publishing, run:

```sh
npm run verify:release
```

This verifies linting, formatting, types, tests, build output, package metadata, packed contents, and installation into a temporary project. First publication requires an interactive npm publish:

```sh
npm publish --auth-type=web
```

After the package exists on npm, tagged releases can use GitHub trusted publishing. See [v0.4 release notes](docs/v0.4.0/release.md).

## Known Limitations

- Zod schemas must be representable as JSON Schema for generated docs and OpenAI schema output.
- Custom Zod refinements still validate at runtime, but may not be expressible in generated artifacts.
- Fixture synthesis intentionally supports a conservative subset of JSON Schema.
- OpenAI export is the only provider schema output in the current release.
- `validate` accepts JSON captures only.
- `normalize` supports common completed tool-call records, not streaming delta reconstruction.
- Normalized output is still capture data. Review and redact sensitive content before committing.
- `redact` is deterministic path replacement, not automatic sensitive-data discovery.
- Generated tests target Vitest first and intentionally avoid custom matchers.
- The CLI does not call model APIs and does not execute tool implementations.

## Project Docs

- [v0.1 PRD](docs/v0.1.0/prd.md)
- [v0.1 technical design](docs/v0.1.0/technical-design.md)
- [v0.1 implementation plan](docs/v0.1.0/implementation-plan.md)
- [v0.2 PRD](docs/v0.2.0/prd.md)
- [v0.2 technical design](docs/v0.2.0/technical-design.md)
- [v0.2 implementation plan](docs/v0.2.0/implementation-plan.md)
- [v0.2 release notes](docs/v0.2.0/release.md)
- [v0.3 PRD](docs/v0.3.0/prd.md)
- [v0.3 technical design](docs/v0.3.0/technical-design.md)
- [v0.3 implementation plan](docs/v0.3.0/implementation-plan.md)
- [v0.3 release notes](docs/v0.3.0/release.md)
- [v0.4 PRD](docs/v0.4.0/prd.md)
- [v0.4 technical design](docs/v0.4.0/technical-design.md)
- [v0.4 implementation plan](docs/v0.4.0/implementation-plan.md)
- [v0.4 release notes](docs/v0.4.0/release.md)
