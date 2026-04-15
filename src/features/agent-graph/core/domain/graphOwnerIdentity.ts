import { getStableTeamOwnerId, type StableTeamOwnerLike } from '@shared/utils/teamStableOwnerId';

export const GRAPH_STABLE_SLOT_LAYOUT_VERSION = 'stable-slots-v1' as const;

export function getGraphStableOwnerId(member: StableTeamOwnerLike): string {
  return getStableTeamOwnerId(member);
}

export function buildGraphMemberNodeId(teamName: string, stableOwnerId: string): string {
  return `member:${teamName}:${stableOwnerId}`;
}

export function buildGraphMemberNodeIdForMember(
  teamName: string,
  member: StableTeamOwnerLike
): string {
  return buildGraphMemberNodeId(teamName, getGraphStableOwnerId(member));
}

export function parseGraphMemberNodeId(nodeId: string, teamName?: string): string | null {
  const prefix = teamName ? `member:${teamName}:` : 'member:';
  if (!nodeId.startsWith(prefix)) {
    return null;
  }
  if (teamName) {
    return nodeId.slice(prefix.length) || null;
  }
  const [, , ...rest] = nodeId.split(':');
  return rest.length > 0 ? rest.join(':') : null;
}
