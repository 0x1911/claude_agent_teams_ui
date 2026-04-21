import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';

import { TaskChangeLedgerReader } from '@main/services/team/TaskChangeLedgerReader';

const TASK_ID = 'task-1';

describe('TaskChangeLedgerReader', () => {
  let tmpDir: string | null = null;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('returns warning-only notice bundles even when no file events exist', async () => {
    tmpDir = await makeLedgerBundle({
      events: [],
      notices: [
        {
          schemaVersion: 1,
          noticeId: 'notice-1',
          taskId: TASK_ID,
          taskRef: TASK_ID,
          taskRefKind: 'canonical',
          phase: 'work',
          executionSeq: 1,
          sessionId: 'session-1',
          toolUseId: 'tool-1',
          timestamp: '2026-03-01T10:00:00.000Z',
          severity: 'warning',
          message:
            'Task change ledger skipped attribution because multiple task scopes were active.',
        },
      ],
    });

    const reader = new TaskChangeLedgerReader();
    const result = await reader.readTaskChanges({
      teamName: 'team',
      taskId: TASK_ID,
      projectDir: tmpDir,
      includeDetails: true,
    });

    expect(result).not.toBeNull();
    expect(result?.files).toEqual([]);
    expect(result?.warnings).toContain(
      'Task change ledger skipped attribution because multiple task scopes were active.'
    );
    expect(result?.scope.toolUseIds).toEqual(['tool-1']);
  });

  it('maps ledger state and rename relation into snippets', async () => {
    tmpDir = await makeLedgerBundle({
      events: [
        {
          schemaVersion: 1,
          eventId: 'event-1',
          taskId: TASK_ID,
          taskRef: TASK_ID,
          taskRefKind: 'canonical',
          phase: 'work',
          executionSeq: 1,
          sessionId: 'session-1',
          toolUseId: 'tool-1',
          source: 'shell_snapshot',
          operation: 'modify',
          confidence: 'high',
          workspaceRoot: '/repo',
          filePath: '/repo/src/new.ts',
          relativePath: 'src/new.ts',
          timestamp: '2026-03-01T10:00:00.000Z',
          toolStatus: 'succeeded',
          before: null,
          after: null,
          beforeState: { exists: true, unavailableReason: 'binary file' },
          afterState: { exists: true, unavailableReason: 'binary file' },
          relation: { kind: 'rename', oldPath: 'src/old.ts', newPath: 'src/new.ts' },
          linesAdded: 0,
          linesRemoved: 0,
        },
      ],
    });

    const reader = new TaskChangeLedgerReader();
    const result = await reader.readTaskChanges({
      teamName: 'team',
      taskId: TASK_ID,
      projectDir: tmpDir,
      projectPath: '/repo',
      includeDetails: true,
    });

    const snippet = result?.files[0]?.snippets[0];
    expect(snippet?.ledger?.beforeState?.unavailableReason).toBe('binary file');
    expect(snippet?.ledger?.relation).toEqual({
      kind: 'rename',
      oldPath: 'src/old.ts',
      newPath: 'src/new.ts',
    });
    expect(result?.files[0]?.relativePath).toBe('src/new.ts');
  });

  it('groups rename relations in summary-only bundles without losing absolute paths', async () => {
    const relation = { kind: 'rename', oldPath: 'src/old.ts', newPath: 'src/new.ts' };
    tmpDir = await makeLedgerBundle({
      events: [
        {
          schemaVersion: 1,
          eventId: 'event-old',
          taskId: TASK_ID,
          taskRef: TASK_ID,
          taskRefKind: 'canonical',
          phase: 'work',
          executionSeq: 1,
          sessionId: 'session-1',
          toolUseId: 'tool-1',
          source: 'shell_snapshot',
          operation: 'delete',
          confidence: 'high',
          workspaceRoot: '/repo',
          filePath: '/repo/src/old.ts',
          relativePath: 'src/old.ts',
          timestamp: '2026-03-01T10:00:00.000Z',
          toolStatus: 'succeeded',
          before: null,
          after: null,
          relation,
          linesAdded: 0,
          linesRemoved: 2,
        },
        {
          schemaVersion: 1,
          eventId: 'event-new',
          taskId: TASK_ID,
          taskRef: TASK_ID,
          taskRefKind: 'canonical',
          phase: 'work',
          executionSeq: 1,
          sessionId: 'session-1',
          toolUseId: 'tool-1',
          source: 'shell_snapshot',
          operation: 'create',
          confidence: 'high',
          workspaceRoot: '/repo',
          filePath: '/repo/src/new.ts',
          relativePath: 'src/new.ts',
          timestamp: '2026-03-01T10:00:01.000Z',
          toolStatus: 'succeeded',
          before: null,
          after: null,
          relation,
          linesAdded: 3,
          linesRemoved: 0,
        },
      ],
    });

    const reader = new TaskChangeLedgerReader();
    const result = await reader.readTaskChanges({
      teamName: 'team',
      taskId: TASK_ID,
      projectDir: tmpDir,
      projectPath: '/repo',
      includeDetails: false,
    });

    expect(result?.files).toHaveLength(1);
    expect(result?.files[0]?.filePath).toBe('/repo/src/new.ts');
    expect(result?.files[0]?.relativePath).toBe('src/new.ts');
    expect(result?.files[0]?.isNewFile).toBe(false);
    expect(result?.files[0]?.linesAdded).toBe(3);
    expect(result?.files[0]?.linesRemoved).toBe(2);
  });
});

async function makeLedgerBundle(params: {
  events: unknown[];
  notices?: unknown[];
}): Promise<string> {
  const dir = await fsTempDir();
  const bundleDir = path.join(dir, '.board-task-changes', 'bundles');
  await mkdir(bundleDir, { recursive: true });
  await writeFile(
    path.join(bundleDir, `${encodeURIComponent(TASK_ID)}.json`),
    JSON.stringify({
      schemaVersion: 1,
      source: 'task-change-ledger',
      taskId: TASK_ID,
      generatedAt: '2026-03-01T10:00:00.000Z',
      eventCount: params.events.length,
      files: params.events.map((event: any) => ({
        filePath: event.filePath,
        relativePath: event.relativePath,
        eventIds: [event.eventId],
        linesAdded: event.linesAdded ?? 0,
        linesRemoved: event.linesRemoved ?? 0,
        isNewFile: event.operation === 'create',
        latestAfterHash: event.after?.sha256 ?? null,
      })),
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
      totalFiles: params.events.length,
      confidence: 'high',
      warnings: [],
      events: params.events,
      ...(params.notices ? { notices: params.notices } : {}),
    }),
    'utf8'
  );
  return dir;
}

async function fsTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'ledger-reader-'));
}
