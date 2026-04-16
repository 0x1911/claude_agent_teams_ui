import { useEffect, useMemo, useRef, useState } from 'react';

import { DISPLAY_STEPS } from '@renderer/components/team/provisioningSteps';
import { StepProgressBar } from '@renderer/components/team/StepProgressBar';
import { TeamProvisioningPanel } from '@renderer/components/team/TeamProvisioningPanel';
import { useTeamProvisioningPresentation } from '@renderer/components/team/useTeamProvisioningPresentation';
import { Badge } from '@renderer/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { cn } from '@renderer/lib/utils';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

import type { TeamProvisioningPresentation } from '@renderer/utils/teamProvisioningPresentation';
import type { CSSProperties } from 'react';

const MINI_STEPS = DISPLAY_STEPS.map((step) => ({ key: step.key, label: step.label }));
const HUD_STEPPER_STYLE: CSSProperties = {
  ['--stepper-done' as string]: '#22c55e',
  ['--stepper-done-glow' as string]: 'rgba(34, 197, 94, 0.24)',
  ['--stepper-current' as string]: '#22c55e',
  ['--stepper-current-ring' as string]: 'rgba(34, 197, 94, 0.18)',
  ['--stepper-pending' as string]: 'rgba(148, 163, 184, 0.08)',
  ['--stepper-pending-text' as string]: '#cbd5e1',
  ['--stepper-pending-border' as string]: 'rgba(148, 163, 184, 0.2)',
  ['--stepper-line' as string]: 'rgba(148, 163, 184, 0.14)',
  ['--stepper-line-done' as string]: '#22c55e',
  ['--stepper-label' as string]: '#94a3b8',
  ['--stepper-label-active' as string]: '#e2e8f0',
  ['--stepper-error' as string]: '#ef4444',
  ['--stepper-error-glow' as string]: 'rgba(239, 68, 68, 0.22)',
  ['--stepper-label-error' as string]: '#fca5a5',
};

function shouldRenderLaunchHud(presentation: TeamProvisioningPresentation | null): boolean {
  return presentation != null;
}

function getToneClasses(tone: TeamProvisioningPresentation['compactTone']): {
  border: string;
  badge: string;
  icon: React.ReactNode;
  iconClassName: string;
} {
  switch (tone) {
    case 'error':
      return {
        border: 'border-red-400/35 bg-[rgba(26,10,16,0.92)]',
        badge: 'border-red-500/30 text-red-300',
        icon: <AlertTriangle size={12} />,
        iconClassName: 'text-red-400',
      };
    case 'warning':
      return {
        border: 'border-amber-400/35 bg-[rgba(31,18,8,0.92)]',
        badge: 'border-amber-500/30 text-amber-200',
        icon: <AlertTriangle size={12} />,
        iconClassName: 'text-amber-400',
      };
    case 'success':
      return {
        border: 'border-emerald-400/35 bg-[rgba(8,24,18,0.92)]',
        badge: 'border-emerald-500/30 text-emerald-200',
        icon: <CheckCircle2 size={12} />,
        iconClassName: 'text-emerald-400',
      };
    default:
      return {
        border: 'border-cyan-400/25 bg-[rgba(8,14,26,0.92)]',
        badge: 'border-cyan-500/20 text-cyan-200',
        icon: <Loader2 size={12} className="animate-spin" />,
        iconClassName: 'text-cyan-300',
      };
  }
}

export interface GraphProvisioningHudProps {
  teamName: string;
  enabled?: boolean;
}

export const GraphProvisioningHud = ({
  teamName,
  enabled = true,
}: GraphProvisioningHudProps): React.JSX.Element | null => {
  const { presentation, runInstanceKey } = useTeamProvisioningPresentation(teamName);
  const lastActiveStepRef = useRef(-1);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const shouldRender = enabled && shouldRenderLaunchHud(presentation);
  const tone = presentation ? getToneClasses(presentation.compactTone) : null;
  const errorStepIndex = presentation?.isFailed
    ? lastActiveStepRef.current >= 0
      ? lastActiveStepRef.current
      : 0
    : undefined;

  useEffect(() => {
    setDetailsOpen(false);
    lastActiveStepRef.current = -1;
  }, [runInstanceKey, teamName]);

  useEffect(() => {
    if (presentation && !presentation.isFailed && presentation.currentStepIndex >= 0) {
      lastActiveStepRef.current = presentation.currentStepIndex;
    }
  }, [presentation]);

  const compactLabel = useMemo(() => {
    if (!presentation?.compactDetail) {
      return null;
    }
    return presentation.compactDetail.length > 54
      ? `${presentation.compactDetail.slice(0, 54)}...`
      : presentation.compactDetail;
  }, [presentation?.compactDetail]);

  if (!shouldRender || !presentation || !tone) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          'w-full rounded-xl border px-3 py-2 text-left text-slate-100 shadow-[0_14px_34px_rgba(5,5,16,0.24)] backdrop-blur-xl transition-colors hover:bg-[rgba(12,18,32,0.96)]',
          tone.border
        )}
        onClick={() => setDetailsOpen(true)}
        aria-label="Open launch details"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('shrink-0', tone.iconClassName)}>{tone.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate text-[11px] font-semibold text-slate-50">
                {presentation.compactTitle}
              </div>
              <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px]', tone.badge)}>
                {presentation.isFailed
                  ? 'Issue'
                  : presentation.hasMembersStillJoining
                    ? 'Joining'
                    : presentation.isActive
                      ? 'Live'
                      : 'Ready'}
              </Badge>
            </div>
            {compactLabel ? (
              <div className="mt-0.5 truncate text-[10px] leading-4 text-slate-300">
                {compactLabel}
              </div>
            ) : null}
          </div>
        </div>

        <div
          className="border-cyan-300/12 mt-2 overflow-hidden rounded-lg border bg-[rgba(4,10,20,0.58)] px-2 py-1.5"
          style={HUD_STEPPER_STYLE}
        >
          <StepProgressBar
            steps={MINI_STEPS}
            currentIndex={presentation.currentStepIndex}
            errorIndex={errorStepIndex}
            className="w-full"
          />
        </div>
      </button>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="w-[min(1120px,92vw)] max-w-5xl p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Launch details</DialogTitle>
            <DialogDescription>
              Detailed team launch progress, live output and CLI logs.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[85vh] overflow-y-auto p-4">
            <TeamProvisioningPanel teamName={teamName} surface="flat" defaultLogsOpen />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
