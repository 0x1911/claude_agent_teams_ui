import { describe, expect, it } from 'vitest';

import {
  computeRateLimitFallbackDelayMs,
  computeRateLimitRetryAt,
  extractRateLimitResetAt,
  isRateLimitMessage,
} from '../../../src/shared/utils/rateLimitDetector';

describe('rateLimitDetector', () => {
  it('detects rate-limit message text case-insensitively', () => {
    expect(isRateLimitMessage("You've hit your limit · resets 1am (Europe/Berlin)")).toBe(true);
    expect(isRateLimitMessage("YOU'VE HIT YOUR LIMIT · resets 8pm (Europe/Berlin)")).toBe(true);
    expect(isRateLimitMessage('normal output')).toBe(false);
  });

  it('parses AM reset time and same-day scheduling', () => {
    const now = new Date(2026, 3, 8, 0, 10, 0, 0);
    const resetAt = extractRateLimitResetAt(
      "You've hit your limit · resets 1am (Europe/Berlin)",
      now
    );

    expect(resetAt).not.toBeNull();
    expect(resetAt?.getFullYear()).toBe(2026);
    expect(resetAt?.getMonth()).toBe(3);
    expect(resetAt?.getDate()).toBe(8);
    expect(resetAt?.getHours()).toBe(1);
    expect(resetAt?.getMinutes()).toBe(0);
  });

  it('parses PM reset time and rolls over to next day when needed', () => {
    const now = new Date(2026, 3, 8, 23, 10, 0, 0);
    const resetAt = extractRateLimitResetAt(
      "You've hit your limit · resets 8pm (Europe/Berlin)",
      now
    );

    expect(resetAt).not.toBeNull();
    expect(resetAt?.getDate()).toBe(9);
    expect(resetAt?.getHours()).toBe(20);
    expect(resetAt?.getMinutes()).toBe(0);
  });

  it('handles 12am and 12pm correctly', () => {
    const now = new Date(2026, 3, 8, 10, 0, 0, 0);
    const atNoon = extractRateLimitResetAt("You've hit your limit · resets 12pm (Europe/Berlin)", now);
    const atMidnight = extractRateLimitResetAt(
      "You've hit your limit · resets 12am (Europe/Berlin)",
      now
    );

    expect(atNoon?.getDate()).toBe(8);
    expect(atNoon?.getHours()).toBe(12);
    expect(atMidnight?.getDate()).toBe(9);
    expect(atMidnight?.getHours()).toBe(0);
  });

  it('adds safety minutes to computed retry date', () => {
    const now = new Date(2026, 3, 8, 10, 0, 0, 0);
    const retryAt = computeRateLimitRetryAt(
      "You've hit your limit · resets 1pm (Europe/Berlin)",
      now,
      3
    );

    expect(retryAt?.getDate()).toBe(8);
    expect(retryAt?.getHours()).toBe(13);
    expect(retryAt?.getMinutes()).toBe(3);
  });

  it('returns null when reset time is missing', () => {
    const retryAt = computeRateLimitRetryAt("You've hit your limit", new Date(2026, 3, 8, 10, 0, 0));
    expect(retryAt).toBeNull();
  });

  it('computes capped exponential fallback delay', () => {
    expect(computeRateLimitFallbackDelayMs(1)).toBe(2 * 60 * 1000);
    expect(computeRateLimitFallbackDelayMs(2)).toBe(4 * 60 * 1000);
    expect(computeRateLimitFallbackDelayMs(10)).toBe(30 * 60 * 1000);
  });
});
