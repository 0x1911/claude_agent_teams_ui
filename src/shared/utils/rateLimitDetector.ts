/**
 * Detects rate limit messages from Claude.
 */

const RATE_LIMIT_SUBSTRING = "You've hit your limit";
const RESET_TIME_RE = /\bresets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
const DEFAULT_FALLBACK_DELAY_MS = 2 * 60 * 1000;
const MAX_FALLBACK_DELAY_MS = 30 * 60 * 1000;

/**
 * Returns true if the message text contains the rate limit indicator.
 */
export function isRateLimitMessage(text: string): boolean {
  return text.toLowerCase().includes(RATE_LIMIT_SUBSTRING.toLowerCase());
}

/**
 * Parses reset time from messages like:
 * - "You've hit your limit · resets 1am (Europe/Berlin)"
 * - "You've hit your limit · resets 8pm (Europe/Berlin)"
 */
export function extractRateLimitResetAt(text: string, now: Date = new Date()): Date | null {
  const match = RESET_TIME_RE.exec(text);
  if (!match) {
    return null;
  }

  const hour12 = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const meridiem = match[3].toLowerCase();

  if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12) {
    return null;
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }

  const hour24 = meridiem === 'am' ? hour12 % 12 : hour12 % 12 + 12;
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setHours(hour24, minute, 0, 0);

  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate;
}

export function computeRateLimitRetryAt(
  text: string,
  now: Date = new Date(),
  safetyMinutes = 3
): Date | null {
  const resetAt = extractRateLimitResetAt(text, now);
  if (!resetAt) {
    return null;
  }
  const safetyMs = Math.max(0, Math.trunc(safetyMinutes)) * 60_000;
  return new Date(resetAt.getTime() + safetyMs);
}

export function computeRateLimitFallbackDelayMs(
  attempt: number,
  opts?: { baseDelayMs?: number; maxDelayMs?: number }
): number {
  const baseDelayMs = opts?.baseDelayMs ?? DEFAULT_FALLBACK_DELAY_MS;
  const maxDelayMs = opts?.maxDelayMs ?? MAX_FALLBACK_DELAY_MS;
  const normalizedAttempt = Math.max(1, Math.trunc(attempt));
  const delay = baseDelayMs * 2 ** (normalizedAttempt - 1);
  return Math.max(baseDelayMs, Math.min(maxDelayMs, delay));
}
