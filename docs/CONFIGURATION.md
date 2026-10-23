# Configuration guide

`context-pilot` has three Claude Code `userConfig` fields. The policy
configuration is a single JSON string, so several named policies can live
together. The control loop these fields drive is defined in
[ARCHITECTURE.md](ARCHITECTURE.md).

## 1. The three settings

| Setting                | Type        | Default          | What it controls                                                                                                                                                                                                                                                            |
| :--------------------- | :---------- | :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto_enabled`         | boolean     | `true`           | **AUTO**: probes and compactions run automatically after main-thread turns. **MANUAL**: nothing forks or compacts automatically. `/context-pilot evaluate` (dry run) and `/context-pilot compact` still work, and native compactions still receive the policy instructions. |
| `show_status_band`     | boolean     | `true`           | The one-line status band above the prompt. The dashboard is still available with `/context-pilot`.                                                                                                                                                                          |
| `policy_registry_json` | JSON string | shipped registry | The complete policy registry (schema below).                                                                                                                                                                                                                                |

Edit them with `/context-pilot config`, `/context-pilot help`, or `/plugin` →
context-pilot → Configure options.

A saved change applies at once. Claude Code reloads the plugin with the new
values, and the session keeps its cycle, probes, decisions and counters; the
settings pane reopens on the policy you saved, with a `✓ Saved` notice.

Headless sessions (`claude -p`, the SDK) cannot run plugin compaction. There
the controller never forks or compacts automatically, whatever `auto_enabled`
says; it still measures and injects instructions into native compactions. The
band shows **OBSERVE** for such a session with `auto_enabled=true`; with
`auto_enabled=false` it shows **MANUAL**, since the setting already stops
automatic work.

## 2. Registry shape

```json
{
    "schemaVersion": 2,
    "activePolicyId": "balanced",
    "policies": [
        {
            "id": "balanced",
            "label": "Balanced",
            "thresholds": {
                "arm": { "unit": "ratio", "value": 0.325 },
                "mandatory": { "unit": "ratio", "value": 0.5 },
                "hostHeadroom": { "unit": "ratio", "value": 0.1 }
            },
            "probe": {
                "minGap": { "unit": "tokens", "value": 15000 },
                "maxGap": { "unit": "tokens", "value": 50000 },
                "maxProbesPerCycle": 5,
                "cacheFloor": 0.7
            },
            "compaction": {
                "minProgress": { "unit": "ratio", "value": 0.15 },
                "directiveMaxChars": 1800,
                "forkOnMandatory": true,
                "injectNative": true,
                "baseInstructions": "…"
            }
        }
    ]
}
```

The shipped registry
([`packages/claude-code/config/policy-registry.example.json`](../packages/claude-code/config/policy-registry.example.json),
identical to the manifest default) contains three policies:

| id                  | arm / mandatory           | Use                                                     |
| :------------------ | :------------------------ | :------------------------------------------------------ |
| `balanced` (active) | 0.325 / 0.5 of the window | Default for 1M-token windows. Quality first.            |
| `economy`           | 0.2 / 0.4                 | Lower main-thread cost. More frequent compaction.       |
| `small-window`      | 0.5 / 0.7                 | ~200k windows, where ratio 0.5 would compact too early. |

## 3. Field reference

A **threshold** is `{ "unit": "tokens", "value": N }` (absolute, `N > 0`) or
`{ "unit": "ratio", "value": r }` (a fraction of the live context window,
`0 < r ≤ 1`).

### Top level

| Field            | Required | Meaning                                                             |
| :--------------- | :------- | :------------------------------------------------------------------ |
| `schemaVersion`  | yes      | Must be `2`. Version 1 registries are rejected. Re-save them in v2. |
| `activePolicyId` | yes      | The `id` of the policy that runs. It must exist in `policies`.      |
| `policies`       | yes      | One or more policies. Ids must be unique.                           |

### Policy

| Field        | Required | Meaning                                               |
| :----------- | :------- | :---------------------------------------------------- |
| `id`         | yes      | Stable identifier.                                    |
| `label`      | yes      | Name shown in the UI.                                 |
| `thresholds` | yes      | Context boundaries.                                   |
| `probe`      | yes      | Semantic-probe bounds and cost guards.                |
| `compaction` | yes      | What the compactor is told and when it may run again. |

### `thresholds`

| Field          | Meaning                                                                                                                                                                                                                                           |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `arm`          | Earliest fill at which semantic probes may run. Below it, nothing forks.                                                                                                                                                                          |
| `mandatory`    | Hard boundary in AUTO. Compaction runs here, or one turn earlier when the 90th-percentile turn growth would cross it. A probe cannot veto it. Only the progress guard (`minProgress`) outranks it.                                                |
| `hostHeadroom` | The minimum distance required between `mandatory` and the host's own autocompact threshold. If the host's threshold is lower than `mandatory + hostHeadroom`, the dashboard and status show a warning, because native autocompact may fire first. |

### `probe`

| Field               | Meaning                                                                                                                                                                                                                      |
| :------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minGap`            | Floor of the distance to the next probe. The effective floor is `max(minGap, 3 × mean turn growth)`, capped at `maxGap`.                                                                                                     |
| `maxGap`            | Ceiling of the distance to the next probe.                                                                                                                                                                                   |
| `maxProbesPerCycle` | Integer `0..100`: the most automatic probes between two compactions. When it is spent, the controller holds to `mandatory`. `0` gives static mode: no probes, compaction at `mandatory` only.                                |
| `cacheFloor`        | Number `0..1`. If the mean cache-read ratio of the last (up to 3) probes falls below it, probing is suspended until the next compaction. The ratio is cache-read tokens over all input tokens, and needs at least 2 samples. |

