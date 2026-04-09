# Agent Handover: Automatic agent resume after rate limit expiration

Last updated: 2026-04-08
Status: Planning complete, implementation not started yet (Phase A pending)

## Goal

Implement automatic resume for alive team agents after Claude rate limits expire.

Current user-approved scope for MVP (Phase A):

- Auto-resume only for alive teams (no auto-relaunch).
- Parse lead output like `You've hit your limit · resets 1am (Europe/Berlin)` or `... 8pm ...`.
- Retry at parsed reset time plus safety minutes.
- If parse fails, use exponential backoff fallback.
- Show retry state in UI without polluting normal chat flow.

## Key findings from codebase analysis

### Existing detection and notification

- `src/shared/utils/rateLimitDetector.ts`
  - Already contains very simple matcher for rate-limit text (`You've hit your limit`).
- `src/main/ipc/teams.ts`
  - `checkRateLimitMessages(...)` scans returned message pages.
  - On detection it emits notification via `NotificationManager.addTeamNotification(...)` using `teamEventType: 'rate_limit'`.

Important: this is currently notification-only. There is no automatic retry/resume scheduler.

### Runtime orchestration location

- Main orchestration logic is in `src/main/services/team/TeamProvisioningService.ts`.
- Lead live output ingestion path is handled there (`handleStreamJsonMessage(...)`, `pushLiveLeadTextMessage(...)`).
- Message injection into running lead exists via `sendMessageToTeam(teamName, message)`.
- Team alive checks are available via `isTeamAlive(teamName)`.

### Existing timer infrastructure

- `TeamProvisioningService` already uses per-request timers (`pendingTimeouts`) and cleanup logic.
- This can be reused pattern-wise for retry scheduling and cleanup safety.

### Event pipeline to renderer already exists

- Team events are forwarded from main to renderer in `src/main/index.ts` via `TEAM_CHANGE`.
- Renderer consumes team change events in store (`src/renderer/store/index.ts`, `teamSlice.ts`).
- This supports adding a new event subtype for retry status visibility.

### Relevant UI surfaces

- `src/renderer/components/team/TeamProvisioningBanner.tsx`
  - Good place for compact status display (retry countdown, attempt, unavailable duration).
- This avoids adding noisy normal chat messages.

### Config system integration points

- Shared config type: `src/shared/types/notifications.ts` (`AppConfig.general`).
- Validation: `src/main/ipc/configValidation.ts`.
- Defaults/persistence: `src/main/services/infrastructure/ConfigManager.ts`.
- Settings hook defaults: `src/renderer/components/settings/hooks/useSettingsConfig.ts`.
- Optional UI controls: `src/renderer/components/settings/sections/GeneralSection.tsx`.

## Proposed Phase A implementation plan

### A1) Shared rate-limit parser and retry timing helpers

Target file: `src/shared/utils/rateLimitDetector.ts`

Add helpers:

- `extractRateLimitResetAt(text: string, now = new Date()): Date | null`
  - Parse `resets <hour><am|pm> (Timezone)` patterns.
  - Convert AM/PM correctly, including 12am/12pm edge cases.
  - Compute next occurrence (today or next day).
- `computeRateLimitRetryAt(...)`
  - Add safety minutes (default 3).
- `computeRateLimitFallbackDelayMs(attempt, maxDelayMs)`
  - Exponential backoff fallback when no parseable reset is present.

### A2) Main-process retry scheduler/state in TeamProvisioningService

Target file: `src/main/services/team/TeamProvisioningService.ts`

Add per-team retry state map, e.g.:

- `retryAttempt`
- `firstDetectedAt`
- `lastDetectedAt`
- `nextRetryAt`
- `lastOutputPreview`
- timer handle

Hook detection in live lead text path (`pushLiveLeadTextMessage(...)`), and:

- On rate-limit detection:
  - schedule/refresh next retry timer,
  - keep one timer per team (coalescing),
  - emit UI event with retry state.
