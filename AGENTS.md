# Using tool-call-contract In A Project

## Goal

Add a local, deterministic regression workflow for AI tool calls.

`tool-call-contract` defines tool contracts, normalizes selected raw traces into small
regression fixtures, redacts configured fields, validates captures, and generates Vitest
regression tests.

It does not capture production calls automatically, store telemetry, run models, execute
tools, or detect sensitive data automatically.

## Do This

1. Inspect the project for existing tool definitions, tool handlers, Zod schemas, and test
   conventions.
2. Install the package if it is missing:

   ```sh
   npm install -D tool-call-contract zod
   ```

3. Bootstrap a starter setup when the project does not already have one:

   ```sh
   npx tool-call-contract init
   ```

4. Replace the starter contract with real project tool contracts.
5. Keep raw provider/framework traces small, synthetic, or exported from local development.
6. Normalize selected raw traces into `captures/regression`.
7. Redact before committing fixtures that came from runtime behavior.
8. Validate committed regression fixtures.
9. Generate or refresh regression tests.
10. Add package scripts or CI checks.

## Commands

Preview bootstrap changes:

```sh
npx tool-call-contract init --dry-run
```

Create starter files:

```sh
npx tool-call-contract init
```

Check contracts and generated artifact freshness:

```sh
npx tool-call-contract check
```

Normalize one OpenAI Responses trace:

```sh
npx tool-call-contract normalize captures/raw/openai-responses.json --format openai-responses --out captures/regression/openai-responses.json
```

Normalize a configured raw suite:

```sh
npx tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression
```

Check normalized fixtures in CI:

```sh
npx tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression --check
```

Check configured redaction:

```sh
npx tool-call-contract redact --check --suite regression
```

Validate regression fixtures:

```sh
npx tool-call-contract validate --suite regression
```

Generate tests:

```sh
npx tool-call-contract generate-tests --suite regression
```

Preview generated tests in CI:

```sh
npx tool-call-contract generate-tests --suite regression --dry-run
```

Use command help when option details are needed:

```sh
npx tool-call-contract help normalize
npx tool-call-contract help redact
npx tool-call-contract help generate-tests
```

## Files To Create

Minimum project shape:

```text
tool-call-contract.config.ts
captures/
  raw/
    openai-responses.json
  regression/
    openai-responses.json
```

Optional generated test file:

```text
test/tool-call-contract.generated.test.ts
```

Typical config shape:

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

export default defineConfig({
  contracts: [searchKnowledgeBase],
  captures: {
    raw: ["captures/raw/*.json"],
    regression: ["captures/regression/*.json"],
  },
  redaction: {
    paths: ["arguments.email", "metadata.authorization"],
  },
});
```

## Validation

Recommended local update flow:

```sh
npx tool-call-contract check
npx tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression
npx tool-call-contract redact --check --suite regression
npx tool-call-contract validate --suite regression
npx tool-call-contract generate-tests --suite regression
```

Recommended CI flow:

```sh
npx tool-call-contract check
npx tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression --check
npx tool-call-contract redact --check --suite regression
npx tool-call-contract validate --suite regression
npx tool-call-contract generate-tests --suite regression --dry-run
```

Commit reviewed contract files, redacted regression fixtures, and generated tests when the
project chooses to keep generated tests in source control.

## Do Not

- Do not invent production traces.
- Do not commit secrets, tokens, customer text, or raw telemetry without review.
- Do not treat `captures/raw` as a production log store.
- Do not claim automatic instrumentation for OpenAI, Vercel AI SDK, LangChain, or other
  frameworks.
- Do not add unsupported provider/framework claims.
- Do not import `tool-call-contract` internal source files from application code.
- Do not use `redact` as a substitute for automatic PII discovery.
- Do not normalize streaming deltas unless they have already been reconstructed into a
  supported completed tool-call shape.

## Troubleshooting

If config is missing, run:

```sh
npx tool-call-contract init
```

If `normalize` says the format is required, pass one explicitly:

```sh
npx tool-call-contract normalize captures/raw/example.json --format openai-responses --dry-run
```

If `normalize --check` fails, regenerate the regression fixture locally, review the diff,
then commit the updated fixture:

```sh
npx tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression
```

If `redact --check` fails, inspect configured `redaction.paths`, run redaction locally only
after confirming the replacement is intended, then review the diff.

If `validate` reports `call.unknown-tool`, add a matching contract or remove the unrelated
tool call from the regression fixture.

If a framework trace does not match a cookbook shape, export a smaller JSON object that
contains only the completed tool-call records and normalize that file.
