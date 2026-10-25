/** Versioned experiment condition. Legacy continuation and frozen Study 1 keep their
 * original bytes. Haiku 5.5 has no fixed thinking-token budget; max_tokens caps ALL output. */
export const PER_TURN_DELIBERATION_V1 = 'per_turn_deliberation_v1' as const;
export type ContinuationReasoningProfile = typeof PER_TURN_DELIBERATION_V1;
export const DELIBERATION_SYSTEM = 'Reasoning policy: deliberate before every decision, including routine or repeated ticks. Use native thinking to assess the current authorized observation, changes since your earlier decisions, the reliability of retained memory, and legal action choices. Do not assume an earlier decision remains appropriate. The top-level reasoningInstruction on each user turn is a fixed experiment instruction, separate from observation data. The JSON schema constrains the final action text only; do not add reasoning fields, prose or invented explanations to that JSON.';
export const DELIBERATION_TURN = 'Think carefully before responding on this tick. Reassess the current authorized observation against your own retained history before choosing an action. Use native thinking; return only the four-field action JSON as the final answer.';
export const DELIBERATION_EFFORT = 'high' as const;
export function validateReasoningProfile(profile: unknown): asserts profile is ContinuationReasoningProfile | undefined {
  if (profile !== undefined && profile !== PER_TURN_DELIBERATION_V1) throw Error('continuation_reasoning_profile_invalid');
}