- On timer fire:
  - guard checks: alive team, writable stdin, not cancelled/killed,
  - if safe, send one internal resume prompt via `sendMessageToTeam(...)`,
  - if still rate-limited afterward, re-schedule using parsed reset or fallback.

Cleanup requirements:

- clear retry timer/state in run cleanup paths (including stop/disconnect/cancel).

### A3) Team change event + renderer state

Target files:

- `src/shared/types/team.ts` (event/type extension)
- `src/renderer/store/index.ts` (event handling)
- `src/renderer/store/slices/teamSlice.ts` (state)

Add a dedicated event/payload for rate-limit retry status (example name: `rate-limit-retry`).

Suggested payload fields:

- `teamName`
- `active` (boolean)
- `retryAttempt`
- `nextRetryAt`
- `firstDetectedAt`
- `lastDetectedAt`
- `lastOutputPreview`
- `status` (`waiting` | `retrying` | `idle`)

### A4) UI visibility without chat noise

Target file: `src/renderer/components/team/TeamProvisioningBanner.tsx`

Show compact state block when retry is active:

- Rate-limited state
- Next retry time / countdown
- Retry attempt number
- Unavailable duration
- Last output preview (short)

No normal message injection into inbox for status updates.

### A5) Config (Phase A light)

Add settings (with defaults):

- `general.autoResumeAfterRateLimit: boolean` (default `true`)
- `general.rateLimitSafetyMinutes: number` (default `3`)
- `general.rateLimitMaxBackoffMinutes: number` (default `30`)

Touchpoints:

- `src/shared/types/notifications.ts`
- `src/main/services/infrastructure/ConfigManager.ts`
- `src/main/ipc/configValidation.ts`
- `src/renderer/components/settings/hooks/useSettingsConfig.ts`

Optional settings UI in `GeneralSection.tsx` can be added in same phase or immediately after.

### A6) Tests

Planned tests:

- New unit tests for parser helpers (AM/PM, 12am/12pm, next-day rollover, parse failure).
- Service tests (fake timers): schedule, retry trigger, re-schedule on repeated limit, cleanup.
- Renderer/store tests for new team-change retry event handling.

## Suggested execution order (small safe chunks)

1. Shared parser helpers + tests.
2. Service retry state/scheduler + tests.
3. Shared team event type + renderer store wiring + tests.
4. Banner UI status view.
5. Config keys + validation + settings hook (and optional General settings UI).

## Non-goals for Phase A (explicit)

- No auto-relaunch if process died/offline.
- No multi-key/API-key rotation in this phase.
- No changes to external orchestration systems.

## Risks and notes

- Timezone text in message is display-oriented; parser should be resilient and avoid brittle assumptions.
- Keep guardrails strict to avoid sending resume prompts to dead/non-writable sessions.
- Ensure timers are always cleared on run cleanup to prevent memory leaks and stale retries.
- UI should remain informative but low-noise.

## Ready-to-start checklist

- [x] Scope aligned with user
- [x] Relevant files and flows identified
- [x] Implementation strategy drafted
- [x] Phase A code changes started

## Changelog

### 2026-04-08 - Phase A implementation progress

Implemented (in progress, not yet fully validated end-to-end):

- Shared retry helpers added in `src/shared/utils/rateLimitDetector.ts`:
  - case-insensitive `isRateLimitMessage`
  - `extractRateLimitResetAt`
  - `computeRateLimitRetryAt`
  - `computeRateLimitFallbackDelayMs`
- Main auto-resume runtime added in `src/main/services/team/TeamProvisioningService.ts`:
  - per-team rate-limit retry runtime map
  - timer scheduling and execution with alive/writable/idle guards
  - cleanup integration in `cleanupRun`
  - new team event emission: `rate-limit-retry`
