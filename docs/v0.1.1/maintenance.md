# v0.1.1 Maintenance Patch

## Goal

`v0.1.1` is a maintenance-only patch after the `v0.1.0` MVP release. It should not add product behavior or change public APIs.

## Scope

- Upgrade `pkg-guard` to exercise its workflow script-expansion improvement in a real consumer.
- Keep `tool-call-contract` release verification wired through `pkg-guard`.
- Stabilize the end-to-end example test so parallel release checks cannot mutate the shared `examples/basic` fixture at the same time.
- Confirm the GitHub Pages deployment remains outside the npm package surface.

## Rationale

The first release sprint proved the package can be built, packed, installed, and used from a temporary project. The only patch-level issue found afterward was test isolation: the e2e test generated artifacts inside the checked-in example directory. That is fine for single-process local runs, but concurrent verification can collide on `.tool-call-contract` output.

The fix is to treat `examples/basic` as immutable fixture input and copy it into a temporary project before running `check`, `generate`, and `validate`.

## Acceptance Criteria

- `examples/basic` remains clean after tests.
- `test/e2e.test.ts` runs against a temporary copy of the example.
- `pkg-guard` is upgraded in `package.json` and `package-lock.json`.
- `npm run verify:release` passes.
- `npm publish --dry-run --auth-type=web` passes.
