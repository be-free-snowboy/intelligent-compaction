import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
    POLICY_SCHEMA_VERSION,
    PolicyDefinition,
    PolicyRegistry,
    Threshold,
    type CompactionPolicy,
    type PolicyDefinitionData,
    type PolicyRegistryData,
    type PolicyThresholds,
    type ProbePolicy,
} from '../domain/policy'
import { PolicyRegistryCodec } from '../infrastructure/policy-codec'

const policyData: PolicyDefinitionData = {
    id: 'test',
    label: 'Test policy',
    thresholds: {
        arm: { unit: 'ratio', value: 0.3 },
        mandatory: { unit: 'ratio', value: 0.5 },
        hostHeadroom: { unit: 'ratio', value: 0.1 },
    },
    probe: {
        minGap: { unit: 'tokens', value: 5000 },
        maxGap: { unit: 'tokens', value: 50000 },
        maxProbesPerCycle: 5,
        cacheFloor: 0.7,
    },
    compaction: {
        minProgress: { unit: 'ratio', value: 0.15 },
        directiveMaxChars: 120,
        forkOnMandatory: true,
        injectNative: true,
        baseInstructions: 'Preserve task state.',
    },
}

function withProbe(patch: Partial<ProbePolicy>): PolicyDefinitionData {
    return { ...policyData, probe: { ...policyData.probe, ...patch } }
}

function withCompaction(
    patch: Partial<CompactionPolicy>
): PolicyDefinitionData {
    return {
        ...policyData,
        compaction: { ...policyData.compaction, ...patch },
    }
}

function withThresholds(
    patch: Partial<PolicyThresholds>
): PolicyDefinitionData {
    return {
        ...policyData,
        thresholds: { ...policyData.thresholds, ...patch },
    }
}

function registryOf(...policies: PolicyDefinitionData[]): PolicyRegistryData {
    return {
        schemaVersion: POLICY_SCHEMA_VERSION,
        activePolicyId: policies[0]?.id ?? '',
        policies,
    }
}

test('policy resolution is injected and context-window aware', () => {
    const resolved = new PolicyDefinition(policyData).resolve(1_000_000)
    assert.deepEqual(resolved, {
        id: 'test',
        label: 'Test policy',
        arm: 300_000,
        mandatory: 500_000,
        hostHeadroom: 100_000,
        minGap: 5_000,
        maxGap: 50_000,
        maxProbesPerCycle: 5,
        cacheFloor: 0.7,
        minProgress: 150_000,
        directiveMaxChars: 120,
        forkOnMandatory: true,
        injectNative: true,
        baseInstructions: 'Preserve task state.',
    })
})

test('ratio thresholds scale with the live window while token thresholds do not', () => {
    const definition = new PolicyDefinition(policyData)
    const small = definition.resolve(200_000)
    assert.equal(small.arm, 60_000)
    assert.equal(small.mandatory, 100_000)
    assert.equal(small.hostHeadroom, 20_000)
    assert.equal(small.minProgress, 30_000)
    assert.equal(small.minGap, 5_000)
    assert.equal(small.maxGap, 50_000)
})

test('definition trims identity and instructions', () => {
    const definition = new PolicyDefinition({
        ...policyData,
        id: '  spaced  ',
        label: ' Label ',
    })
    assert.equal(definition.id, 'spaced')
    assert.equal(definition.label, 'Label')
    assert.equal(
        new PolicyDefinition(
            withCompaction({ baseInstructions: '  keep  ' })
        ).resolve(1_000_000).baseInstructions,
        'keep'
    )
})

test('definition accepts boundary values', () => {
    assert.doesNotThrow(
        () =>
            new PolicyDefinition(
                withProbe({ maxProbesPerCycle: 0, cacheFloor: 0 })
            )
    )
    assert.doesNotThrow(
        () =>
            new PolicyDefinition(
                withProbe({ maxProbesPerCycle: 100, cacheFloor: 1 })
            )
    )
    assert.doesNotThrow(
        () => new PolicyDefinition(withCompaction({ directiveMaxChars: 1 }))
    )
    assert.doesNotThrow(
        () => new PolicyDefinition(withCompaction({ directiveMaxChars: 8000 }))
    )
})

test('definition rejects invalid identity', () => {
    assert.throws(
        () => new PolicyDefinition({ ...policyData, id: '  ' }),
        /Policy id is required/
    )
    assert.throws(
        () => new PolicyDefinition({ ...policyData, label: ' ' }),
        /requires a label/
    )
})

test('definition rejects invalid thresholds', () => {
    assert.throws(
        () =>
            new PolicyDefinition(
                withThresholds({ hostHeadroom: { unit: 'tokens', value: 0 } })
            ),
        /positive finite/
    )
    assert.throws(
        () =>
            new PolicyDefinition(
                withThresholds({
                    arm: { unit: 'tokens', value: Number.POSITIVE_INFINITY },
                })
            ),
        /positive finite/
    )
    assert.throws(
        () =>
            new PolicyDefinition(
                withCompaction({ minProgress: { unit: 'ratio', value: 1.5 } })
            ),
        /Ratio threshold must be <= 1/
    )
    assert.throws(
        () =>
            new PolicyDefinition(
                withThresholds({
                    mandatory: { unit: 'percent' as 'ratio', value: 0.5 },
                })
            ),
        /Unsupported threshold unit/
    )
})