- Shared event/state types added in `src/shared/types/team.ts`:
  - `RateLimitRetryState`
  - `RateLimitRetryStatus`
  - `TeamChangeEvent` now includes `rate-limit-retry`
- Config keys added and validated:
  - `general.autoResumeAfterRateLimit`
  - `general.rateLimitSafetyMinutes`
  - `general.rateLimitMaxBackoffMinutes`
  - touched files:
    - `src/shared/types/notifications.ts`
    - `src/main/services/infrastructure/ConfigManager.ts`
    - `src/main/ipc/configValidation.ts`
    - `src/renderer/components/settings/hooks/useSettingsConfig.ts`
- Renderer state wiring for retry events:
  - `src/renderer/store/index.ts`
  - `src/renderer/store/slices/teamSlice.ts`
- Team UI visibility (non-chat noise) in:
  - `src/renderer/components/team/TeamProvisioningBanner.tsx`
- Settings UI controls for new general options in:
  - `src/renderer/components/settings/sections/GeneralSection.tsx`
  - `src/renderer/components/settings/hooks/useSettingsHandlers.ts`
  - `src/renderer/components/settings/SettingsView.tsx`
- Tests added/updated:
  - `test/shared/utils/rateLimitDetector.test.ts`
  - `test/main/services/team/TeamProvisioningServiceLiveMessages.test.ts`

Open validation note:

- A timer-based rate-limit resume test initially failed due to timezone/timer assumptions.
- Test updated to use local fake system time and dynamic delay based on computed `nextRetryAt`.

### 2026-04-08 - Follow-up validation and store event tests

- Targeted tests now pass:
  - `test/shared/utils/rateLimitDetector.test.ts`
  - `test/main/services/team/TeamProvisioningServiceLiveMessages.test.ts`
- Added renderer store listener tests for the new team-change event in
  `test/renderer/store/teamChangeThrottle.test.ts`:
  - stores active `rate-limit-retry` payload in `rateLimitRetryByTeam`
  - clears stored state when inactive/idle payload arrives

### 2026-04-08 - UX/text polish and verification

- Polished retry banner wording in `src/renderer/components/team/TeamProvisioningBanner.tsx`
  to use user-facing status labels (less technical phrasing).
- Fixed settings key typing for optional general fields in:
  - `src/renderer/components/settings/hooks/useSettingsHandlers.ts`
  - `src/renderer/components/settings/sections/GeneralSection.tsx`
- Verification:
  - `pnpm typecheck` passes
  - targeted tests pass:
    - `test/shared/utils/rateLimitDetector.test.ts`
    - `test/main/services/team/TeamProvisioningServiceLiveMessages.test.ts`
    - `test/renderer/store/teamChangeThrottle.test.ts`

### 2026-04-08 - Structured rate_limit_event support

- Implemented direct handling of stream-json `rate_limit_event` in
  `src/main/services/team/TeamProvisioningService.ts`.
- Added `rate_limit_event` to handled stream types (so it no longer falls into
  generic "Unhandled stream-json type" logging).
- Retry scheduling now prefers structured `rate_limit_info.resetsAt` (Unix seconds)
  plus configured safety buffer.
- Text-based parsing remains as fallback path.
- Behavior updates:
  - `status: rejected` -> schedule/refresh auto-resume retry
  - `status: allowed` -> clear active retry state
  - `status: allowed_warning` -> no forced schedule/clear
- Added tests in `test/main/services/team/TeamProvisioningServiceLiveMessages.test.ts`:
  - schedules retry from `rate_limit_event` `resetsAt`
  - clears retry state on `status: allowed`

### 2026-04-08 - Broad regression run

- Full test suite passes:
  - `pnpm test` -> `170 passed`, `2352 passed`
- Build command in this agent environment hit an execution-path issue during prebuild:
  - `corepack pnpm build` fails because nested script calls `pnpm` directly (`sh: 1: pnpm: not found`).
  - This is environment-specific; local developer shell with normal pnpm PATH should run build normally.
