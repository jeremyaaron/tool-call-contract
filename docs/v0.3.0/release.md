# tool-call-contract v0.3.0 Release Notes

`v0.3.0` adds raw trace normalization to the captured-call regression workflow.

The release keeps normalized captures as the stable contract boundary, but removes most of the glue code needed to get there from real provider and framework traces.

## Highlights

- New `normalize` CLI command.
- Dry-run, write, and `--check` modes for normalized capture files.
- Supported formats:
  - `normalized`
  - `openai-chat`
  - `openai-responses`
  - `vercel-ai-sdk`
  - `langchain`
  - `generic`
- Generic normalization config with dot-path selectors.
- Public side-effect-free normalization helpers:
  - `normalizeToolCallCapture`
  - `normalizeToolCallCaptures`
- Normalization report metadata in JSON reports.
- Human-readable normalization summaries.
- Validation now reuses normalization internals while preserving existing accepted capture shapes.

## Workflow

Generate normalized regression captures from raw traces:

```sh
tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression
```

Check freshness in CI:

```sh
tool-call-contract normalize --suite raw --format openai-responses --out-dir captures/regression --check
```

Then continue the existing loop:

```sh
tool-call-contract redact --check --suite regression
tool-call-contract validate --suite regression
tool-call-contract generate-tests --suite regression
```

## Compatibility

- Report `schemaVersion` remains `1`.
- Existing `check`, `generate`, `validate`, `redact`, and `generate-tests` behavior is preserved.
- Existing normalized, OpenAI Chat, and OpenAI Responses validation inputs remain supported.
- The public package exports intentionally expose normalization helpers and report metadata, but keep file-writing normalization internals private.

## Limitations

- Normalization is not redaction. Review and redact sensitive capture data before committing.
- Streaming delta reconstruction is not included.
- Provider-specific config is not included beyond the generic path-based format.
- Output path templates and per-call output splitting are deferred.

## Verification

The release verification path is:

```sh
npm run verify:release
```

This runs linting, formatting, typecheck, tests, build, `pkg-guard`, `npm pack --dry-run`, and the packed-package smoke test.