test('definition rejects invalid maxProbesPerCycle', () => {
    for (const value of [-1, 101, 1.5, Number.NaN]) {
        assert.throws(
            () => new PolicyDefinition(withProbe({ maxProbesPerCycle: value })),
            /maxProbesPerCycle must be an integer from 0 to 100/
        )
    }
})

test('definition rejects invalid cacheFloor', () => {
    for (const value of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.throws(
            () => new PolicyDefinition(withProbe({ cacheFloor: value })),
            /cacheFloor must be a number from 0 to 1/
        )
    }
})

test('definition rejects invalid directiveMaxChars', () => {
    for (const value of [0, -5, 8001, 12.5]) {
        assert.throws(
            () =>
                new PolicyDefinition(
                    withCompaction({ directiveMaxChars: value })
                ),
            /directiveMaxChars must be an integer from 1 to 8000/
        )
    }
})

test('definition rejects empty baseInstructions', () => {
    assert.throws(
        () =>
            new PolicyDefinition(withCompaction({ baseInstructions: '  \n' })),
        /baseInstructions is required/
    )
})

test('resolve names the policy and numbers when arm is not below mandatory', () => {
    const invalid = new PolicyDefinition(
        withThresholds({
            arm: { unit: 'ratio', value: 0.7 },
            mandatory: { unit: 'tokens', value: 500_000 },
        })
    )
    assert.throws(
        () => invalid.resolve(1_000_000),
        /Policy test: arm must resolve below mandatory \(700000 >= 500000\)/
    )
})

test('resolve rejects a mandatory boundary beyond the window', () => {
    const invalid = new PolicyDefinition(
        withThresholds({ mandatory: { unit: 'tokens', value: 900_000 } })
    )
    assert.throws(
        () => invalid.resolve(800_000),
        /Policy test: mandatory must resolve within the context window \(900000 > 800000\)/
    )
    assert.doesNotThrow(() => invalid.resolve(900_000))
})

test('resolve rejects minGap above maxGap', () => {
    const invalid = new PolicyDefinition(
        withProbe({
            minGap: { unit: 'tokens', value: 60_000 },
            maxGap: { unit: 'tokens', value: 50_000 },
        })
    )
    assert.throws(
        () => invalid.resolve(1_000_000),
        /Policy test: minGap must resolve <= maxGap \(60000 > 50000\)/
    )
})

test('resolve rejects minProgress at or above mandatory', () => {
    const invalid = new PolicyDefinition(
        withCompaction({ minProgress: { unit: 'ratio', value: 0.5 } })
    )
    assert.throws(
        () => invalid.resolve(1_000_000),
        /Policy test: minProgress must resolve below mandatory \(500000 >= 500000\)/
    )
})

test('threshold rejects invalid windows and sub-token results', () => {
    const ratio = new Threshold({ unit: 'ratio', value: 0.5 })
    assert.throws(() => ratio.resolve(0), /Context window must be positive/)
    assert.throws(
        () => new Threshold({ unit: 'ratio', value: 0.0001 }).resolve(1),
        /resolves below one token/
    )
})

test('registry supports replacement, cloning and activation', () => {
    const registry = new PolicyRegistry(registryOf(policyData))
    const cloned = registry.clone('test', 'clone')
    assert.equal(cloned.activePolicyId, 'clone')
    assert.equal(cloned.list().length, 2)
    assert.equal(cloned.activate('test').activePolicyId, 'test')
    assert.equal(cloned.get('clone')?.compaction.injectNative, true)

    const replaced = registry.replace(
        new PolicyDefinition(withProbe({ maxProbesPerCycle: 9 }))
    )
    assert.equal(replaced.active().probe.maxProbesPerCycle, 9)
    const added = registry.replace(
        new PolicyDefinition({ ...policyData, id: 'extra' })
    )
    assert.deepEqual(
        added.list().map((policy) => policy.id),
        ['test', 'extra']
    )
    assert.equal(added.active().id, 'test')
})

test('registry clone and activate reject unknown or duplicate ids', () => {
    const registry = new PolicyRegistry(registryOf(policyData))
    assert.throws(() => registry.clone('nope', 'x'), /unknown policy/)
    assert.throws(() => registry.clone('test', '  '), /New policy id/)
    assert.throws(() => registry.clone('test', 'test'), /already exists/)
    assert.throws(() => registry.activate('nope'), /unknown policy/)
})

