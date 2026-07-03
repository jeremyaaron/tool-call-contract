# Vercel AI SDK Capture Cookbook

## When To Use It

Use the `vercel-ai-sdk` format when you have recorded Vercel AI SDK message or tool-call
objects that include completed tool calls.

This cookbook focuses on JSON records you already have. It does not install the Vercel AI
SDK, wrap model calls, or capture runtime calls automatically.

## Where The Trace Comes From

`tool-call-contract` supports two common AI SDK shapes:

- objects with `toolCalls[]`;
- objects with `parts[]` entries where `type` starts with `tool-` or `toolName` is present.

For `toolCalls[]`, the extractor reads:

- tool name from `toolName`;
- arguments from `args` or `input`;
- optional id from `toolCallId` or `id`.

For `parts[]`, the extractor reads:

- tool name from `toolName`, or from `type` after the `tool-` prefix;
- arguments from `args` or `input`;
- optional id from `toolCallId` or `id`.

## Minimal Raw JSON

Example using `toolCalls[]`:

```json
{
  "role": "assistant",
  "toolCalls": [
    {
      "toolCallId": "call_search_billing",
      "toolName": "search_knowledge_base",
      "args": {
        "query": "billing export retention",
        "product": "billing",
        "limit": 2
      }
    }
  ]
}
```

Example using `parts[]`:

```json
{
  "role": "assistant",
  "parts": [
    {
      "type": "tool-search_knowledge_base",
      "toolCallId": "call_search_billing",
      "input": {
        "query": "billing export retention",
        "product": "billing",
        "limit": 2
      }
    }
  ]
}
```

Example location:

```text
captures/raw/vercel-ai-sdk.json
```

## Normalize

Normalize one file:

```sh
npx tool-call-contract normalize captures/raw/vercel-ai-sdk.json --format vercel-ai-sdk --out captures/regression/vercel-ai-sdk.json
```

Normalize a configured suite:

```sh
npx tool-call-contract normalize --suite raw --format vercel-ai-sdk --out-dir captures/regression
```

Check committed output in CI:

```sh
npx tool-call-contract normalize --suite raw --format vercel-ai-sdk --out-dir captures/regression --check
```

## Validate

Validate the normalized regression fixture:

```sh
npx tool-call-contract validate --suite regression
```

Use JSON output when another tool will read the result:

```sh
npx tool-call-contract validate --suite regression --json
```

## Redaction Warning

AI SDK message records can include user prompts, intermediate assistant text, tool
arguments, and application metadata. Normalize only small examples that are safe to review.

Redaction is explicit path replacement. Configure paths for your normalized fixture shape
and run:

```sh
npx tool-call-contract redact --check --suite regression
```

## Production Telemetry Note

Keep production AI SDK telemetry in the system that already stores operational data. Use
`tool-call-contract` for curated regression fixtures, not as a telemetry sink.

If a real AI SDK record exposes a regression gap, export a small JSON object with only the
completed tool-call data needed for the test.

## Unsupported Shapes

This format does not reconstruct streaming tool-call deltas.

This format does not execute AI SDK tools, inspect application handlers, or infer schemas
from tool definitions.

This format does not normalize tool results without a completed tool-call record.
