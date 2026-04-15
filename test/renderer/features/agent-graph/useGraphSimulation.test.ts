import { describe, expect, it, vi } from 'vitest';

import {
  buildStableSlotLayoutSnapshot,
  computeOwnerFootprints,
  resolveNearestSlotAssignment,
  snapshotToWorldBounds,
  validateStableSlotLayout,
} from '../../../../packages/agent-graph/src/layout/stableSlots';
import { STABLE_SLOT_GEOMETRY } from '../../../../packages/agent-graph/src/layout/stableSlotGeometry';
import { ACTIVITY_ANCHOR_LAYOUT } from '../../../../packages/agent-graph/src/layout/activityLane';

import type { GraphLayoutPort, GraphNode } from '@claude-teams/agent-graph';

function createLead(teamName: string): GraphNode {
  return {
    id: `lead:${teamName}`,
    kind: 'lead',
    label: `${teamName}-lead`,
    state: 'active',
    domainRef: { kind: 'lead', teamName, memberName: 'lead' },
  };
}

function createMember(teamName: string, stableOwnerId: string, memberName: string): GraphNode {
  return {
    id: `member:${teamName}:${stableOwnerId}`,
    kind: 'member',
    label: memberName,
    state: 'active',
    domainRef: { kind: 'member', teamName, memberName },
  };
}

function createTask(
  teamName: string,
  taskId: string,
  ownerId?: string | null,
  overrides?: Partial<GraphNode>
): GraphNode {
  return {
    id: `task:${taskId}`,
    kind: 'task',
    label: `#${taskId}`,
    displayId: `#${taskId}`,
    state: 'idle',
    ownerId: ownerId ?? null,
    taskStatus: 'pending',
    domainRef: { kind: 'task', teamName, taskId },
    ...overrides,
  };
}

