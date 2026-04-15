import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetRecentProjectsClientCacheForTests,
  getRecentProjectsClientSnapshot,
  loadRecentProjectsWithClientCache,
} from '@features/recent-projects/renderer/utils/recentProjectsClientCache';

import type { DashboardRecentProject } from '@features/recent-projects/contracts';

const project = (id: string): DashboardRecentProject => ({
  id,
  name: id,
  primaryPath: `/tmp/${id}`,
  associatedPaths: [`/tmp/${id}`],
  mostRecentActivity: Date.parse('2026-04-14T12:00:00.000Z'),
  providerIds: ['anthropic'],
  source: 'claude',
  openTarget: {
    type: 'synthetic-path',
    path: `/tmp/${id}`,
  },
});

describe('recentProjectsClientCache', () => {
  afterEach(() => {
    __resetRecentProjectsClientCacheForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns cached projects while the client cache is fresh', async () => {
    const loader = vi.fn().mockResolvedValue([project('alpha')]);

    await expect(loadRecentProjectsWithClientCache(loader)).resolves.toEqual([project('alpha')]);
    await expect(loadRecentProjectsWithClientCache(loader)).resolves.toEqual([project('alpha')]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(getRecentProjectsClientSnapshot()?.projects).toEqual([project('alpha')]);
  });

  it('revalidates stale cache without dropping the previous snapshot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T12:00:00.000Z'));

    const loader = vi
      .fn<() => Promise<DashboardRecentProject[]>>()
      .mockResolvedValueOnce([project('alpha')])
      .mockResolvedValueOnce([project('beta')]);

    await loadRecentProjectsWithClientCache(loader);
    vi.setSystemTime(new Date('2026-04-14T12:00:16.000Z'));

    expect(getRecentProjectsClientSnapshot()).toMatchObject({
      projects: [project('alpha')],
      isStale: true,
    });

    await expect(loadRecentProjectsWithClientCache(loader, { force: true })).resolves.toEqual([
      project('beta'),
    ]);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(getRecentProjectsClientSnapshot()).toMatchObject({
      projects: [project('beta')],
      isStale: false,
    });
  });

  it('deduplicates concurrent client refreshes', async () => {
    const resolveLoaderRef: {
      current: ((projects: DashboardRecentProject[]) => void) | null;
    } = {
      current: null,
    };
    const loader = vi.fn(
      () =>
        new Promise<DashboardRecentProject[]>((resolve) => {
          resolveLoaderRef.current = resolve;
        })
    );

    const first = loadRecentProjectsWithClientCache(loader, { force: true });
    const second = loadRecentProjectsWithClientCache(loader, { force: true });

    expect(loader).toHaveBeenCalledTimes(1);

    resolveLoaderRef.current?.([project('alpha')]);

    await expect(first).resolves.toEqual([project('alpha')]);
    await expect(second).resolves.toEqual([project('alpha')]);
  });
});
