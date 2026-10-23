# Architecture (V1)

This document is the single authority for how `intelligent-compact` decides,
bounds and executes compaction. [CONFIGURATION.md](CONFIGURATION.md) is the
authority for the registry schema. [OPERATIONS.md](OPERATIONS.md) is the
authority for install, verification and rollback.

## 1. Strategy

Compaction trades context for cost. The controller has two levers. Each one has
a different job.

| Lever                | Job            | Mechanism                                                                                                                                                                                                                  |
| -------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Thresholds**       | Token saving   | `mandatory` keeps the main thread far below the host's own autocompact point. Per-turn cost is linear in context size, so this is where the saving comes from.                                                             |
| **Semantic probing** | Output quality | Between `arm` and `mandatory`, an isolated fork of the main thread judges whether the end of this turn is a _seam_: a point where lossy summarization is safe. It also writes a preservation directive for the summarizer. |

Probing is a **bounded quality premium**, not a token optimization. It costs
tokens; V1 bounds that cost and switches probing off when it cannot be cheap:

- a per-cycle probe budget (`maxProbesPerCycle`);
- a growth-aware minimum probe gap;
- a cache guard that suspends probing when forks stop reading the main
  thread's prompt cache (`cacheFloor`);
- no automatic forks at all where the host cannot compact (headless sessions).

The host compactor always writes the canonical summary. The controller only
supplies _when_ and _what to preserve_.

## 2. Packages and boundaries

```text
packages/core          host-agnostic: domain, application, codec, editor state
packages/claude-code   Claude Code Mod adapter: ports, hooks, presentation, manifest
```

- Core imports no host, no Node API and no DOM API.
- Host capability access (`$`) exists only in `packages/claude-code/src/register.ts`.
- Policy values are deployment data (`plugin.json` default and
  `config/policy-registry.example.json`, which must be identical). Runtime code
  never duplicates a configured token value.
- `scripts/architecture-audit.mjs` enforces these rules.
- Host types are the engine-generated declarations vendored in
  `packages/claude-code/host-types/claude-code.d.ts` (written by Claude Code 2.1.309).
  The file is regenerated with `pnpm sync:host-types`, never edited.

### Ports

```ts
interface RuntimePort {
    readContext(): Promise<ContextSnapshot>
    fork(prompt: string): Promise<ForkOutcome>
    compact(instructions: string): Promise<CompactResult>
    sessionId(): Promise<string>
    toast(message: string): Promise<void>
    invalidateUi(): Promise<void>
    saveTelemetry(data: TelemetryData): Promise<void>
}

type ForkOutcome =
    | { kind: 'answered'; text: string; usage: ForkUsage }
    | { kind: 'unavailable'; reason: ForkUnavailableReason; usage?: ForkUsage }

interface ConfigurationPort {
    saveRegistryJson(json: string): Promise<void>
    setAutoEnabled(enabled: boolean): Promise<void>
    setShowStatusBand(enabled: boolean): Promise<void>
}
```

`RuntimePort.saveTelemetry(data)` persists lifetime telemetry; the adapter
loads it at `session.start` (Claude Code: `$.store` key `telemetry`).

`ContextPilotController.carry()` returns the session's control state as JSON
(`SessionCarry`: turn, cycle, schedule, decision, growth and cache samples,
session telemetry). `initialize(runtime, carry)` takes it up when it names the
same session and validates; otherwise the session starts fresh. The context
fill is never carried: it is read again. `observeContext(reading)` takes a fill
the host pushed between the reads `refresh` makes.

The adapter maps `$.model.fork`'s `ModelForkResult` arms (`nothing-to-fork`,
`api-error`, `empty-reply`, `aborted`) to `ForkUnavailableReason`. It keeps the
usage that failure arms carry.

## 3. Host contract (Claude Code 2.1.309, verified live)

