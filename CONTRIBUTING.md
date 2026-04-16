# Contributing to cache-mesh

Thanks for your interest in contributing! This guide covers the basics.

## Prerequisites

- **Node.js** >= 18
- **pnpm** (corepack: `corepack enable`)

## Setup

```bash
git clone https://github.com/ridakaddir/cache-mesh.git
cd cache-mesh
pnpm install
pnpm test       # 21 tests, all should pass
pnpm typecheck  # no errors
pnpm lint       # no errors
```

## Making changes

1. **Fork and branch** — create a feature branch off `main`.
2. **Write code** — keep it focused. One PR = one logical change.
3. **Lint** — run `pnpm lint:fix` before committing.
4. **Test** — add or update tests. Run `pnpm test` to confirm.
5. **Changeset** — run `pnpm changeset` and describe your change. This
   drives the changelog and version bump.
6. **Open a PR** — describe the *why*, not just the *what*.

## PR guidelines

- Keep PRs small and focused.
- If your change affects the public API, update the README.
- If adding a new config option, include a doc comment with the default.
- E2E tests go in `test/e2e.test.ts`; unit tests go next to the module.

## Commit messages

We don't enforce a strict format, but prefer:
- `feat: ...` for new features
- `fix: ...` for bug fixes
- `docs: ...` for documentation only
- `chore: ...` for tooling and config

## Reporting bugs

Open an issue on GitHub. Include:
- Node.js version
- How many pods / what discovery mode
- Minimal reproduction steps

## Security

See [SECURITY.md](./SECURITY.md) for how to report vulnerabilities.

## Code of conduct

This project follows the [Contributor Covenant v2.1](./CODE_OF_CONDUCT.md).
Be kind, be constructive.