describe('stable slot layout planner', () => {
  it('does not build a stable slot snapshot when the lead is missing', () => {
    const snapshot = buildStableSlotLayoutSnapshot({
      teamName: 'team-no-lead',
      nodes: [createMember('team-no-lead', 'agent-alice', 'alice')],
      layout: {
        version: 'stable-slots-v1',
        ownerOrder: ['member:team-no-lead:agent-alice'],
        slotAssignments: {
          'member:team-no-lead:agent-alice': { ringIndex: 0, sectorIndex: 1 },
        },
      },
    });

    expect(snapshot).toBeNull();
  });

  it('builds launch and activity geometry around the central lead block', () => {
    const teamName = 'team-a';
    const lead = createLead(teamName);
    const alice = createMember(teamName, 'agent-alice', 'alice');
    const layout: GraphLayoutPort = {
      version: 'stable-slots-v1',
      ownerOrder: [alice.id],
      slotAssignments: {
        [alice.id]: { ringIndex: 0, sectorIndex: 1 },
      },
    };

    const snapshot = buildStableSlotLayoutSnapshot({
      teamName,
      nodes: [lead, alice],
      layout,
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.leadNodeId).toBe(lead.id);
    expect(snapshot?.launchAnchor).not.toBeNull();
    expect(snapshot?.memberSlotFrames).toHaveLength(1);
    expect(snapshot?.memberSlotFrames[0]?.ownerId).toBe(alice.id);
    expect(snapshot?.leadActivityRect.left).toBeLessThan(snapshot?.leadCoreRect.left ?? 0);
    expect(snapshot?.fitBounds.right).toBeGreaterThan(snapshot?.leadCoreRect.right ?? 0);
    expect(validateStableSlotLayout(snapshot!)).toEqual({ valid: true });
  });

  it('keeps a fixed process rail width centered inside the owner slot', () => {
    const teamName = 'team-process-width';
    const lead = createLead(teamName);
    const alice = createMember(teamName, 'agent-alice', 'alice');
    const layout: GraphLayoutPort = {
      version: 'stable-slots-v1',
      ownerOrder: [alice.id],
      slotAssignments: {
        [alice.id]: { ringIndex: 0, sectorIndex: 1 },
      },
    };

    const snapshot = buildStableSlotLayoutSnapshot({
      teamName,
      nodes: [lead, alice],
      layout,
    });

    const frame = snapshot?.memberSlotFrames[0];
    expect(frame).toBeDefined();
    expect(frame?.processBandRect.width).toBe(STABLE_SLOT_GEOMETRY.processRailWidth);
    expect(frame?.processBandRect.left).toBeCloseTo(
      (frame?.bounds.left ?? 0) + ((frame?.bounds.width ?? 0) - STABLE_SLOT_GEOMETRY.processRailWidth) / 2,
      6
    );
  });

  it('includes full topology bounds for fit, not only activity overlays', () => {
    const teamName = 'team-fit';
    const lead = createLead(teamName);
    const alice = createMember(teamName, 'agent-alice', 'alice');
    const layout: GraphLayoutPort = {
      version: 'stable-slots-v1',
      ownerOrder: [alice.id],
      slotAssignments: {
        [alice.id]: { ringIndex: 0, sectorIndex: 1 },
      },
    };

    const snapshot = buildStableSlotLayoutSnapshot({
      teamName,
      nodes: [lead, alice],
      layout,
    });

    const bounds = snapshotToWorldBounds(snapshot!);
    expect(bounds[0]).toEqual({
      left: snapshot!.fitBounds.left,
      top: snapshot!.fitBounds.top,
      right: snapshot!.fitBounds.right,
      bottom: snapshot!.fitBounds.bottom,
    });
  });

  it('rejects invalid overlapping slot frames in validation pass', () => {
    const teamName = 'team-invalid';
    const lead = createLead(teamName);
    const alice = createMember(teamName, 'agent-alice', 'alice');
    const bob = createMember(teamName, 'agent-bob', 'bob');
    const layout: GraphLayoutPort = {
      version: 'stable-slots-v1',
      ownerOrder: [alice.id, bob.id],
      slotAssignments: {
        [alice.id]: { ringIndex: 0, sectorIndex: 1 },
        [bob.id]: { ringIndex: 0, sectorIndex: 2 },
      },
    };

    const snapshot = buildStableSlotLayoutSnapshot({
      teamName,
      nodes: [lead, alice, bob],
      layout,
    });

    expect(snapshot).not.toBeNull();
    const [firstFrame] = snapshot!.memberSlotFrames;
    const invalid = {
      ...snapshot!,
      memberSlotFrames: snapshot!.memberSlotFrames.map((frame, index) =>
        index === 1
          ? {
              ...frame,
              bounds: firstFrame.bounds,
            }
          : frame
      ),
    };

    expect(validateStableSlotLayout(invalid).valid).toBe(false);
  });

  it('prefers the occupied target slot when dragging near another owner anchor', () => {
    const teamName = 'team-b';
    const lead = createLead(teamName);
    const alice = createMember(teamName, 'agent-alice', 'alice');
    const bob = createMember(teamName, 'agent-bob', 'bob');
    const layout: GraphLayoutPort = {
      version: 'stable-slots-v1',
      ownerOrder: [alice.id, bob.id],
      slotAssignments: {
        [alice.id]: { ringIndex: 0, sectorIndex: 1 },
        [bob.id]: { ringIndex: 0, sectorIndex: 2 },
      },
    };

    const snapshot = buildStableSlotLayoutSnapshot({
      teamName,
      nodes: [lead, alice, bob],
      layout,
    });

    expect(snapshot).not.toBeNull();
    const bobFrame = snapshot?.memberSlotFrames.find((frame) => frame.ownerId === bob.id);
    expect(bobFrame).toBeDefined();

    const nearest = resolveNearestSlotAssignment({
      ownerId: alice.id,
      ownerX: bobFrame?.ownerX ?? 0,
      ownerY: bobFrame?.ownerY ?? 0,
      nodes: [lead, alice, bob],
      snapshot: snapshot!,
      layout,
    });

    expect(nearest).not.toBeNull();
    expect(nearest?.assignment).toEqual({ ringIndex: 0, sectorIndex: 2 });
    expect(nearest?.displacedOwnerId).toBe(bob.id);
    expect(nearest?.displacedAssignment).toEqual({ ringIndex: 0, sectorIndex: 1 });
  });

  it('treats tasks with missing owner nodes as unassigned topology actors', () => {
    const teamName = 'team-orphan-task';
    const lead = createLead(teamName);
    const alice = createMember(teamName, 'agent-alice', 'alice');
    const orphanTask = createTask(teamName, 'task-orphan', 'member:team-orphan-task:agent-missing');
    const layout: GraphLayoutPort = {
      version: 'stable-slots-v1',
      ownerOrder: [alice.id],
      slotAssignments: {
        [alice.id]: { ringIndex: 0, sectorIndex: 1 },
      },
    };

    const snapshot = buildStableSlotLayoutSnapshot({
      teamName,
      nodes: [lead, alice, orphanTask],
      layout,
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.unassignedTaskRect).not.toBeNull();
  });

  it('computes the next ring radius from previous ring depth, not member count', () => {
    const teamName = 'team-ring-depth';
    const lead = createLead(teamName);
    const members = Array.from({ length: 7 }, (_, index) =>
      createMember(teamName, `agent-${index + 1}`, `member-${index + 1}`)
    );
    const layout: GraphLayoutPort = {
      version: 'stable-slots-v1',
      ownerOrder: members.map((member) => member.id),
      slotAssignments: Object.fromEntries(
        members.map((member, index) => [
          member.id,
          {
            ringIndex: index < 6 ? 0 : 1,
            sectorIndex: index % 6,
          },
        ])
      ),
    };

    const snapshot = buildStableSlotLayoutSnapshot({
      teamName,
      nodes: [lead, ...members],
      layout,
    });
    const footprints = computeOwnerFootprints([lead, ...members], layout);
    const firstRingFrame = snapshot?.memberSlotFrames.find(
      (frame) => frame.ringIndex === 0 && frame.sectorIndex === 0
    );
    const secondRingFrame = snapshot?.memberSlotFrames.find(
      (frame) => frame.ringIndex === 1 && frame.sectorIndex === 0
    );

    expect(snapshot).not.toBeNull();
    expect(firstRingFrame).toBeDefined();
    expect(secondRingFrame).toBeDefined();
    const firstFootprint = footprints[0];
    expect(firstFootprint).toBeDefined();
    if (!firstFootprint) {
      throw new Error('expected first footprint for ring-depth test');
    }

    const ringDelta = Math.hypot(secondRingFrame!.ownerX, secondRingFrame!.ownerY)
      - Math.hypot(firstRingFrame!.ownerX, firstRingFrame!.ownerY);
    const ownerAnchorOffsetY =
      STABLE_SLOT_GEOMETRY.memberSlotInnerPadding +
      ACTIVITY_ANCHOR_LAYOUT.reservedHeight +
      STABLE_SLOT_GEOMETRY.slotVerticalGap +
      STABLE_SLOT_GEOMETRY.ownerBandHeight / 2;
    const expectedRingDelta =
      ownerAnchorOffsetY +
      (firstFootprint.slotHeight - ownerAnchorOffsetY) +
      STABLE_SLOT_GEOMETRY.ringGap;

    expect(ringDelta).toBeCloseTo(expectedRingDelta, 6);
  });

  it('keeps the same sector and spills to the next outer ring when the saved slot is already occupied', () => {
    const teamName = 'team-wide-spill';
    const lead = createLead(teamName);
    const narrow = createMember(teamName, 'agent-narrow', 'narrow');
    const wide = createMember(teamName, 'agent-wide', 'wide');
    const wideTasks = [
      createTask(teamName, 'todo', wide.id, { taskStatus: 'pending' }),
      createTask(teamName, 'wip', wide.id, { taskStatus: 'in_progress' }),
      createTask(teamName, 'done', wide.id, { taskStatus: 'completed' }),
      createTask(teamName, 'review', wide.id, { reviewState: 'review' }),
      createTask(teamName, 'approved', wide.id, { reviewState: 'approved' }),
    ];
    const layout: GraphLayoutPort = {
      version: 'stable-slots-v1',
      ownerOrder: [narrow.id, wide.id],
      slotAssignments: {
        [narrow.id]: { ringIndex: 0, sectorIndex: 1 },
        [wide.id]: { ringIndex: 0, sectorIndex: 1 },
      },
    };

    const snapshot = buildStableSlotLayoutSnapshot({
      teamName,
      nodes: [lead, narrow, wide, ...wideTasks],
      layout,
    });
    const wideFrame = snapshot?.memberSlotFrames.find((frame) => frame.ownerId === wide.id);
    const warnMock = vi.mocked(console.warn);

    expect(snapshot).not.toBeNull();
    expect(wideFrame).toBeDefined();
    expect(wideFrame?.ringIndex).toBe(1);
    expect(wideFrame?.sectorIndex).toBe(1);
    expect(warnMock.mock.calls).toHaveLength(1);
    warnMock.mockClear();
  });
});