| Fact                                                                                                                                                                                                    | Evidence                                                                                                                                          | Consequence                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$.session.compact` from a main-thread `turn.complete` hook compacts in the interactive REPL.                                                                                                           | Live, Haiku: 41,447 → 8,601 tokens                                                                                                                | Automatic compaction runs at turn end.                                                                                                                                                                                                                                                                          |
| `$.session.compact` rejects in headless (`-p`, SDK) sessions.                                                                                                                                           | Live (`spike2`): "not available in a headless (-p / SDK) session yet"                                                                             | `session.start.isInteractive = false` turns automatic control off.                                                                                                                                                                                                                                              |
| No working headless fallback was found. `$.prompt.submit('/compact …')` is refused. `$.command.run({ command: 'compact' })` queued input, but no compaction ran before the host ended its input.        | Live (`spike3`, `spike4` debug log)                                                                                                               | No fallback is shipped. Headless sessions stay in OBSERVE.                                                                                                                                                                                                                                                      |
| `$.model.fork` always resolves a result. It never returns `null`.                                                                                                                                       | Official types                                                                                                                                    | `ForkOutcome`; usage kept on failure.                                                                                                                                                                                                                                                                           |
| `session.compact` input carries `instructions`. `next({...e, instructions})` changes what the summarizer is told.                                                                                       | Official types                                                                                                                                    | Policy instructions are injected into `auto`, `manual` and `precompute` compactions.                                                                                                                                                                                                                            |
| A compaction's `tokensAfter` counts the transcript only, not the system prompt and tools. After any compaction, `$.session.usage().context.tokens` is absent until the next response.                   | Live V1 run (`live-v1/debug.log`, `store-telemetry.json`): reported 49k → 9k, next turn-end fill ≈48k                                             | Cycle and growth baselines come from the next measured turn-end fill, never from `tokensAfter`. `tokensAfter` is kept for telemetry.                                                                                                                                                                            |
| Forks are served from the main thread's prompt cache.                                                                                                                                                   | Live V1 runs: stored fork usage 320,032 cache-read vs 2,381 input + 564 write (≈99.1%; run 1, 7 logged forks, one mid-run reload); 93.4% in run 2 | The cost model's warm-fork assumption holds. The cache guard covers sessions where it does not.                                                                                                                                                                                                                 |
| The plugin's own `session.compact` hook runs nested for `trigger: 'plugin'`.                                                                                                                            | Live debug log                                                                                                                                    | The hook passes `plugin` through unchanged: instructions are composed once, by the caller.                                                                                                                                                                                                                      |
| `session.end` fires on `/clear` with no new `session.start`.                                                                                                                                            | Official types                                                                                                                                    | Every session-local value, controller-private ones included, resets on `session.end` before the telemetry save, so a failed save cannot keep it. Settings and host capability survive.                                                                                                                          |
| Saving an option (`$.config.set`, the `/config` menu) reloads the hooks module: `register` runs with the new options, then `session.start` runs again in the same session. Module variables start over. | Live debug log: `options changed — reloaded`, then `session.start: raised for context-pilot (loaded later)`                                       | The adapter keeps `controller.carry()` and the editor's place in `$.state` (`context-pilot`/`session`), written before every option write and after each state change, cleared at `session.end`. The reloaded copy takes it up, so a settings save keeps the session's cycle and decisions and applies at once. |
| `session.measure` fires at main-thread turn ends, not between the model calls of one turn.                                                                                                              | Live debug log: three tool calls in one turn, one `session.measure` at its end                                                                    | The adapter also reads the plain `$.session.usage()` (no breakdown, no API call) at each main-thread `tool.call`, so the band and dashboard follow the fill during long turns.                                                                                                                                  |

## 4. Control loop

Evaluation runs once per **main-thread** `turn.complete` with
`reason === 'answer'`. Subagent turns (`agentId` set), aborted turns, refusals
and errors are ignored. Operations are serialized.

A **cycle** is the span from one compaction (or session start) to the next.
Probe count, cache samples, the probe schedule and the pending attempt (with
its backoff) are per-cycle. Both the plugin's own compactions and observed host
compactions start a new cycle.

The steps below run in this order on each evaluation:

1. **Refresh.** Read the context (`tokens`, `window`, the host autocompact
   threshold and flag). Resolve the active policy against `window`. Recompute
   the host-headroom warning. Record growth:
   `delta = tokens − previous turn-end tokens`, only between two consecutive
   fresh, known readings with no compaction in between and `delta ≥ 0`. An
   unknown fill or a failed reading breaks the chain.
2. **Unknown fill.** If `tokens` is unknown, stop.
3. **Automation gate.** If AUTO is off, or the host cannot compact (headless),
   stop. Nothing forks and nothing compacts. MANUAL/OBSERVE state is shown.
4. **Progress guard.** If `tokens − cycleStart < minProgress`, stop.
   `cycleStart` is the fill measured at the first main-turn end after the last
   compaction (see §3: the host's own `tokensAfter` excludes the system prompt
   and tools). The guard is the one rule
   that outranks `mandatory`: it prevents back-to-back compactions that
   achieve nothing. The host's own autocompact remains the failsafe above it.
   Worked example: the first turn end after a compaction measures 450k,
   `mandatory` = 500k, and `minProgress` = 150k. At 500k nothing happens (`Below progress guard`). The
   next automatic compaction is allowed from 600k.
5. **Pending attempt.** An automatic compaction that skipped or threw leaves a
   _pending attempt_: `{ source, directive }`. The directive may be the empty
   string. The pending attempt then decides this step:
    - before its retry turn: stop;
    - on or after its retry turn: re-execute it with its own directive, and
      stop.

    A retry never forks. It does not depend on pressure, arm, the probe budget
    or the cache guard. The pending attempt is cleared when a compaction
    succeeds or a host compaction is observed (both open a new cycle).

6. **Pressure.** If `tokens ≥ mandatory`, or `tokens + p90Δ ≥ mandatory`
   (_pre-mandatory_, at least 3 growth samples), compact now:
    - directive = one mandatory-directive fork when `forkOnMandatory`, else
      none;
    - source = `mandatory` or `pre-mandatory`.
7. **Arm.** If `tokens < arm`, set the next probe to `arm` and stop.
8. **Probe gates.** Stop if any of these holds:
    - the probe budget is spent (`probes ≥ maxProbesPerCycle`): hold to
      mandatory;
    - the cache guard is tripped: hold to mandatory;
    - `tokens < nextProbeAt`.
9. **Probe.** Compute the bounds:
    - `gap = min(maxGap, max(minGap, 3 · meanΔ))`; before 3 growth samples,
      `gap = minGap`;
    - `cap = max(tokens, mandatory − 2 · p90Δ)`; before 3 samples,
      `cap = mandatory`;
    - `lower = min(cap, tokens + gap)`;
    - `upper = min(cap, tokens + maxGap)`.

    The minimum gap is a promise only while the fill is more than two p90 turns
    below `mandatory`. Inside that zone `cap = tokens`, so the next probe is
    due at the next main turn: one last seam check before pre-mandatory
    pressure. The probe budget still bounds it. Example: `tokens` = 400k,
    `meanΔ` = `p90Δ` = 60k, `mandatory` = 500k. Then `cap` = max(400k, 380k) =
    400k, and `lower` = `upper` = 400k. The next turn, at ≥ 460k, is pressure.

    Fork the decision prompt. When the answer arrives, discard it if AUTO was
    switched off, the host lost the ability to compact, or a compaction ended
    the cycle while the fork ran. The same check runs after a pressure
    directive fork. Otherwise act on the outcome:

    | Outcome     | Effect                                                                                  |
    | ----------- | --------------------------------------------------------------------------------------- |
    | Unavailable | Next probe at `upper`. Counts toward the budget unless the reason is `nothing-to-fork`. |
    | Unparseable | Next probe at `upper`. Parse-failure counter +1. Counts toward the budget.              |
    | `WAIT n`    | Next probe = `clamp(n, lower, upper)`.                                                  |
    | `COMPACT i` | Compact now (source `semantic`) with directive `i`.                                     |

### Cache guard

Each answered fork yields a sample:
`cacheRead / (input + cacheRead + cacheWrite)`. The guard keeps the last 3
probe samples of the cycle. Once 2 or more samples exist, it trips when their
mean is below `cacheFloor`. A tripped guard suspends probing for the rest of
the cycle. The single mandatory-directive fork still runs, because it is one
call per cycle and the most valuable one.

### Compaction execution and backoff

Instructions are composed by the core `InstructionComposer`, in this order:

1. user text (manual `/compact` only);
2. `baseInstructions`;
3. `Preservation directive: <directive>`.

The directive keeps the most important items first. When it is cut to
`directiveMaxChars`, it is cut back to the last `; ` boundary.

After the call:

- **Success:** record `before`/`after`, reset the cycle (which clears the
  pending attempt), save telemetry, and toast. A failure of the toast or the
  save is reported as an error and never turns the standing compaction into a
  pending attempt.
- **Skip or throw:**
    - store or keep the pending attempt `{ source, directive }`;
    - `failures + 1`;
    - retry no earlier than `min(2^(failures−1), 8)` main turns later
      (step 5).

    Manual compactions (`/context-pilot compact`) report a failure without a
    pending attempt.

### Manual operations

| Command                   | Behaviour                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/context-pilot evaluate` | **Dry run.** Forks one decision prompt (ignores arm, budget and cache guard), shows WAIT/COMPACT with reason and directive, executes nothing, and changes neither the schedule nor the budget. |
| `/context-pilot compact`  | Compacts now in any mode. Uses one mandatory-directive fork when `forkOnMandatory`. In headless sessions it reports that the host cannot compact.                                              |

