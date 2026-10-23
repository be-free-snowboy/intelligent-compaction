# @intelligent-compact/claude-code

Claude Code Mod adapter (`context-pilot`) for `@intelligent-compact/core`.

The adapter implements the core ports with Claude Code host capabilities, and
injects policy instructions into native compactions. It renders the status
band, the dashboard and the policy editor. All `$` access is isolated in
`src/register.ts`. Host types are the engine-generated declarations in
`host-types/` (Claude Code 2.1.309).

## Install

```bash
pnpm build
claude --plugin-dir packages/claude-code          # session only
claude plugin marketplace add ./                  # or: local marketplace
claude plugin install context-pilot@intelligent-compact --scope user
```

Marketplace install line (remote repository):

```text
/plugin install context-pilot --marketplace be-free-snowboy/intelligent-compaction
```

`hooks/hooks.json` loads the built `dist/register.js`. Run `pnpm build` at the
repository root after changing the adapter or core.

## Commands

`/context-pilot` (dashboard), `config`, `help`, `status`, `evaluate` (dry
run), `compact`.

## Configuration

See [docs/CONFIGURATION.md](../../docs/CONFIGURATION.md). The shipped
registry (`config/policy-registry.example.json`) is identical to the manifest
default.

## Verify and test

```bash
claude plugin validate packages/claude-code --strict
claude plugin test packages/claude-code
claude -p "/context-pilot status" --plugin-dir packages/claude-code
```

Operations, the live test procedure and rollback are in
[docs/OPERATIONS.md](../../docs/OPERATIONS.md).
