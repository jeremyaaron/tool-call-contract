# OpenAI Responses Capture Cookbook

## When To Use It

Use the `openai-responses` format when you have an OpenAI Responses-style JSON object with
completed `function_call` items in `output[]`.

This cookbook is for selected examples from local development, test runs, or an exported
telemetry record. It is not a runtime recorder.

## Where The Trace Comes From

OpenAI Responses output commonly contains an `output` array. `tool-call-contract`
extracts items whose `type` is `function_call`.

The extractor reads:

- tool name from `name`;
- arguments from `arguments`;
- optional call id from `call_id`.

`arguments` may be a JSON string and will be parsed into an object.

## Minimal Raw JSON

Save a small raw trace:

```json
{
  "id": "resp_example_001",
  "output": [
    {
      "type": "message",
      "content": [
        {
          "type": "output_text",
          "text": "I found the billing export details."
        }
      ]
    },
    {
      "type": "function_call",
      "call_id": "call_search_billing",
      "name": "search_knowledge_base",
      "arguments": "{\"query\":\"billing export retention\",\"product\":\"billing\",\"limit\":2}"
    }
  ]
}
```

Example location:

```text
captures/raw/openai-responses.json
```

## Normalize

Normalize one file:

```sh
npx tool-call-contract normalize captures/raw/openai-responses.json --format openai-responses --out captures/regression/openai-responses.json
```

Normalize a configured raw suite:

```sh
npx tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression
```

Check committed output in CI:

```sh
npx tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression --check
```

## Validate

Validate the normalized regression fixture:

```sh
npx tool-call-contract validate --suite regression
```

Or validate one file:

```sh
npx tool-call-contract validate captures/regression/openai-responses.json
```

## Redaction Warning

Normalization is not redaction. OpenAI traces can include prompt text, customer content,
metadata, and tool arguments that should not be committed.

Configure deterministic paths:

```ts
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

Then check redaction before committing:

```sh
npx tool-call-contract redact --check --suite regression
```

## Production Telemetry Note

Production traces should live in logs, object storage, databases, or observability tools.
Commit only small, reviewed, redacted regression fixtures.

If a production trace is useful for regression coverage, export the smallest safe JSON
example, normalize it locally, redact it, and review the diff.

## Unsupported Shapes

This format does not reconstruct streaming deltas.

This format does not read arbitrary nested telemetry envelopes unless the JSON being
normalized is the Responses object itself or a direct array of supported response items.

Tool results, assistant text, and non-`function_call` items are not converted into
regression captures.
