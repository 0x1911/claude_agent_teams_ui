import type { TeamColorSet } from '@renderer/constants/teamColors';

function hashStringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ((hash % 360) + 360) % 360;
}

export interface ProjectColorSet {
  border: string;
  glow: string;
  icon: string;
  text: string;
}

export function projectColor(name: string): ProjectColorSet {
  const hue = hashStringToHue(name);
  return {
    border: `hsla(${hue}, 70%, 55%, 0.5)`,
    glow: `hsla(${hue}, 70%, 55%, 0.06)`,
    icon: `hsla(${hue}, 70%, 65%, 0.8)`,
    text: `hsla(${hue}, 40%, 65%, 0.55)`,
  };
}

/** Generate a TeamColorSet from any name (deterministic hue). */
export function nameColorSet(name: string): TeamColorSet {
  const hue = hashStringToHue(name);
  return {
    border: `hsl(${hue}, 70%, 55%)`,
    badge: `hsla(${hue}, 70%, 55%, 0.08)`,
    text: `hsla(${hue}, 35%, 70%, 0.55)`,
  };
}
