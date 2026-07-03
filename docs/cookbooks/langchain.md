# LangChain Capture Cookbook

## When To Use It

Use the `langchain` format when you have LangChain message objects with completed
`tool_calls[]` entries.

This cookbook is for selected JSON records from local development or exported telemetry. It
does not instrument LangChain or reconstruct agent runs.

## Where The Trace Comes From

LangChain message objects can include a `tool_calls` array. `tool-call-contract` reads:

- tool name from `name`;
- arguments from `args`;
- optional id from `id`.

The input may be one message object or an array of message objects.

## Minimal Raw JSON

Single message example:

```json
{
  "id": "run_langchain_001",
  "tool_calls": [
    {
      "id": "lc_call_summary",
      "name": "summarize_thread",
      "args": {
        "messages": [
          {
            "role": "user",
            "content": "The analytics dashboard is missing yesterday's data."
          },
          {
            "role": "assistant",
            "content": "I checked the ingestion job and found a delayed warehouse sync."
          }
        ],
        "maxWords": 60
      }
    }
  ]
}
```

Array example:

```json
[
  {
    "tool_calls": [
      {
        "id": "lc_call_search",
        "name": "search_knowledge_base",
        "args": {
          "query": "billing export retention",
          "product": "billing",
          "limit": 2
        }
      }
    ]
  }
]
```

Example location:

```text
captures/raw/langchain.json
```

## Normalize

Normalize one file:

```sh
npx tool-call-contract normalize captures/raw/langchain.json --format langchain --out captures/regression/langchain.json
```

Normalize a configured suite:

```sh
npx tool-call-contract normalize --suite rawLangchain --format langchain --out-dir captures/regression
```

Check committed output in CI:

```sh
npx tool-call-contract normalize --suite rawLangchain --format langchain --out-dir captures/regression --check
```

## Validate

Validate the normalized regression fixture:

```sh
npx tool-call-contract validate captures/regression/langchain.json
```

Or validate a suite:

```sh
npx tool-call-contract validate --suite regression
```

## Redaction Warning

LangChain messages often include user text, tool arguments, retrieved content, and
application metadata. Do not commit raw runtime traces without review.

Normalize selected examples, then check redaction:

```sh
npx tool-call-contract redact --check --suite regression
```

If normalized arguments contain sensitive nested text, add explicit redaction paths for the
normalized shape.

## Production Telemetry Note

Keep full LangChain traces in the observability or storage system used by the application.
Commit only small regression fixtures that are reviewed, redacted, and stable.

`tool-call-contract` can validate the exported examples. It is not the place to store a
large corpus of agent runs.

## Unsupported Shapes

This format does not reconstruct LangChain streaming chunks.

This format does not traverse arbitrary LangSmith trace trees or span hierarchies.

This format does not infer contracts from LangChain tools. Define contracts explicitly in
`tool-call-contract.config.ts`.
