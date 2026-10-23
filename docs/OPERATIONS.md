# Operations

Install, verify, test live, troubleshoot and roll back the `context-pilot`
Mod. Behaviour is specified in [ARCHITECTURE.md](ARCHITECTURE.md); options in
[CONFIGURATION.md](CONFIGURATION.md).

## 1. Gates before any install

```bash
pnpm install --frozen-lockfile
pnpm test:ci                 # sync, build, check, architecture audit, coverage
pnpm verify:package          # tarballs, exports, plugin manifest/version contract
pnpm validate:plugin         # claude plugin validate --strict
pnpm test:plugin             # claude plugin test (official Mod harness)
pnpm smoke:plugin            # /context-pilot status through claude -p
```

`claude plugin test` runs the built `dist/register.js` against the engine's
own test kit. It needs no sign-in and no network.

## 2. Install

| Path                        | Command                                                                                                        | Notes                                                                             |
| :-------------------------- | :------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| Session only (development)  | `claude --plugin-dir packages/claude-code`                                                                     | Loads in place. `/reload-plugins` after `pnpm build`.                             |
| Local marketplace           | `claude plugin marketplace add ./` then `claude plugin install context-pilot@intelligent-compact --scope user` | The marketplace entry is a relative folder, so the working copy is read in place. |
| Apps without `--plugin-dir` | `CLAUDE_CODE_PLUGIN_DIRS="$PWD/packages/claude-code"`                                                          | Process env or the `env` block of `~/.claude/settings.json`.                      |

To configure, use `/plugin` → context-pilot → Configure options, or
`claude plugin configure context-pilot@intelligent-compact --values-stdin`.
Options live in settings under `pluginConfigs["<plugin>"].options`. For a
`--plugin-dir` load the key is `context-pilot@inline`. A stored registry with
`schemaVersion: 1` fails at load: re-save it in schema v2.

### Migrating a stored 0.x registry

A 0.x install keeps its `schemaVersion: 1` registry in settings. Under 1.0.0
the Mod then refuses to load: `/context-pilot` is missing and the debug log
names the schema error. Re-save the shipped v2 registry, then reload:

```bash
node -e 'const r=require("./packages/claude-code/config/policy-registry.example.json");process.stdout.write(JSON.stringify({policy_registry_json:JSON.stringify(r)}))' \
  | claude plugin configure context-pilot@intelligent-compact --values-stdin
```

Then run `/reload-plugins`, or restart the session.

## 3. Verify an install

```bash
claude plugin list                       # context-pilot enabled, version 1.0.0
claude -p "/context-pilot status"        # status · balanced · … · OBSERVE (headless)
```

In an interactive session (terminal, Desktop local Code session, or VS
Code):

1. Run `/plugin` → Installed and check that context-pilot is enabled.
2. Check that the `◆ context-pilot …` band shows above the prompt with
   **AUTO**.
3. Run `/context-pilot`: the dashboard shows the context gauge (arm,
   mandatory and host autocompact ticks), then Decision, Policy and Activity.

## 4. Live end-to-end test (low-cost model)

Use a disposable session and a staging policy with low token thresholds. The
procedure used for the V1 release is recorded in
`.trace/intelligent-compact-v1/live-v1/` (its `settings.json` and
`interactive.exp`):

1. Write a settings file that disables any installed copy
   (`enabledPlugins["context-pilot@intelligent-compact"] = false`). In it,
   set `pluginConfigs["context-pilot@inline"].options.policy_registry_json`
   to a token-unit policy. Use `arm` just above the first-turn fill (for
   example 30k) and `mandatory` a few file reads above it (for example 70k).
2. Drive an interactive session with
   `claude --model haiku --plugin-dir packages/claude-code --settings <file> --debug-file <log>`:
    - plant a fact;
    - read a few files so the fill crosses `arm` and `mandatory`;
    - run `/context-pilot evaluate`;
    - run `/compact <text>`;
    - ask for the fact again.
3. Read the evidence:
    - The debug log shows `$.model.fork (context-pilot)` lines (probes and
      the directive fork), `$.session.compact (context-pilot): compacting, N
      chars of instructions`, and the `session.compact` hook settling on the
      manual `/compact`.
    - The `$.ui.toast` lines show `Context Pilot compacted at …`.
    - The plugin store's `telemetry` record holds counters and compaction
      records.

Headless runs (`claude -p`) cannot run plugin compaction, so they only show
the OBSERVE behaviour: no automatic fork.

## 5. Troubleshooting

| Symptom                                      | Check                                                                                                                                                                 |
| :------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mod does not load                            | `claude plugin validate packages/claude-code --strict`. Look for `context-pilot` in `claude --debug-file ./mod.log --plugin-dir packages/claude-code`.                |
| A hook seems to do nothing                   | Look for `hook skipped` in the debug log. `session.compact` falls back to the unchanged native compaction. `command.run` answers `context-pilot: command failed (…)`. |
| Band says OBSERVE                            | The session is headless. That is expected.                                                                                                                            |
| Band says MANUAL                             | `auto_enabled=false`. Use `/context-pilot evaluate` (dry run) or `/context-pilot compact`.                                                                            |
| Warning card about the host autocompact      | The host threshold is below `mandatory + hostHeadroom`. Lower `mandatory`, or raise the host's autocompact threshold.                                                 |
| "Probe budget spent" or "Probing suspended"  | Expected cost guards. The controller holds to `mandatory` until the next compaction.                                                                                  |
| "Below progress guard" at or above mandatory | The last compaction left more than `mandatory − minProgress`. The host autocompact is the failsafe. Review `baseInstructions` (summary size).                         |
| A saved setting seems not to apply           | Look for `context-pilot: options changed — reloaded` in the transcript. A session started before the plugin was rebuilt needs `/reload-plugins` first.                |
| Installed copy is stale                      | Installed marketplace plugins may be cached by version. Use `--plugin-dir`, or bump the version and update.                                                           |

## 6. Rollback and emergency disable

- **Stop automatic action:** set `auto_enabled=false`. Native-compaction
  injection continues. Set `injectNative: false` in the policy to stop that
  too.
- **Disable the plugin:** `claude plugin disable context-pilot@intelligent-compact`,
  or start with `--safe-mode` / `--bare`.
- **Bad registry:** revert with `claude plugin configure …`. Invalid JSON or
  invalid ordering fails loudly at load, and there is no hidden fallback.

## 7. Host types

`packages/claude-code/host-types/claude-code.d.ts` is the engine-generated
declaration file (first line: `// Written by Claude Code <version>`). Never
edit it. To refresh it after a Claude Code update:

1. Load the Mod once in an interactive `--plugin-dir` session. The engine lays
   `.claude-plugin/types/claude-code/index.d.ts` beside it.
2. Run `pnpm sync:host-types` (or pass a path to an engine-written file).
3. Run all gates in §1.
