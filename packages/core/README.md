# @intelligent-compact/core

Host-agnostic semantic compaction controller.

The core owns the policy domain (registry schema v2), the V1 control loop,
probe scheduling, decision parsing, instruction composition, growth and cache
tracking, telemetry and runtime state. It does not depend on Claude Code,
Node.js, the DOM or any other agent runtime. Behaviour is specified in
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

## Usage

```ts
import {
    ContextPilotController,
    ContextPilotState,
    InstructionComposer,
    PolicyRegistryCodec,
    ProbeDecisionParser,
    ProbeScheduler,
    SemanticProbePromptFactory,
    type RuntimePort,
} from '@intelligent-compact/core'

declare const registryJson: string
const controller = new ContextPilotController(
    new PolicyRegistryCodec().parse(registryJson),
    new ContextPilotState(),
    {
        parser: new ProbeDecisionParser(),
        scheduler: new ProbeScheduler(),
        prompts: new SemanticProbePromptFactory(),
        composer: new InstructionComposer(),
    },
    { autoEnabled: true, hostCanCompact: true }
)

declare const runtime: RuntimePort
await controller.initialize(runtime)
await controller.onMainTurnComplete(runtime) // after every main-thread answer
const instructions = controller.nativeInstructions('user /compact text')
```

Host adapters implement `RuntimePort` (context, fork, compact, telemetry
persistence, UI invalidation) and `ConfigurationPort`, and own their
presentation layer.
