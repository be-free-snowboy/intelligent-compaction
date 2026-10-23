# Contributing

## Requirements

- Node.js `^22.18.0 || ^24.11.0 || >=26.0.0`
- pnpm `10.20.0`

## Setup

```bash
pnpm install
pnpm build
```

## Verification

Run the same checks as CI before opening a pull request:

```bash
pnpm ts:typecheck
pnpm check
pnpm check:architecture
pnpm test:coverage
pnpm verify:package
pnpm audit --prod --audit-level=high
```

## Commit Convention

Follow the Conventional Commits rules in [`asset/commit.md`](./asset/commit.md).

## Package Changes

- `packages/core` must stay host-agnostic. Do not import `claude-code` or any
  adapter package from core.
- Host capabilities (`$`) belong only in
  `packages/claude-code/src/register.ts`.
- Keep package exports root-only unless a public subpath is explicitly approved.
- Update the package manifest and `scripts/verify-package.mjs` together.
- Run `pnpm check:architecture` and `pnpm verify:package` after changing
  boundaries, build output, exports, or package metadata.

## Claude Code Mod checks

With Claude Code 2.1.309 or later installed (the vendored host types come from
that build; refresh them with `pnpm sync:host-types`, see
[docs/OPERATIONS.md](./docs/OPERATIONS.md) §7):

```bash
pnpm validate:plugin
pnpm validate:marketplace
pnpm test:plugin
pnpm smoke:plugin
```

`pnpm test:plugin` runs the official `claude plugin test` harness against the
built `dist/register.js`; it needs no session, sign-in, or network.
