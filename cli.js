#!/usr/bin/env node
// Counts the commits you authored on a GitLab instance per day (UTC) and publishes
// nothing but {"YYYY-MM-DD": count} to github.com/<you>/<you>, branch "mergegraph".
// Without GITHUB_TOKEN it only prints that JSON, so you can check what would leave.

const { GITLAB_TOKEN, GITHUB_TOKEN } = process.env;
const GITLAB = (process.env.GITLAB_URL || process.env.CI_SERVER_URL || '').replace(/\/+$/, '');
const GITHUB = process.env.GITHUB_API_URL || 'https://api.github.com';
const BRANCH = 'mergegraph';
const FILE = 'mergegraph.json';

if (!GITLAB || !GITLAB_TOKEN) {
  console.error('mergegraph: set GITLAB_TOKEN (scope read_api) and GITLAB_URL (GitLab CI sets it for you).');
  process.exit(1);
}

async function gitlab(path, skipUnreadable = false) {
  const res = await fetch(`${GITLAB}/api/v4${path}`, { headers: { 'private-token': GITLAB_TOKEN } });
  if (skipUnreadable && (res.status === 403 || res.status === 404)) return null;
  if (!res.ok) throw new Error(`GitLab GET ${path}: ${res.status} ${await res.text()}`);
  return res;
}

async function* pages(path, skipUnreadable = false) {
  for (let page = '1'; page; ) {
    const res = await gitlab(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, skipUnreadable);
    if (!res) return;
    yield* await res.json();
    page = res.headers.get('x-next-page');
  }
}

const me = await (await gitlab('/user')).json();
const emails = new Set([me.email, me.commit_email, me.public_email]);
for await (const { email } of pages('/user/emails')) emails.add(email);
const own = new Set([...emails].filter(Boolean).map((e) => e.toLowerCase()));

const seen = new Set();
const days = {};
for await (const project of pages('/projects?membership=true&simple=true')) {
  for (const email of own) {
    const path = `/projects/${project.id}/repository/commits?all=true&author=${encodeURIComponent(email)}`;
    for await (const commit of pages(path, true)) { // skips projects whose repository you can't read
      if (seen.has(commit.id) || !own.has(commit.author_email.toLowerCase())) continue;
      seen.add(commit.id);
      const day = new Date(commit.authored_date).toISOString().slice(0, 10);
      days[day] = (days[day] ?? 0) + 1;
    }
  }
}
const json = `${JSON.stringify(Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`;

if (!GITHUB_TOKEN) {
  process.stdout.write(json);
  process.exit(0);
}

async function github(path, init = {}, missingOk = false) {
  const res = await fetch(GITHUB + path, {
    ...init,
    headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'mergegraph' },
  });
  if (!res.ok && !(missingOk && res.status === 404)) {
    throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  }
  return res;
}

const { login } = await (await github('/user')).json();
const repo = `/repos/${login}/${login}`;
const current = await github(`${repo}/contents/${FILE}?ref=${BRANCH}`, {}, true);
let sha;
if (current.ok) {
  const file = await current.json();
  if (Buffer.from(file.content, 'base64').toString() === json) {
    console.log(`${FILE} unchanged`);
    process.exit(0);
  }
  sha = file.sha;
} else if ((await github(`${repo}/git/ref/heads/${BRANCH}`, {}, true)).status === 404) {
  // Own branch: commits on the default branch would count as GitHub contributions themselves.
  const { default_branch } = await (await github(repo)).json();
  const { object } = await (await github(`${repo}/git/ref/heads/${default_branch}`)).json();
  await github(`${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: object.sha }) });
}
await github(`${repo}/contents/${FILE}`, {
  method: 'PUT',
  body: JSON.stringify({ message: `Update ${FILE}`, content: Buffer.from(json).toString('base64'), branch: BRANCH, sha }),
});
console.log(`Published ${Object.keys(days).length} days to ${login}/${login}@${BRANCH}`);
