# @intelligent-compact/core

## 1.0.0

### Major Changes

- V1 control loop (docs/ARCHITECTURE.md). Hard migration: no compatibility with 0.x.
    - Policy registry **schema v2**:
        - adds `hostHeadroom`, `maxProbesPerCycle`, `cacheFloor`, `minProgress` and `injectNative`;
        - removes `nativeFailsafe` and `forkFailureAction`;
        - rejects `schemaVersion: 1`.
    - Bounded semantic probing:
        - probe budget per cycle;
        - growth-aware gap and p90 cap;
        - cache guard on fork cache-read ratio;
        - pre-mandatory trigger.
    - Pending compaction attempts with turn backoff (1, 2, 4, max 8) that never re-fork. A progress guard outranks `mandatory`.
    - `evaluateNow` is a dry run. `compactNow` reports instead of failing where the host cannot compact.
    - `InstructionComposer` and `nativeInstructions()` let adapters inject policy instructions into host compactions.
    - `carry()` / `initialize(runtime, carry)` carry a session's control state across an adapter reload as validated JSON (`SessionCarry`); `observeContext()` takes fills the host pushes between turn ends. `PolicyEditorState.notice` reports the last save.
    - Telemetry:
        - session counters plus a reason histogram;
        - a bounded decision log;
        - lifetime records with per-compaction `growthAfter`, persisted via `RuntimePort.saveTelemetry`.
    - Ports:
        - `RuntimePort.fork` resolves `ForkOutcome` and never returns `null`;
        - `compact(instructions: string)`;
        - `saveTelemetry`.
    - The controller constructor takes `{ parser, scheduler, prompts, composer }` and `{ autoEnabled, hostCanCompact }`.
