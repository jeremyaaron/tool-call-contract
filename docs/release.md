# Release

## Local Verification

Run the release verification suite before publishing:

```sh
npm run verify:release
```

This runs lint, format, typecheck, tests, build, `pkg-guard`, `npm pack --dry-run`, and a temporary-project smoke test against the packed tarball.

## First npm Publication

The package must exist on npm before GitHub trusted publishing can be fully configured for ongoing releases.

For the first publication:

```sh
npm run verify:release
npm publish --auth-type=web
```

After the package exists, configure npm trusted publishing:

- Provider: GitHub Actions
- Repository: `jeremyaaron/tool-call-contract`
- Workflow filename: `release.yml`
- Trigger: `v*` Git tags

## Tagged Releases

After trusted publishing is configured, publish with a version tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The release workflow verifies the package, checks whether the current version is already published, and publishes only when the version is not present on npm.
