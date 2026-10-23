/**
 * Semantic tones mapped to Claude Code theme keys, so every drawing follows
 * the person's theme (light, dark, daltonized) instead of fixed ANSI colors.
 */
export type Tone =
    | 'accent'
    | 'good'
    | 'warn'
    | 'bad'
    | 'info'
    | 'text'
    | 'muted'
    | 'faint'

const THEME_KEYS: Record<Tone, string> = {
    accent: 'claude',
    good: 'success',
    warn: 'warning',
    bad: 'error',
    info: 'suggestion',
    text: 'text',
    muted: 'inactive',
    faint: 'subtle',
}

export function color(tone: Tone): string {
    return THEME_KEYS[tone]
}

/** Fill tone of a context level against the policy's two thresholds. */
export function levelTone(
    tokens: number | undefined,
    arm: number | undefined,
    mandatory: number | undefined
): Tone {
    if (tokens === undefined) return 'muted'
    if (mandatory !== undefined && tokens >= mandatory) return 'bad'
    if (arm !== undefined && tokens >= arm) return 'warn'
    return 'good'
}

export function automationTone(label: string): Tone {
    if (label === 'AUTO') return 'good'
    if (label === 'MANUAL') return 'warn'
    return 'muted'
}

export function decisionTone(decision: string): Tone {
    const value = decision.toLowerCase()
    if (value.includes('fail') || value.includes('error')) return 'bad'
    if (value.includes('skip') || value.includes('refused')) return 'bad'
    if (value.includes('compact')) return 'accent'
    if (value.includes('wait') || value.includes('deferred')) return 'warn'
    if (value.includes('suspended') || value.includes('budget')) return 'warn'
    if (value.includes('not evaluated')) return 'muted'
    return 'text'
}
