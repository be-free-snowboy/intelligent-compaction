export function formatTokens(value: number | undefined): string {
    if (value === undefined || !Number.isFinite(value)) return '—'
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
    return `${Math.round(value / 1_000)}k`
}

export function formatPercent(value: number | undefined): string {
    return value === undefined ? '—' : `${value.toFixed(1)}%`
}
