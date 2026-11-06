/** Real audio is stored only outside production, or when consent was recorded. */
export function audioPersistenceAllowed(consentRecordedAt: Date | null): boolean {
  const enforce = process.env.NODE_ENV === "production" || process.env.AUDIO_CONSENT_GATE === "enforce";
  if (!enforce) return true;
  return consentRecordedAt != null;
}

export const CONSENT_REQUIRED_MESSAGE =
  "Áudio real não foi persistido: falta consent_recorded_at.";
