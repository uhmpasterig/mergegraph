import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import { GET, clean, levels, range, render, weekly } from './api/graph.ts';

test('GET rejects invalid params before any fetch', async () => {
  for (const qs of ['user=../etc', 'user=octo&year=1999', 'user=octo&theme=pink', 'user=octo&years=3']) {
    assert.equal((await GET(new Request(`http://mock/api/graph?${qs}`))).status, 400);
  }
});

test('clean keeps only date → positive integer', () => {
  const raw = {
    '2024-01-02': 3, '2024-01-03': '<script>', x: 1, '2024-01-04': -1, '2024-01-05': 1.5, '2024-01-06': 0,
    '0050-01-01': 9, '2007-12-31': 1, '2024-02-30': 1, // no year rows back to antiquity, no impossible dates
  };
  assert.deepEqual(clean(raw), { '2024-01-02': 3 });
  assert.deepEqual(clean([1, 2]), {});
  assert.deepEqual(clean(null), {});
});

test('GET asks GitHub for whole calendar years and maps its errors', async () => {
  const real = globalThis.fetch;
  const queries: string[] = [];
  const aliases = (q: string) => [...q.matchAll(/y(\d{4}):/g)].map((m) => m[1]);
  const cal = { contributionCalendar: { weeks: [{ contributionDays: [{ date: '2024-03-04', contributionCount: 5 }] }] } };
  let reply: (query: string) => unknown = () => ({});
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith('https://raw.githubusercontent.com/')) return new Response('', { status: 404 });
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    queries.push(query);
    return Response.json(reply(query));
  }) as typeof fetch;
  try {
    reply = (q) =>
      q.includes('contributionYears')
        ? { data: { user: { contributionsCollection: { contributionYears: [2024, 2019] } } } }
        : { data: { user: Object.fromEntries(aliases(q).map((y) => [`y${y}`, cal])) } };
    const res = await GET(new Request('http://mock/api/graph?user=octo&years=all&theme=night'));
    assert.equal(res.status, 200);
    assert.match(await res.text(), />2024<\/text>/);
    assert.deepEqual(aliases(queries[1]), ['2024', '2019']);
    assert.match(queries[0], /contributionYears/);
    await GET(new Request('http://mock/api/graph?user=octo&year=2024'));
    assert.deepEqual(aliases(queries[2]), ['2024']);
    const now = new Date().getUTCFullYear();
    await GET(new Request('http://mock/api/graph?user=octo'));
    assert.deepEqual(aliases(queries[3]), [String(now - 1), String(now)]);

    reply = () => ({ data: { user: null }, errors: [{ type: 'NOT_FOUND', message: 'no such user' }] });
    assert.equal((await GET(new Request('http://mock/api/graph?user=octo&years=all'))).status, 404);
    reply = () => ({ errors: [{ type: 'RATE_LIMITED', message: 'slow down' }] });
    await assert.rejects(GET(new Request('http://mock/api/graph?user=octo')), /slow down/);
  } finally {
    globalThis.fetch = real;
  }
});

