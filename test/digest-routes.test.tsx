import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let dir: string;
let app: ReturnType<typeof createApp>;

const line = (o: object) => JSON.stringify(o);
const normal = [
  line({ at: '2026-10-30T01:00:00+01:00', job: 'backup', status: 'ok', owner: 'sam' }),
  line({ at: '2026-10-30T01:10:00+01:00', job: 'sync', status: 'retry', owner: 'kim', error: 'timeout' }),
  line({ at: '2026-10-30T01:20:00+01:00', job: 'sync', status: 'fail', owner: 'kim', error: 'gave up' }),
  line({ at: '2026-10-30T02:00:00+01:00', job: 'archive', status: 'ok', owner: null }),
].join('\n');

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  writeFileSync(join(dir, '2026-10-30.jsonl'), normal + '\n');
  writeFileSync(join(dir, '2026-10-31.jsonl'), '');
  writeFileSync(
    join(dir, '2026-11-01.jsonl'),
    [
      line({ at: '2026-11-01T01:00:00+01:00', job: 'backup', status: 'ok', owner: 'sam' }),
      '{not json',
      line({ at: '2026-11-01T01:05:00+01:00', job: 'sync', status: 'ok', owner: 'kim' }),
    ].join('\n') + '\n',
  );
  app = createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir: dir,
  });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Json = { night: string; rows: { job: string; runs: number; retries: number; lastStatus: string }[]; badLines: number };
const getJson = async (night: string) => {
  const res = await app.request(`/api/digest/${night}`);
  return { res, body: (await res.json()) as Json };
};

describe('digest routes', () => {
  it('200 for a normal night', async () => {
    const page = await app.request('/digest/2026-10-30');
    const html = await page.text();
    expect(page.status).toBe(200);
    for (const job of ['backup', 'sync', 'archive']) expect(html).toContain(job);

    const { res, body } = await getJson('2026-10-30');
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => [r.job, r.runs, r.retries, r.lastStatus])).toEqual([
      ['archive', 1, 0, 'ok'],
      ['backup', 1, 0, 'ok'],
      ['sync', 2, 1, 'fail'],
    ]);
  });

  it('404 for a night with no file', async () => {
    const page = await app.request('/digest/2026-01-01');
    expect(page.status).toBe(404);
    const { res, body } = await getJson('2026-01-01');
    expect(res.status).toBe(404);
    expect(body).toMatchObject({ error: 'no run log' });
  });

  it('empty file is 200 with nothing ran', async () => {
    const page = await app.request('/digest/2026-10-31');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');
    const { res, body } = await getJson('2026-10-31');
    expect(res.status).toBe(200);
    expect(body.rows).toEqual([]);
  });

  it('a bad line is skipped and counted', async () => {
    const page = await app.request('/digest/2026-11-01');
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('1 bad line(s) skipped');
    expect(html).toContain('backup');
    expect(html).toContain('sync');

    const { res, body } = await getJson('2026-11-01');
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['backup', 'sync']);
  });

  it('page and JSON list the same jobs in the same order', async () => {
    for (const night of ['2026-10-30', '2026-11-01']) {
      const html = await (await app.request(`/digest/${night}`)).text();
      const { body } = await getJson(night);
      const inPage = [...html.matchAll(/<tr[^>]*><td>([^<]*)<\/td>/g)].map((m) => m[1]);
      expect(inPage).toEqual(body.rows.map((r) => r.job));
    }
  });
});
