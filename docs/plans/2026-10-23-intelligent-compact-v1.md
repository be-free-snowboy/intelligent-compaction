# intelligent-compact V1 execution plan

## Final goal

Ship `intelligent-compact` V1 at release level. The release is a hard migration
to the single authority in [ARCHITECTURE.md](../ARCHITECTURE.md) and
[CONFIGURATION.md](../CONFIGURATION.md), with no legacy schema, shim types or
bridge code. Its behaviour is proven at three levels:

1. **Unit:** every core rule and invariant in ARCHITECTURE §4–§7.
2. **Integration:** the controller driven through fake ports over multi-turn
   sessions, the adapter mapping layer, and `claude plugin test` against the
   built Mod.
3. **E2E:** a live Claude Code session on a low-cost model (`haiku`), covering
   both interactive and headless paths.

## Task charter

- **Goal:** implement the V1 strategy (bounded semantic probing, growth-aware
  scheduling, cache guard, backoff, progress guard, dry-run evaluate, native
  instruction injection, headless gating, telemetry) on the engine's real
  contract.
- **Constraints:**
    - core stays host-agnostic;
    - `$` stays only in `register.ts`;
    - policy values stay as data;
    - every phase passes typecheck, lint/format, the architecture audit and
      tests before the next phase starts.
- **Non-goals:**
    - mid-turn (`turn.step`) control;
    - forking inside native compactions;
    - automatic tuning of thresholds from telemetry;
    - choosing the canonical repository URL (drift D14);
    - publishing to npm or a remote marketplace.
- **Accepted side effects:**
    - `schemaVersion` 1 registries are rejected (hard migration);
    - stored user `policy_registry_json` values must be re-saved in v2;
    - versions move to `1.0.0`.

## Boundary map

| Allowed                                                                                                         | Blocked                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/core/**`, `packages/claude-code/**` (except `dist/`, which is built only)                             | `.github/**` (only if a check name changes), lockfile churn beyond need |
| `docs/**`, `README.md`, `CONTRIBUTING.md`, package READMEs                                                      | `asset/**`, `LICENSE`, `SECURITY.md`                                    |
| `scripts/architecture-audit.mjs`, `scripts/verify-package.mjs`, root `package.json` scripts, `vitest.config.ts` | `.trace/context-pilot-0.3.0/**` (reference only)                        |
| `.changeset/*.md` (new V1 changeset)                                                                            |                                                                         |

## Phase plan

| Phase | Checkpoint | Objective                                                                                                                                                                                                       | Verification                                                                               | Rollback point           |
| ----: | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------ |
|     0 | CP0        | Authority docs: drift analysis, ARCHITECTURE.md, this plan, CONFIGURATION.md v2                                                                                                                                 | Drift matrix complete; docs consistent with live evidence                                  | Docs only                |
|     1 | CP1        | Host contract migration: vendored engine types replace the shim; `ForkOutcome`; adapter maps all fork arms; `session.start.isInteractive` captured                                                              | `ts:typecheck`, build, `claude plugin validate --strict`, existing tests updated and green | Shim restorable from git |
|     2 | CP2        | Core domain V1: schema v2 (codec + `PolicyDefinition` + resolve rules), `GrowthTracker`, `CacheGuard`, `InstructionComposer`, decision parser v2 (reason, `;`-boundary truncation), prompts v2, telemetry model | Vitest unit suites per rule; coverage ≥ thresholds                                         | Core-only diff           |
|     3 | CP3        | Controller V1: the loop of ARCHITECTURE §4 (gates, pressure, probe budget, backoff, progress guard, dry-run evaluate, cycle reset, external compaction, telemetry log)                                          | Vitest unit + multi-turn integration simulations asserting all §7 invariants               | Controller + tests       |
|     4 | CP4        | Adapter V1: `register.ts` (injection hook, telemetry store, headless gate, `.catch`), view/editor/help for schema v2, manifest defaults + example registry, audit script                                        | `claude plugin test` (new e2e harness cases), validate, audit, `verify:package`            | Adapter-only diff        |
|     5 | CP5        | Live E2E on `haiku` + release: interactive probe/compact/injection run, headless gating run, docs (README, OPERATIONS, package READMEs), version 1.0.0 + changeset, final review/cleanup                        | Live transcripts and debug logs; `pnpm test:ci`; final rubric                              | Docs/version only        |

## Checkpoint protocol

- After each phase, the implementer writes a self-judgment to
  `.trace/intelligent-compact-v1/cp{N}_{part}.md`, using
  `judging-checkpoint-completion`.
- The Chief Justice (Codex `gpt-6.1-sol`, xhigh, read-only) judges it in the
  background. Its verdict goes to `cp{N}_{part}_trial_result.md` as FIX
  directives.
- The next phase starts without waiting for the verdict. A FAIL adds its
  defects to the next checkpoint's inventory, so they are re-judged together.
- `.trace/intelligent-compact-v1/todo.md` is the execution checker.

## Assumptions and failure modes

| #   | Assumption                                                                                                                      | If it fails                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A1  | The vendored 2.1.309 types type-check under TypeScript 7 with the build tsconfig.                                               | Adjust tsconfig `lib`/`types`. Never edit the vendored file.        |
| A2  | `claude plugin test` can mock `model.fork` arms and `session.compact` results through `on(...)` stubs, as the current tests do. | Cover that part in the adapter mapping unit tests.                  |
| A3  | A live interactive run can be driven with `expect`.                                                                             | Fall back to the headless run plus the harness, and report the gap. |