test('levels follow the quartiles of non-zero days', () => {
  const counts = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(counts.map(levels(counts)), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

test('range is a calendar year or the last 365 days', () => {
  assert.deepEqual(range(2024), { from: new Date('2024-01-01'), to: new Date('2024-12-31') });
  assert.deepEqual(range(null, new Date('2026-11-14T23:30:00Z')), {
    from: new Date('2025-11-15'),
    to: new Date('2026-11-14'),
  });
});

test('render adds both sources inside the range only', () => {
  const { from, to } = range(2024);
  const gh = { '2024-03-01': 2, '2023-12-31': 50 };
  const svg = render({ gh, ext: { '2024-03-01': 5, '2024-07-04': 1 }, from, to, label: 'in 2024', theme: 'light' });
  assert.match(svg, />8 contributions in 2024</);
  assert.match(svg, />GitHub 2 · GitLab 6</);
  assert.equal(svg.match(/<rect/g)?.length, 366 + 5);
  assert.equal(svg.match(/fill="#116329"/g)?.length, 2); // the 7-commit day and the legend
  assert.doesNotMatch(render({ gh, ext: {}, from, to, label: 'in 2024', theme: 'dark' }), /GitLab/);
});

test('weekly: from the first busy year up to `to`, sparse leading years dropped', () => {
  const all = { '2021-03-01': 1, '2023-01-01': 60, '2023-01-07': 40, '2023-01-08': 5, '2026-01-05': 200, '2026-12-01': 9 };
  const w = weekly(all, new Date('2026-11-14'))!;
  assert.equal(w.first, 2023); // 2021: 1 < 2 % of 200
  assert.deepEqual(w.weeks.slice(0, 2), [100, 5]); // 2023-01-01 is a Sunday: one week, then the next
  assert.equal(w.weeks.reduce((a, b) => a + b), 305); // nothing after `to`
  assert.equal(w.totals.get(2026), 200);
  assert.equal(weekly({}, new Date('2026-11-14')), null);
});

test('render: night card with stats, glow and a line with one stop per year', () => {
  const { from, to } = range(2028);
  const gh = { '2028-12-31': 4, '2027-06-01': 1, '2026-06-01': 3 };
  const svg = render({ gh, ext: { '2028-06-01': 2 }, from, to, label: 'in 2028', theme: 'night', years: true });
  assert.match(svg, /<rect width="100%" height="100%" fill="#172029"\/>/);
  assert.match(svg, /filter="url\(#glow\)"/);
  assert.match(svg, /font-size="34"[^>]*>6<\/text>/); // 2028: 4 on GitHub + 2 on GitLab
  assert.match(svg, />GitLab<\/text>.*>2<\/text>/);
  assert.match(svg, />Every week since 2026</);
  assert.equal(svg.match(/<circle/g)?.length, 3 + 1); // stops 2026, 2027, 2028, and today
  assert.match(svg, /fill="#f0b54d" stroke="#8a5806"/); // the current year's stop is lit
  assert.doesNotMatch(svg, />Less</); // the night card has no legend
  assert.doesNotMatch(render({ gh, ext: {}, from, to, label: 'in 2028', theme: 'night' }), />GitHub</); // no stats without GitLab
});

test('render labels the month in the second-to-last column', () => {
  const svg = render({ gh: {}, ext: {}, ...range(null, new Date('2026-11-14')), label: '', theme: 'light' });
  assert.match(svg, />Nov<\/text>/);
});

test('cli counts each own commit once and publishes it on the mergegraph branch', async () => {
  const commit = (id: string, email: string, date: string) => ({ id, author_email: email, authored_date: date });
  const a = commit('a', 'me@corp.test', '2024-03-01T23:30:00+01:00');
  // Keyed "<project> <ref_name> <author>"; author matches case-sensitively like git log --author.
  const commits: Record<string, object[]> = {
    '1 main me@corp.test': [a, commit('b', 'other@corp.test', '2024-03-01T10:00:00Z')],
    '1 main Old@Corp.test': [commit('c', 'Old@Corp.test', '2024-03-02T00:30:00+02:00')],
    '1 main..feat me@corp.test': [commit('e', 'me@corp.test', '2024-03-06T08:00:00Z')],
    '2 main me@corp.test': [a, commit('d', 'me@corp.test', '2024-03-05T10:00:00Z')],
  };
  const branchLists: Record<string, object[]> = { '1': [{ name: 'main' }, { name: 'feat' }], '2': [{ name: 'main' }] };
  let file: { content: string; sha: string } | null = null;
  let branch = false;
  const puts: { branch: string; content: string }[] = [];

  const server = createServer((req, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '', 'http://mock');
      const send = (status: number, data: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(data));
      };
      const route = `${req.method} ${url.pathname}`;
      const page = url.searchParams.get('page');
      const branches = /^GET \/api\/v4\/projects\/(\d)\/repository\/branches$/.exec(route)?.[1];
      const project = /^GET \/api\/v4\/projects\/(\d)\/repository\/commits$/.exec(route)?.[1];
      if (route === 'GET /api/v4/user') return send(200, { email: 'me@corp.test', commit_email: 'me@corp.test', public_email: '' });
      if (route === 'GET /api/v4/user/emails') return send(200, [{ email: 'Old@Corp.test' }]);
      if (route === 'GET /api/v4/projects' && req.headers['private-token'] === 'read_user-only') return send(403, {});
      if (route === 'GET /api/v4/projects') {
        const empty = { id: 4, default_branch: null }; // touching it hits no route → 500
        return page === '1'
          ? send(200, [{ id: 1, default_branch: 'main' }], { 'x-next-page': '2' })
          : send(200, [{ id: 2, default_branch: 'main' }, { id: 3, default_branch: 'main' }, empty], { 'x-next-page': '' });
      }
      if (branches === '3') return send(403, { message: '403 Forbidden' });
      if (branches && branchLists[branches]) return send(200, branchLists[branches]);
      if (project && req.headers['private-token'] === 'flaky') return send(500, {});
      if (project) {
        return send(200, commits[`${project} ${url.searchParams.get('ref_name')} ${url.searchParams.get('author')}`] ?? []);
      }
      if (route === 'GET /gh/user') return send(200, { login: 'octo' });
      if (route === 'GET /gh/repos/octo/octo/contents/mergegraph.json') return file ? send(200, file) : send(404, {});
      if (route === 'GET /gh/repos/octo/octo/git/ref/heads/mergegraph') return branch ? send(200, {}) : send(404, {});
      if (route === 'GET /gh/repos/octo/octo') return send(200, { default_branch: 'main' });
      if (route === 'GET /gh/repos/octo/octo/git/ref/heads/main') return send(200, { object: { sha: 'abc' } });
      if (route === 'POST /gh/repos/octo/octo/git/refs') return (branch = true), send(201, {});
      if (route === 'PUT /gh/repos/octo/octo/contents/mergegraph.json') {
        const put = JSON.parse(body) as { branch: string; content: string };
        puts.push(put);
        file = { content: put.content, sha: 's1' };
        return send(200, {});
      }
      send(500, { unexpected: route });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const run = (env: Record<string, string>) =>
    promisify(execFile)(process.execPath, [fileURLToPath(new URL('./cli.js', import.meta.url))], {
      env: { PATH: process.env.PATH ?? '', GITLAB_URL: `${base}/`, GITLAB_TOKEN: 'gl', ...env },
    });
  const expected = { '2024-03-01': 2, '2024-03-05': 1, '2024-03-06': 1 };

  try {
    assert.deepEqual(JSON.parse((await run({})).stdout), expected);
    const gh = { GITHUB_TOKEN: 'gh', GITHUB_API_URL: `${base}/gh` };
    await run(gh);
    assert.equal(branch, true);
    assert.equal(puts.length, 1);
    assert.equal(puts[0].branch, 'mergegraph');
    assert.deepEqual(JSON.parse(Buffer.from(puts[0].content, 'base64').toString()), expected);
    assert.match((await run(gh)).stdout, /unchanged/);
    await assert.rejects(run({ ...gh, GITLAB_TOKEN: 'read_user-only' }), /GET \/projects.*403/);
    await assert.rejects(run({ ...gh, GITLAB_TOKEN: 'flaky' }), /commits.*500/);
    assert.equal(puts.length, 1); // failures must never publish an empty or partial file
  } finally {
    server.close();
  }
});
