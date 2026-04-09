import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { getCurrentProvisioningProgressForTeam } from '@renderer/store/slices/teamSlice';
import { X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { ProvisioningProgressBlock } from './ProvisioningProgressBlock';
import { getDisplayStepIndex } from './provisioningSteps';

interface TeamProvisioningBannerProps {
  teamName: string;
}

export const TeamProvisioningBanner = ({
  teamName,
}: TeamProvisioningBannerProps): React.JSX.Element | null => {
  const { progress, cancelProvisioning, teamMembers, rateLimitRetry } = useStore(
    useShallow((s) => ({
      progress: getCurrentProvisioningProgressForTeam(s, teamName),
      cancelProvisioning: s.cancelProvisioning,
      teamMembers: s.selectedTeamData?.members,
      rateLimitRetry: s.rateLimitRetryByTeam[teamName],
    }))
  );
  const [dismissed, setDismissed] = useState(false);
  const lastActiveStepRef = useRef(-1);
  const bannerInstanceKey = useMemo(() => {
    if (!progress) return null;
    return `${teamName}:${progress.runId}:${progress.startedAt}`;
  }, [teamName, progress?.runId, progress?.startedAt]);

  useEffect(() => {
    setDismissed(false);
  }, [bannerInstanceKey]);

  // NOTE: we intentionally do NOT auto-dismiss "ready" banners.
  // Users frequently need to inspect launch output after fast stop→start cycles,
  // and auto-dismiss can make it look like no progress/logs were produced.

  if (!progress || dismissed) {
    if (!rateLimitRetry || !rateLimitRetry.active) {
      return null;
    }
  }

  const retryInfo = rateLimitRetry?.active
    ? {
        retryAttempt: rateLimitRetry.retryAttempt,
        statusLabel:
          rateLimitRetry.status === 'retrying'
            ? 'retry in progress'
            : rateLimitRetry.status === 'waiting'
              ? 'waiting for retry window'
              : 'idle',
        nextRetryLabel: (() => {
          if (!rateLimitRetry.nextRetryAt) return 'soon';
          const diffMs = Date.parse(rateLimitRetry.nextRetryAt) - Date.now();
          if (!Number.isFinite(diffMs) || diffMs <= 0) return 'soon';
          const totalSec = Math.ceil(diffMs / 1000);
          const mins = Math.floor(totalSec / 60);
          const secs = totalSec % 60;
          return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        })(),
        unavailableSinceLabel: (() => {
          const sinceMs = Date.now() - Date.parse(rateLimitRetry.firstDetectedAt);
          if (!Number.isFinite(sinceMs) || sinceMs < 0) return 'just now';
          const mins = Math.floor(sinceMs / 60000);
          if (mins <= 0) return 'just now';
          if (mins < 60) return `${mins}m`;
          const hours = Math.floor(mins / 60);
          return `${hours}h ${mins % 60}m`;
        })(),
        lastOutputPreview: rateLimitRetry.lastOutputPreview,
      }
    : null;

  const rateLimitStatusBlock = retryInfo ? (
    <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
      <p>
        Claude rate limit reached - retry #{retryInfo.retryAttempt}
      </p>
      <p>
        {retryInfo.statusLabel} · next retry in {retryInfo.nextRetryLabel} · unavailable for{' '}
        {retryInfo.unavailableSinceLabel}
      </p>
      {retryInfo.lastOutputPreview ? <p>Last output: {retryInfo.lastOutputPreview}</p> : null}
    </div>
  ) : null;

  if (!progress || dismissed) {
    return rateLimitStatusBlock;
  }

  if (progress.state === 'cancelled' || progress.state === 'disconnected') {
    return rateLimitStatusBlock;
  }

  const isReady = progress.state === 'ready';
  const isFailed = progress.state === 'failed';
  const isActive =
    progress.state === 'validating' ||
    progress.state === 'spawning' ||
    progress.state === 'configuring' ||
    progress.state === 'assembling' ||
    progress.state === 'finalizing' ||
    progress.state === 'verifying';

  const canCancel =
    progress.state === 'spawning' ||
    progress.state === 'configuring' ||
    progress.state === 'assembling' ||
    progress.state === 'finalizing' ||
    progress.state === 'verifying';

  const progressStepIndex = getDisplayStepIndex(progress.state);

  // Remember last active step so we can show it as the error location when failed
  if (progressStepIndex >= 0 && !isFailed) {
    lastActiveStepRef.current = progressStepIndex;
  }

  if (isFailed) {
    return (
      <div className="mb-3">
        {rateLimitStatusBlock}
        <div className="mb-2 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2">
          <p className="flex-1 text-xs text-[var(--step-error-text)]">{progress.message}</p>
          <Button
            variant="outline"
            size="sm"
            className="h-6 shrink-0 border-red-500/40 px-2 text-xs text-[var(--step-error-text)] hover:bg-red-500/10"
            onClick={() => setDismissed(true)}
          >
            <X size={12} />
          </Button>
        </div>
        <ProvisioningProgressBlock
          key={progress.runId}
          title="Launch failed"
          message={progress.error ?? null}
          tone="error"
          currentStepIndex={lastActiveStepRef.current}
          errorStepIndex={lastActiveStepRef.current >= 0 ? lastActiveStepRef.current : 0}
          startedAt={progress.startedAt}
          pid={progress.pid}
          cliLogsTail={progress.cliLogsTail}
          assistantOutput={progress.assistantOutput}
          defaultLiveOutputOpen
          onCancel={null}
        />
      </div>
    );
  }

  const allTeammatesOnline =
    teamMembers != null &&
    teamMembers.length > 0 &&
    teamMembers.every((m) => m.status === 'active' || m.status === 'idle');

  if (isReady) {
    const readyMessage = allTeammatesOnline
      ? `Team launched — all ${teamMembers.length} teammates online`
      : 'Team launched — teammates may still be starting';

    return (
      <div className="mb-3">
        {rateLimitStatusBlock}
        <ProvisioningProgressBlock
          key={progress.runId}
          title="Launch details"
          message={progress.message}
          messageSeverity={progress.messageSeverity}
          currentStepIndex={progressStepIndex >= 0 ? progressStepIndex : -1}
          startedAt={progress.startedAt}
          pid={progress.pid}
          cliLogsTail={progress.cliLogsTail}
          assistantOutput={progress.assistantOutput}
          defaultLiveOutputOpen={false}
          onCancel={null}
          successMessage={readyMessage}
          onDismiss={() => setDismissed(true)}
        />
      </div>
    );
  }

  if (isActive) {
    return (
      <div className="mb-3">
        {rateLimitStatusBlock}
        <ProvisioningProgressBlock
          key={progress.runId}
          title="Launching team"
          message={progress.message}
          messageSeverity={progress.messageSeverity}
          currentStepIndex={progressStepIndex >= 0 ? progressStepIndex : -1}
          loading
          startedAt={progress.startedAt}
          pid={progress.pid}
          cliLogsTail={progress.cliLogsTail}
          assistantOutput={progress.assistantOutput}
          defaultLiveOutputOpen
          onCancel={
            canCancel
              ? () => {
                  void cancelProvisioning(progress.runId);
                }
              : null
          }
        />
      </div>
    );
  }

  return rateLimitStatusBlock;
};
