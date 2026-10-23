import type { ContextSnapshot, ForkUsage } from '../domain/state'
import type { TelemetryData } from '../domain/telemetry'

/**
 * Why a fork produced no reply. Adapters map their host's failure arms into
 * these reasons at the runtime boundary.
 */
export type ForkUnavailableReason =
    | 'nothing-to-fork'
    | 'api-error'
    | 'empty-reply'
    | 'aborted'

export type ForkOutcome =
    | {
          readonly kind: 'answered'
          readonly text: string
          readonly usage: ForkUsage
      }
    | {
          readonly kind: 'unavailable'
          readonly reason: ForkUnavailableReason
          readonly usage?: ForkUsage | undefined
      }

export interface CompactResult {
    readonly skip?: string | undefined
    readonly tokensBefore?: number | undefined
    readonly tokensAfter?: number | undefined
}

export interface RuntimePort {
    readContext(): Promise<ContextSnapshot>
    fork(prompt: string): Promise<ForkOutcome>
    compact(instructions: string): Promise<CompactResult>
    sessionId(): Promise<string>
    toast(message: string): Promise<void>
    invalidateUi(): Promise<void>
    /** Persists lifetime telemetry (Claude Code: the plugin store, key `telemetry`). */
    saveTelemetry(data: TelemetryData): Promise<void>
}

export interface ConfigurationPort {
    saveRegistryJson(json: string): Promise<void>
    setAutoEnabled(enabled: boolean): Promise<void>
    setShowStatusBand(enabled: boolean): Promise<void>
}
