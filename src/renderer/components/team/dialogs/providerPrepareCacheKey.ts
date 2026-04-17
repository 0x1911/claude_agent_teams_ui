import type { TeamProviderId } from '@shared/types';

export function buildProviderPrepareModelCacheKey({
  cwd,
  providerId,
  backendSummary,
  limitContext,
}: {
  cwd: string;
  providerId: TeamProviderId;
  backendSummary: string | null | undefined;
  limitContext: boolean;
}): string {
  return [
    cwd,
    providerId,
    backendSummary ?? '',
    limitContext ? 'limit-context:on' : 'limit-context:off',
  ].join('::');
}
