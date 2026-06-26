# tool-call-contract

Define AI tool contracts once, then validate captured calls and generate reviewable test artifacts.

`tool-call-contract` is a TypeScript library and CLI for teams building agentic apps with schema-defined tools. A contract gives you one source of truth for:

- runtime call validation with Zod
- generated valid and invalid fixtures
- OpenAI-compatible tool schema export
- lightweight Markdown tool docs
- stale artifact checks in CI

## Install

```sh
npm install -D tool-call-contract zod
```

`zod` is a peer dependency. The MVP targets Zod 4.

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

Generated artifacts are deterministic and safe to commit. If you prefer local build output, add the output directory to `.gitignore`; `check` only verifies freshness when a generated manifest is present.

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

Supported MVP capture shapes:

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

OpenAI Chat Completions-style `choices[].message.tool_calls` and OpenAI Responses-style `output[]` function calls are also normalized.

Unknown tools fail validation by default. To allow mixed traces while still reporting unknown calls as warnings:

```sh
npx tool-call-contract validate --allow-unknown captures/*.json
```

Use `--json` for deterministic machine-readable output:

```sh
npx tool-call-contract validate --json captures/*.json
```

JSON validation reports include grouped metadata for suites, files, and contracts while preserving the per-call `results` array.

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
    "tool-contracts:validate": "tool-call-contract validate --suite regression",
    "tool-contracts:redact": "tool-call-contract redact --check --suite regression",
    "tool-contracts:tests": "tool-call-contract generate-tests --suite regression"
  }
}
```

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
npx tool-call-contract validate --cwd examples/basic --suite smoke
npx tool-call-contract redact --cwd examples/basic --check --suite regression
npx tool-call-contract generate-tests --cwd examples/basic --suite regression
```

The example defines three contracts and includes direct captures, OpenAI-style captures, capture suites, an already-redacted regression capture, and generated-test output.

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

After the package exists on npm, tagged releases can use GitHub trusted publishing. See [v0.2 release notes](docs/v0.2.0/release.md).

## Known Limitations

- Zod schemas must be representable as JSON Schema for generated docs and OpenAI schema output.
- Custom Zod refinements still validate at runtime, but may not be expressible in generated artifacts.
- Fixture synthesis intentionally supports a conservative subset of JSON Schema.
- OpenAI export is the only provider schema output in the MVP.
- `validate` accepts JSON captures only.
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
