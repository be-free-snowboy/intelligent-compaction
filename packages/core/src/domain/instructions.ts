export const DIRECTIVE_LABEL = 'Preservation directive:'

export interface InstructionParts {
    /** Text the person typed after `/compact`, when they typed any. */
    readonly user?: string | undefined
    readonly base: string
    readonly directive?: string | undefined
}

/**
 * The one place compaction instructions are assembled, for the plugin's own
 * compactions and for native ones alike: the person's words first, then the
 * policy's durable instructions, then the fork's preservation directive.
 */
export class InstructionComposer {
    compose(parts: InstructionParts): string {
        const directive = parts.directive?.trim()
        return [
            parts.user?.trim(),
            parts.base.trim(),
            directive ? `${DIRECTIVE_LABEL} ${directive}` : undefined,
        ]
            .filter((part): part is string => Boolean(part))
            .join('\n\n')
    }
}
