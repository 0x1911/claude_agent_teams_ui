import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStore } from '@renderer/store';

import type { ResolvedTeamMember, TeamTaskWithKanban } from '@shared/types';

vi.mock('@renderer/hooks/useMemberStats', () => ({
  useMemberStats: () => ({
    stats: null,
    loading: false,
    error: null,
  }),
}));

vi.mock('@renderer/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) =>
    React.createElement(
      'button',
      {
        type: 'button',
        onClick,
      },
      children
    ),
}));

vi.mock('@renderer/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  DialogContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('@renderer/components/ui/tabs', () => {
  let currentValue = '';
  let currentOnValueChange: ((value: string) => void) | null = null;

  return {
    Tabs: ({
      children,
      value,
      onValueChange,
    }: {
      children: React.ReactNode;
      value: string;
      onValueChange?: (value: string) => void;
    }) => {
      currentValue = value;
      currentOnValueChange = onValueChange ?? null;
      return React.createElement('div', { 'data-tabs-value': value }, children);
    },
    TabsList: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    TabsTrigger: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: string;
    }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          'data-state': currentValue === value ? 'active' : 'inactive',
          onClick: () => currentOnValueChange?.(value),
        },
        children
      ),
    TabsContent: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: string;
    }) => (currentValue === value ? React.createElement('div', null, children) : null),
  };
});

vi.mock('@renderer/components/team/members/MemberDetailHeader', () => ({
  MemberDetailHeader: () => React.createElement('div', null, 'header'),
}));

vi.mock('@renderer/components/team/members/MemberDetailStats', () => ({
  MemberDetailStats: ({ activityCount }: { activityCount: number }) =>
    React.createElement('div', { 'data-testid': 'member-detail-stats' }, `activity-count:${activityCount}`),
}));

vi.mock('@renderer/components/team/members/MemberTasksTab', () => ({
  MemberTasksTab: () => React.createElement('div', null, 'tasks-tab'),
}));

vi.mock('@renderer/components/team/members/MemberMessagesTab', () => ({
  MemberMessagesTab: () => React.createElement('div', null, 'activity-tab'),
}));

vi.mock('@renderer/components/team/members/MemberStatsTab', () => ({
  MemberStatsTab: () => React.createElement('div', null, 'stats-tab'),
}));

vi.mock('@renderer/components/team/members/MemberLogsTab', () => ({
  MemberLogsTab: () => React.createElement('div', null, 'logs-tab'),
}));

import { MemberDetailDialog } from '@renderer/components/team/members/MemberDetailDialog';

describe('MemberDetailDialog activity count', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useStore.setState({
      teamMessagesByName: {
        'demo-team': {
          canonicalMessages: [],
          optimisticMessages: [],
          feedRevision: 'rev-empty',
          nextCursor: null,
          hasMore: false,
          lastFetchedAt: null,
          loadingHead: false,
          loadingOlder: false,
          headHydrated: true,
        },
      },
    } as never);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    useStore.setState({ teamMessagesByName: {} } as never);
    vi.unstubAllGlobals();
  });

  it('counts task comments in the Activity badge even when messageCount is zero', async () => {
    const member: ResolvedTeamMember = {
      name: 'jack',
      status: 'active',
      currentTaskId: null,
      taskCount: 1,
      lastActiveAt: null,
      messageCount: 0,
    };
    const members: ResolvedTeamMember[] = [
      {
        name: 'team-lead',
        status: 'active',
        currentTaskId: null,
        taskCount: 0,
        lastActiveAt: null,
        messageCount: 0,
        agentType: 'team-lead',
      },
      member,
    ];
    const tasks: TeamTaskWithKanban[] = [
      {
        id: 'task-1',
        displayId: '#1',
        subject: 'Review patch',
        owner: 'jack',
        status: 'in_progress',
        comments: [
          {
            id: 'comment-1',
            author: 'jack',
            text: 'Left a review note',
            createdAt: '2026-04-17T10:00:00.000Z',
            type: 'regular',
          },
        ],
        reviewState: 'none',
      } as TeamTaskWithKanban,
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(MemberDetailDialog, {
          open: true,
          member,
          teamName: 'demo-team',
          members,
          tasks,
          onClose: () => undefined,
          onSendMessage: () => undefined,
          onAssignTask: () => undefined,
          onTaskClick: () => undefined,
        })
      );
      await Promise.resolve();
    });

    expect(host.textContent).toContain('activity-count:1');
    expect(host.textContent).toContain('Activity1');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });
});
