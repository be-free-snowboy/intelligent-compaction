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
pnpm test:coverage
pnpm verify:package
pnpm audit --prod --audit-level=high
```

## Commit Convention

Follow the Conventional Commits rules in [`asset/commit.md`](./asset/commit.md).

## Package Changes

- Keep package exports root-only unless a public subpath is explicitly approved.
- Update `packages/pkg/package.json` and the consumer verification script together.
- Run `pnpm verify:package` after changing build output, exports, or package metadata.
