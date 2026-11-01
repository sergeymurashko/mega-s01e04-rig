import { readdirSync, readFileSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { join } from 'node:path';
import { lastBeat, type Beat } from './heartbeat.js';

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightCounts[];
};

export type NightCounts = { night: string; ok: number; retry: number; fail: number };


// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// Counts run lines by status in runs/<night>.jsonl. Bad lines are skipped.
export function nightCounts(runsDir: string, night: string): NightCounts {
  const counts: NightCounts = { night, ok: 0, retry: 0, fail: 0 };
  let text = '';
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch {
    return counts;
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      const status =
        typeof parsed === 'object' && parsed !== null ? (parsed as { status?: unknown }).status : undefined;
      if (status === 'ok' || status === 'retry' || status === 'fail') counts[status]++;
    } catch {
      // bad line: skipped
    }
  }
  return counts;
}

export function readStatus(config: RigConfig): Status {
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights: nightsOnDisk(config.runsDir).map((n) => nightCounts(config.runsDir, n)),
  };
}
