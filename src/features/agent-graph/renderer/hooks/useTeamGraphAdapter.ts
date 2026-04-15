/**
 * React hook bridge for TeamGraphAdapter class.
 * Thin wrapper — instantiates the class adapter and calls adapt() with store data.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { getSnapshot, subscribe } from '@renderer/services/commentReadStorage';
import { useStore } from '@renderer/store';
import {
  getCurrentProvisioningProgressForTeam,
  selectTeamDataForName,
} from '@renderer/store/slices/teamSlice';
import { useShallow } from 'zustand/react/shallow';

import { TeamGraphAdapter } from '../adapters/TeamGraphAdapter';

import type { GraphDataPort } from '@claude-teams/agent-graph';

export function useTeamGraphAdapter(teamName: string): GraphDataPort {
  const adapterRef = useRef<TeamGraphAdapter>(TeamGraphAdapter.create());

  const {
    teamData,
    spawnStatuses,
    leadActivity,
    leadContext,
    pendingApprovals,
    activeTools,
    finishedVisible,
    toolHistory,
    provisioningProgress,
    memberSpawnSnapshot,
    slotAssignments,
    ensureTeamGraphSlotAssignments,
  } = useStore(
    useShallow((s) => ({
      teamData: selectTeamDataForName(s, teamName),
      spawnStatuses: teamName ? s.memberSpawnStatusesByTeam[teamName] : undefined,
      leadActivity: teamName ? s.leadActivityByTeam[teamName] : undefined,
      leadContext: teamName ? s.leadContextByTeam[teamName] : undefined,
      pendingApprovals: s.pendingApprovals,
      activeTools: teamName ? s.activeToolsByTeam[teamName] : undefined,
      finishedVisible: teamName ? s.finishedVisibleByTeam[teamName] : undefined,
      toolHistory: teamName ? s.toolHistoryByTeam[teamName] : undefined,
      provisioningProgress: teamName ? getCurrentProvisioningProgressForTeam(s, teamName) : null,
      memberSpawnSnapshot: teamName ? s.memberSpawnSnapshotsByTeam[teamName] : undefined,
      slotAssignments: teamName ? s.slotAssignmentsByTeam[teamName] : undefined,
      ensureTeamGraphSlotAssignments: s.ensureTeamGraphSlotAssignments,
    }))
  );

  const pendingApprovalAgents = useMemo(() => {
    const agents = new Set<string>();
    for (const a of pendingApprovals) {
      if (a.teamName === teamName) {
        agents.add(a.source);
      }
    }
    return agents;
  }, [pendingApprovals, teamName]);

  const commentReadState = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    if (!teamName || !teamData) {
      return;
    }
    ensureTeamGraphSlotAssignments(teamName, teamData.members);
  }, [ensureTeamGraphSlotAssignments, teamData, teamName]);

  return useMemo(
    () =>
      adapterRef.current.adapt(
        teamData,
        teamName,
        spawnStatuses,
        leadActivity,
        leadContext,
        pendingApprovalAgents,
        activeTools,
        finishedVisible,
        toolHistory,
        commentReadState,
        provisioningProgress,
        memberSpawnSnapshot,
        slotAssignments
      ),
    [
      teamData,
      teamName,
      spawnStatuses,
      leadActivity,
      leadContext,
      pendingApprovalAgents,
      activeTools,
      finishedVisible,
      toolHistory,
      commentReadState,
      provisioningProgress,
      memberSpawnSnapshot,
      slotAssignments,
    ]
  );
}
