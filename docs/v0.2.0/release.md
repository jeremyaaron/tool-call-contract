# tool-call-contract v0.2.0 Release Notes

## Summary

`v0.2.0` turns the MVP validation workflow into a captured-call regression workflow.

The release keeps the v0.1 contract API intact while adding named capture suites, grouped validation reports, deterministic redaction, and generated Vitest regression tests.

## Highlights

- `validate --suite <name>` validates configured capture suites without repeating file globs in package scripts.
- Validation JSON reports now include optional `validation.suites`, `validation.files`, and `validation.contracts` metadata.
- `redact` applies configured redaction paths to captured JSON files.
- `redact --check` fails when configured redaction would change committed captures.
- `generate-tests` writes a plain TypeScript/Vitest regression test from configured capture suites.
- The example project demonstrates the capture-to-test workflow.

## Compatibility

- Existing v0.1 configs remain valid.
- Existing `validate <files...>` usage remains valid.
- Report `schemaVersion` remains `1`; new report sections are optional.
- Redaction is deterministic replacement, not automatic sensitive-data discovery.
- Generated tests target Vitest and use public package APIs.

## Verification

Release verification should pass with:

```sh
npm run verify:release
```

This includes linting, formatting, typecheck, tests, build, `pkg-guard`, `npm pack --dry-run`, and the packed-package smoke test.
