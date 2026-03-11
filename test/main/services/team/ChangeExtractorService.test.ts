import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as fs from 'fs/promises';

import { ChangeExtractorService } from '../../../../src/main/services/team/ChangeExtractorService';
import { setClaudeBasePathOverride } from '../../../../src/main/utils/pathDecoder';

describe('ChangeExtractorService', () => {
  let tmpDir: string | null = null;

  afterEach(async () => {
    setClaudeBasePathOverride(null);
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('does not reuse detailed task-change cache across different scope inputs', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'change-extractor-service-'));
    setClaudeBasePathOverride(tmpDir);

    const aliceLogPath = path.join(tmpDir, 'alice.jsonl');
    await fs.writeFile(
      aliceLogPath,
      JSON.stringify({
        timestamp: '2026-03-01T10:00:00.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'Write',
              input: { file_path: '/repo/src/file.ts', content: 'export const value = 1;\n' },
            },
          ],
        },
      }) + '\n',
      'utf8'
    );

    const findLogsForTask = vi.fn(async (_teamName: string, _taskId: string, options?: any) =>
      options?.owner === 'alice' ? [{ filePath: aliceLogPath, memberName: 'alice' }] : []
    );
    const parseBoundaries = vi.fn(async () => ({
      boundaries: [],
      scopes: [],
      isSingleTaskSession: true,
      detectedMechanism: 'none' as const,
    }));
    const service = new ChangeExtractorService(
      {
        findLogsForTask,
        findMemberLogPaths: vi.fn(async () => []),
      } as any,
      { parseBoundaries } as any,
      { getConfig: vi.fn(async () => ({ projectPath: '/repo' })) } as any
    );

    const empty = await service.getTaskChanges('team-a', '1', { owner: 'bob', status: 'completed' });
    const populated = await service.getTaskChanges('team-a', '1', {
      owner: 'alice',
      status: 'completed',
    });

    expect(empty.files).toHaveLength(0);
    expect(populated.files).toHaveLength(1);
    expect(findLogsForTask).toHaveBeenCalledTimes(2);
  });

  it('merges fallback changes for the same Windows file across slash variants', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'change-extractor-service-'));
    setClaudeBasePathOverride(tmpDir);

    const firstLogPath = path.join(tmpDir, 'first.jsonl');
    const secondLogPath = path.join(tmpDir, 'second.jsonl');
    await fs.writeFile(
      firstLogPath,
      JSON.stringify({
        timestamp: '2026-03-01T10:00:00.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'Write',
              input: { file_path: 'C:\\repo\\src\\same.ts', content: 'first\n' },
            },
          ],
        },
      }) + '\n',
      'utf8'
    );
    await fs.writeFile(
      secondLogPath,
      JSON.stringify({
        timestamp: '2026-03-01T10:01:00.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-2',
              name: 'Write',
              input: { file_path: 'C:/repo/src/same.ts', content: 'second\n' },
            },
          ],
        },
      }) + '\n',
      'utf8'
    );

    const service = new ChangeExtractorService(
      {
        findLogsForTask: vi.fn(async () => [
          { filePath: firstLogPath, memberName: 'alice' },
          { filePath: secondLogPath, memberName: 'alice' },
        ]),
        findMemberLogPaths: vi.fn(async () => []),
      } as any,
      {
        parseBoundaries: vi.fn(async () => ({
          boundaries: [],
          scopes: [],
          isSingleTaskSession: true,
          detectedMechanism: 'none' as const,
        })),
      } as any,
      { getConfig: vi.fn(async () => ({ projectPath: 'C:\\repo' })) } as any
    );

    const result = await service.getTaskChanges('team-a', '1', {
      owner: 'alice',
      status: 'completed',
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.relativePath).toBe('src/same.ts');
    expect(result.totalLinesAdded).toBe(2);
  });
});