Before 3 turns of growth are known, the effective floor is `minGap` and the cap
is `mandatory`. The model's requested next probe is clamped into
`[tokens + gap, tokens + maxGap]`. That range is capped at
`mandatory − 2 × p90 turn growth`, never below the current fill. Within two
p90 turns of `mandatory`, the next probe is therefore due at the next turn.

### `compaction`

| Field               | Meaning                                                                                                                    |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------- |
| `minProgress`       | Context growth required since the last compaction before an automatic compaction may run again.                            |
| `directiveMaxChars` | Integer `1..8000`: the most characters kept from a fork's preservation directive. The cut falls on the last `; ` boundary. |
| `forkOnMandatory`   | Spend one fork at a forced compaction (`mandatory`, pre-mandatory, `/context-pilot compact`) to write the directive.       |
| `injectNative`      | Inject the policy instructions into the host's own `auto`, `manual` and `precompute` compactions.                          |
| `baseInstructions`  | Durable instructions always given to the compactor. They must not be empty.                                                |

### Ordering rules

These rules are checked against the live window. A violation fails loudly:

```text
arm < mandatory ≤ window
minGap ≤ maxGap
minProgress < mandatory
```

## 4. Control flow

```text
main turn completes (reason = answer, no agentId)
  │
  ├─ fill unknown ─────────────────────────► stop
  ├─ MANUAL or headless ───────────────────► stop (no automatic fork)
  ├─ grown < minProgress since compaction ─► stop (outranks mandatory)
  ├─ pending failed attempt ───────────────► before retry turn: stop
  │                                          on retry turn: re-execute, no fork
  ├─ tokens ≥ mandatory
  │  or tokens + p90Δ ≥ mandatory ─────────► directive fork (once) → compact
  ├─ tokens < arm ─────────────────────────► next probe = arm
  ├─ budget spent / cache guard tripped ───► hold to mandatory
  ├─ tokens < next probe ──────────────────► stop
  └─ probe: fork → WAIT n  → next probe = clamp(n)
                 → COMPACT → compact with directive
```

An automatic compaction that is skipped or throws stays pending. It is retried
after 1, 2, 4, then at most 8 main turns, with its own directive (possibly
empty), and never forks again. It is cleared when a compaction succeeds or a
host compaction is observed.

## 5. Safety notes

- `mandatory` is destructive. Try a new policy in a disposable session with
  `auto_enabled=false`.
- `/context-pilot evaluate` is a dry run. It shows WAIT/COMPACT, the reason
  and the directive, and executes nothing.
- An invalid registry fails loudly at load. There is no hidden fallback policy.
