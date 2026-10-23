import { describe, expect, it } from 'vitest'
import { SESSION_CARRY_VERSION, type SessionCarry } from '../domain/state'
import {
    FakeRuntime,
    compact,
    controllerOf,
    turn,
    wait,
} from './support/fixtures'

/** A session past one compaction, with a probe in the next cycle. */
async function lived() {
    const controller = controllerOf()
    const runtime = new FakeRuntime()
    runtime.tokens = 100_000
    await controller.initialize(runtime)
    runtime.replies.push(compact('keep A', 'green'))
    await turn(controller, runtime, 300_000)
    await turn(controller, runtime, 40_000)
    await turn(controller, runtime, 60_000)
    runtime.replies.push(wait(360_000))
    await turn(controller, runtime, 320_000)
    return { controller, runtime }
}

function reloaded(carry: unknown) {
    const controller = controllerOf()
    const runtime = new FakeRuntime()
    runtime.tokens = 320_000
    return {
        controller,
        runtime,
        resumed: controller.initialize(runtime, carry),
    }
}

const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe('session carry', () => {
    it('takes up the whole control state in a fresh controller', async () => {
        const { controller } = await lived()
        const carry = asJson(controller.carry())
        const next = reloaded(carry)

        expect(await next.resumed).toBe(true)
        const before = controller.snapshot
        const after = next.controller.snapshot
        expect(after.turn).toBe(before.turn)
        expect(after.cycle).toEqual(before.cycle)
        expect(after.lastDecision).toBe(before.lastDecision)
        expect(after.nextProbeAt).toBe(before.nextProbeAt)
        expect(after.compactions).toBe(1)
        expect(after.growth.snapshot()).toEqual(before.growth.snapshot())
        expect(after.forkUsage).toEqual(before.forkUsage)
        expect(after.mode).toBe('idle')
        expect(asJson(after.telemetry.toSessionData())).toEqual(
            asJson(before.telemetry.toSessionData())
        )
        expect(next.controller.carry()).toEqual(carry)
    })

    it('keeps an open growth span bound to its compaction record', async () => {
        const { controller, runtime } = await lived()
        const next = reloaded(asJson(controller.carry()))
        await next.resumed

        expect(controller.carry()?.telemetry.spans).toHaveLength(1)
        // The span's third delta closes it on the record it was opened for.
        await turn(controller, runtime, 340_000)
        await turn(next.controller, next.runtime, 340_000)
        const records = next.controller.snapshot.telemetry.lastCompactions(2)
        expect(records).toEqual(
            controller.snapshot.telemetry.lastCompactions(2)
        )
        expect(records[0]?.growthAfter).toBe(300_000)
    })

    it.each([
        ['nothing', undefined],
        ['a cleared carry', null],
        ['another session', { sessionId: 'another' }],
        ['another version', { version: SESSION_CARRY_VERSION + 1 }],
        ['a broken cycle', { cycle: { probes: -1 } }],
        ['broken telemetry', { telemetry: { counters: {} } }],
    ])('starts fresh from %s', async (_name, change) => {
        const { controller } = await lived()
        const carry =
            change === undefined || change === null
                ? change
                : { ...(asJson(controller.carry()) as SessionCarry), ...change }
        const next = reloaded(carry)

        expect(await next.resumed).toBe(false)
        expect(next.controller.snapshot.turn).toBe(0)
        expect(next.controller.snapshot.lastDecision).toBe('Not evaluated')
        expect(next.controller.snapshot.telemetry.session.probes).toBe(0)
    })

    it('has nothing to carry before the session starts', () => {
        expect(controllerOf().carry()).toBeUndefined()
    })
})

describe('observed context', () => {
    it('reports a change once and resolves the policy for the window', async () => {
        const controller = controllerOf()
        const reading = { tokens: 200_000, window: 1_000_000, percent: 20 }

        expect(controller.observeContext(reading)).toBe(true)
        expect(controller.snapshot.context).toMatchObject(reading)
        expect(controller.snapshot.resolvedPolicy?.arm).toBe(300_000)
        expect(controller.observeContext(reading)).toBe(false)
    })

    it('keeps the host autocompact details of the last full read', async () => {
        const controller = controllerOf()
        const runtime = new FakeRuntime()
        runtime.context = {
            tokens: 100_000,
            window: 1_000_000,
            hostAutoCompactThreshold: 900_000,
        }
        await controller.initialize(runtime)
        controller.observeContext({ tokens: 150_000, window: 1_000_000 })
        expect(controller.snapshot.context).toMatchObject({
            tokens: 150_000,
            hostAutoCompactThreshold: 900_000,
        })
    })

    it('reports a window the policy does not fit', () => {
        const controller = controllerOf()
        expect(controller.observeContext({ window: 200_000 })).toBe(true)
        expect(controller.snapshot.lastError).toMatch(/mandatory/)
    })
})
