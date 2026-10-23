# intelligent-compact

Policy-driven, cost-bounded semantic compaction for coding agents.

`intelligent-compact` decides **when** a long agent conversation should be
compacted and **what the summary must not lose**. The host's own compactor
still writes the summary. The controller is host-agnostic; each agent host
gets an adapter. V1 ships the Claude Code adapter as the `context-pilot` Mod.

## How it works

The controller pulls two levers, and each has its own job:

- **Thresholds save tokens.** Each main-thread turn costs roughly in
  proportion to the context it carries. Compacting at `mandatory`, far below
  the host's own autocompact point, is what lowers the bill.
- **Semantic probes protect quality.** Between `arm` and `mandatory`, an
  isolated fork of the conversation judges whether this turn's end is a
  _seam_: a finished task, green tests, an accepted plan, or a topic switch.
  It also writes a short preservation directive for the summarizer.

Probing is a bounded quality premium, not a free saving. V1 bounds it in four
ways:

- a probe budget per compaction cycle;
- growth-aware probe spacing;
- a cache guard that stops probing when forks miss the prompt cache;
- no automatic forks at all in headless sessions, where the host cannot
  compact.

The full specification is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```text
turn ends ─► below arm ─────────────────► nothing
          ─► arm … mandatory ───────────► probe (budgeted) ─► WAIT n │ COMPACT + directive
          ─► mandatory, or one p90 turn
             before it ─────────────────► one directive fork ─► compact
          ─► failed compaction ─────────► retry after 1, 2, 4, 8 turns, never re-forking
host /compact, autocompact ─────────────► policy instructions injected
```

## Structure

- `packages/core/`: host-agnostic policy domain, controller, codec and runtime
  ports.
- `packages/claude-code/`: the Claude Code Mod adapter, its UI, its plugin
  manifest, and the vendored engine types.
- `docs/`: [ARCHITECTURE](docs/ARCHITECTURE.md),
  [CONFIGURATION](docs/CONFIGURATION.md), [OPERATIONS](docs/OPERATIONS.md).

Future adapters (`codex`, `opencode`, …) implement the same `RuntimePort` and
`ConfigurationPort` contracts in their own packages.

## Requirements

- Node.js `^22.18.0 || ^24.11.0 || >=26.0.0` (`.nvmrc` pins 24.19.0)
- pnpm `10.20.0`
- Claude Code 2.1.309 or later for the Mod. Its types are vendored from that
  build.

## Getting started

```bash
pnpm install
pnpm build
claude --plugin-dir packages/claude-code
```

Inside Claude Code:

```text
/context-pilot            dashboard
/context-pilot config     guided policy editor
/context-pilot help       registry schema and field meanings
/context-pilot status     one-line status
/context-pilot evaluate   dry run: WAIT/COMPACT, reason, directive; executes nothing
/context-pilot compact    compact now with a preservation directive
```

The status band above the prompt fits itself to the terminal width:

```text
◆ context-pilot balanced  ▰▰▰▱▱▱▱▱ 41% · 412k/1.00M · next 430k · probes 2/5 · ● AUTO
```

- the active policy and a fill meter toned by zone (below arm, between arm
  and mandatory, past mandatory);
- the next probe point and the probes spent this cycle;
- `◐ probing` or `◑ compacting` while the controller works;
- the automation mode: **AUTO**, **MANUAL** (`auto_enabled=false`), or
  **OBSERVE** (a headless session), plus `⚠ warn` or `✖ error`.

`/context-pilot` opens the dashboard: a context gauge with the arm,
mandatory and host autocompact points marked, the last decision and its
preservation directive, the policy, and activity (fork cache rate, counts,
recent compactions with their savings). All colors come from your Claude
Code theme.

Persistent install, verification on terminal/Desktop/VS Code, the live
end-to-end procedure, and rollback are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Configuration

There are three plugin options: `auto_enabled`, `show_status_band` and
`policy_registry_json`. The registry is schema v2, with three shipped
policies: `balanced` (default), `economy` and `small-window`. See
[docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Development

| Command                     | Description                                                |
| :-------------------------- | :--------------------------------------------------------- |
| `pnpm build`                | Build all packages with Turbo caching.                     |
| `pnpm test`                 | Vitest in watch mode.                                      |
| `pnpm test:coverage`        | Vitest once with coverage thresholds.                      |
| `pnpm test:plugin`          | Official `claude plugin test` Mod harness (no network).    |
| `pnpm validate:plugin`      | `claude plugin validate --strict` on the built Mod.        |
| `pnpm validate:marketplace` | Validate the local marketplace manifest.                   |
| `pnpm smoke:plugin`         | `/context-pilot status` through `claude -p`.               |
| `pnpm ts:typecheck`         | Type-check every package.                                  |
| `pnpm check`                | Oxlint and Oxfmt check.                                    |
| `pnpm check:architecture`   | Core/adapter boundaries and policy-as-data rules.          |
| `pnpm verify:package`       | Build, tarballs, and packed-consumer contracts.            |
| `pnpm sync:host-types`      | Refresh the vendored Claude Code types from a newer build. |
| `pnpm test:ci`              | The CI gate.                                               |

## Packages

| Package                            | Version | Description                               |
| :--------------------------------- | :------ | :---------------------------------------- |
| `@intelligent-compact/core`        | 1.0.0   | Host-agnostic policy and control engine   |
| `@intelligent-compact/claude-code` | 1.0.0   | Claude Code Mod adapter and plugin assets |

Releases use [Changesets](https://github.com/changesets/changesets).
