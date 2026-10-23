# @intelligent-compact/claude-code

## 1.0.0

### Major Changes

- V1 Claude Code Mod (`context-pilot` 1.0.0). Hard migration: no compatibility with 0.x.
    - Built against the engine-generated Claude Code 2.1.309 types (`host-types/`). The hand-written shim is gone.
    - Native compaction injection: `session.compact` with `trigger` `auto`, `manual` or `precompute` on the main thread receives the policy instructions. A typed `/compact` text goes first.
    - OBSERVE mode for headless sessions (`claude -p`, SDK), where plugin compaction is unavailable: no automatic forks.
    - Lifetime telemetry is persisted in the plugin store (key `telemetry`). It is loaded at session start and saved after compactions and at session end.
    - Both gating hooks have `.catch` fallbacks:
        - `session.compact` falls through to the unchanged compaction;
        - `command.run` answers with the failure.
    - Redesigned terminal UI that follows the user's Claude Code theme (theme keys, no fixed ANSI colors):
        - status band: one line fitted to its width, dropping the least important parts first (fill meter, `next`, `probes`, AUTO / MANUAL / OBSERVE, alerts);
        - dashboard: a context gauge with arm, mandatory and host autocompact ticks, then next probe, growth, cycle, progress, Decision, Policy and Activity (fork cache rate, counts, recent compactions with savings);
        - warnings when the host autocompact can pre-empt `mandatory`, and pending retries, as callouts;
        - settings: a compact policy form, a JSON tab with live validation, and a help tab with a highlighted schema.
    - Settings apply live. Claude Code reloads the plugin when an option is saved; the session's control state (cycle, probes, schedule, decisions, growth, session telemetry) and the editor's place are carried across the reload in `$.state` (`types/index.d.ts`), so nothing resets. A save shows a `✓ Saved` notice.
    - The context fill follows long turns: besides `session.measure` at turn ends, each main-thread `tool.call` re-reads the plain `$.session.usage()`.
    - `/context-pilot config` and `/context-pilot help` open the settings pane alone, so it takes the keyboard focus.
    - Presentation split into `theme`, `gauge`, `primitives`, `band`, `dashboard`, `settings` and a routing `view`.
    - Shipped registry: schema v2 with `balanced` (default), `economy` and `small-window`.