### Native compaction injection

When `injectNative` is on, the adapter's `session.compact` hook rewrites the
`instructions` of main-thread `auto`, `manual` and `precompute` compactions.
The composed text is: user text (if any), `baseInstructions`, and the pending
attempt's directive (if any). It leaves `plugin`-triggered compactions and subagent
compactions (`agentId` set) unchanged. An observed `auto` or `manual`
compaction starts a new cycle.

## 5. Growth model

- The tracker keeps the last 20 main-turn deltas (§4 step 1 defines which
  readings count).
- `meanΔ` and `p90Δ` are defined once 3 samples exist.
- After each compaction, the tracker sums the next 3 turn deltas into that
  compaction's `growthAfter` field. Overlapping windows (a second compaction
  within 3 turns) are tracked separately. This is a re-read/reconstruction proxy for
  judging seam quality.

## 6. Telemetry

Telemetry exists to tune defaults from data. It never steers the control loop
automatically.

- **Session counters:** probes, waits, compacts, parse failures, unavailable
  forks, budget exhaustions, cache-guard trips, backoffs, a reason histogram,
  and fork usage totals.
- **Decision log:** the last 50 decisions. Each entry has tokens, action,
  reason, the cache sample and the fork cost.
- **Persisted** through `RuntimePort.saveTelemetry` (`$.store` key `telemetry`): cumulative
  counters, plus the last 100 compaction records (`source`, `before`, `after`,
  `probes`, cycle fork usage, `growthAfter`). It is saved after every compaction
  and at session end. Unknown or corrupt stored data is replaced, never
  migrated.

## 7. Invariants

1. No automatic fork or compaction when AUTO is off or the host cannot compact.
2. Automatic probes per cycle ≤ `maxProbesPerCycle`.
3. At most one directive fork per compaction attempt; retries of a pending
   attempt never fork.
4. No automatic compaction below `arm` unless `tokens + p90Δ ≥ mandatory`.
5. No automatic compaction before `minProgress` tokens of growth since the last
   compaction, even at or above `mandatory` (the progress guard outranks it).
6. `/context-pilot evaluate` never compacts and never changes the schedule.
7. Policy ordering after resolution against the live window:
   `arm < mandatory ≤ window`, `minGap ≤ maxGap`, `minProgress < mandatory`.
   Violations fail loudly. A host autocompact threshold below
   `mandatory + hostHeadroom` is a visible warning.
8. Every value the fork returns is clamped (`n`) or truncated (`i`) before use.
