export const CREDITS_PER_30_SECONDS = 336;
export const SECONDS_PER_30_SECONDS = 30;
export const CREDITS_PER_SECOND = CREDITS_PER_30_SECONDS / SECONDS_PER_30_SECONDS;

export const FREE_TRIAL_MINUTES = 15;
export const FREE_TRIAL_SECONDS = FREE_TRIAL_MINUTES * 60;
export const DEFAULT_CREDITS_OFFERED = roundCredits(FREE_TRIAL_SECONDS * CREDITS_PER_SECOND);

export function calculateEstimatedCostCredits(durationSeconds) {
  return roundCredits(Math.max(0, durationSeconds) * CREDITS_PER_SECOND);
}

export function normalizeCreditsOffered(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_CREDITS_OFFERED;
  }

  return roundCredits(value);
}

export function normalizeCreditsUsed(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return roundCredits(value);
}

export function getRemainingCredits(creditsOffered, creditsUsed) {
  return roundCredits(Math.max(0, normalizeCreditsOffered(creditsOffered) - normalizeCreditsUsed(creditsUsed)));
}

export function isTrialExhausted(creditsOffered, creditsUsed) {
  return normalizeCreditsUsed(creditsUsed) >= normalizeCreditsOffered(creditsOffered);
}

function roundCredits(value) {
  return Number(value.toFixed(2));
}
