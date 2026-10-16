# Releasing 0.1.0

Version 0.1.0 was published to npm on 16 October 2026 from tag `v0.1.0` (commit `9c64a49`). The steps below record the release procedure. See [VALIDATION.md](VALIDATION.md) for the verified scope and known limitations.

## Verify the candidate

Use Node 24+, installed Google Chrome, and a native WebGPU device. From a clean checkout:

```sh
npm ci
npm run check
npm run test:browser
npm run test:packed
npm run format:check
npm audit --omit=dev
npm publish --dry-run
```

For the built-site check, run `npm run preview:site` in another terminal, then `npm run test:site`. The browser suite starts development servers when they are not already running. Tests require loopback sockets; unsupported GPU tests must not be silently skipped.

Verify the public deployment after pushing `main`: `/`, `/guide`, `/api`, `/saving`, `/demo/`, `/favicon.ico`, and `/studio.png` should load. Vercel builds `site/` with `npm run build:site`; `vercel.json` enables extensionless documentation routes.

## Publish when approved

1. Confirm the tested commit is clean and tagged `v0.1.0`, the package version is `0.1.0`, and `npm whoami` is the intended publisher (`niko.dellic`).
2. Confirm the package name is still available. Authentication and dry-run validation do not guarantee first-publication permission.
3. Run `npm publish --access public` from that checkout and complete any registry authentication prompt locally. Never put tokens into the repository.
4. Verify `npm view three-recording-studio@0.1.0 version dist.integrity` and install the registry package in a fresh consumer. Check the core, UI, stylesheet and receiver executable; install optional dependencies to check MP4 encoding.
5. Remove the pending-publication note from the README/guide, date the 0.1.0 release notes, and create a GitHub release pointing to the tested tag. Record the registry integrity and the publication result.

Publishing is deliberately separate from `prepack`: packing builds the library but does not upload it. The archive excludes development frameworks, demo sources and documentation tooling. The MP4 entry point requires the optional Mediabunny dependency; PNG users can install with `--omit=optional`.
