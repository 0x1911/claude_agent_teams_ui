const STORAGE_PREFIX = 'team-messages-read:';

function storageKey(teamName: string): string {
  return `${STORAGE_PREFIX}${teamName}`;
}

export function getReadSet(teamName: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(teamName));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export function markRead(teamName: string, messageKey: string): void {
  const set = getReadSet(teamName);
  if (set.has(messageKey)) return;
  set.add(messageKey);
  try {
    localStorage.setItem(storageKey(teamName), JSON.stringify([...set]));
  } catch {
    // quota or disabled
  }
}