test('registry rejects version 1 registries with a re-save hint', () => {
    for (const schemaVersion of [1, 3, 0]) {
        assert.throws(
            () =>
                new PolicyRegistry({
                    ...registryOf(policyData),
                    schemaVersion,
                }),
            /version 1 registries must be re-saved as schemaVersion 2/
        )
    }
})

test('registry rejects empty, duplicate and dangling policies', () => {
    assert.throws(
        () =>
            new PolicyRegistry({
                schemaVersion: POLICY_SCHEMA_VERSION,
                activePolicyId: 'test',
                policies: [],
            }),
        /at least one policy/
    )
    assert.throws(
        () => new PolicyRegistry(registryOf(policyData, policyData)),
        /Policy ids must be unique/
    )
    assert.throws(
        () =>
            new PolicyRegistry({
                ...registryOf(policyData),
                activePolicyId: 'missing',
            }),
        /Active policy does not exist: missing/
    )
})

test('codec validates and round-trips the injected registry', () => {
    const codec = new PolicyRegistryCodec()
    const registry = new PolicyRegistry(registryOf(policyData))
    const roundTrip = codec.parse(codec.stringify(registry))
    assert.equal(roundTrip.active().id, 'test')
    assert.deepEqual(roundTrip.toData(), registry.toData())
    assert.deepEqual(
        codec.parse(codec.pretty(registry)).toData(),
        registry.toData()
    )
})

function rawRegistry(mutate: (policy: Record<string, any>) => void): string {
    const policy = JSON.parse(JSON.stringify(policyData))
    mutate(policy)
    return JSON.stringify({
        schemaVersion: 2,
        activePolicyId: 'test',
        policies: [policy],
    })
}

test('codec rejects malformed untrusted registry data before it reaches the domain', () => {
    const codec = new PolicyRegistryCodec()
    assert.throws(
        () =>
            codec.parse(
                rawRegistry((policy) => {
                    policy.thresholds.mandatory.unit = 'magic'
                })
            ),
        /\$\.policies\[0\]\.thresholds\.mandatory\.unit must be "tokens" or "ratio"/
    )
})

test('codec decodes every v2 field with path-qualified errors', () => {
    const codec = new PolicyRegistryCodec()
    const cases: Array<[(policy: Record<string, any>) => void, RegExp]> = [
        [
            (p) => delete p.thresholds.hostHeadroom,
            /thresholds\.hostHeadroom must be an object/,
        ],
        [
            (p) => (p.thresholds.hostHeadroom.value = 'x'),
            /thresholds\.hostHeadroom\.value must be a finite number/,
        ],
        [
            (p) => delete p.probe.maxProbesPerCycle,
            /probe\.maxProbesPerCycle must be a finite number/,
        ],
        [
            (p) => (p.probe.maxProbesPerCycle = 2.5),
            /probe\.maxProbesPerCycle must be an integer/,
        ],
        [
            (p) => (p.probe.cacheFloor = '0.7'),
            /probe\.cacheFloor must be a finite number/,
        ],
        [
            (p) => delete p.compaction.minProgress,
            /compaction\.minProgress must be an object/,
        ],
        [
            (p) => (p.compaction.minProgress.unit = 'percent'),
            /compaction\.minProgress\.unit must be "tokens" or "ratio"/,
        ],
        [
            (p) => (p.compaction.directiveMaxChars = 1.5),
            /compaction\.directiveMaxChars must be an integer/,
        ],
        [
            (p) => delete p.compaction.injectNative,
            /compaction\.injectNative must be a boolean/,
        ],
        [
            (p) => (p.compaction.forkOnMandatory = 'yes'),
            /compaction\.forkOnMandatory must be a boolean/,
        ],
        [
            (p) => (p.compaction.baseInstructions = 5),
            /compaction\.baseInstructions must be a string/,
        ],
        [(p) => (p.id = 7), /policies\[0\]\.id must be a string/],
        [(p) => (p.probe = []), /policies\[0\]\.probe must be an object/],
    ]
    for (const [mutate, pattern] of cases) {
        assert.throws(() => codec.parse(rawRegistry(mutate)), pattern)
    }
})

test('codec rejects structural errors at the top level', () => {
    const codec = new PolicyRegistryCodec()
    assert.throws(() => codec.parse('{'), /Policy registry JSON is invalid/)
    assert.throws(() => codec.parse('[]'), /\$ must be an object/)
    assert.throws(
        () => codec.parse('{"schemaVersion":2,"activePolicyId":"a"}'),
        /\$\.policies must be an array/
    )
    assert.throws(
        () => codec.parse('{"schemaVersion":"2","activePolicyId":"a"}'),
        /\$\.schemaVersion must be a finite number/
    )
})

test('codec forwards version 1 registries to the domain rejection', () => {
    const codec = new PolicyRegistryCodec()
    const v1 = JSON.stringify({
        schemaVersion: 1,
        activePolicyId: 'test',
        policies: [policyData],
    })
    assert.throws(
        () => codec.parse(v1),
        /version 1 registries must be re-saved as schemaVersion 2/
    )
})
