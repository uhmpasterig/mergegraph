// GET /<user>.svg?year=2024&theme=dark
// The user's public GitHub calendar plus the commits per day that their GitLab CI
// publishes to github.com/<user>/<user>, branch "mergegraph", file mergegraph.json.

export type Days = Record<string, number>;
type Theme = 'light' | 'dark';

const PALETTE = {
  light: { fg: '#1f2328', text: '#59636e', cells: ['#eff2f5', '#aceebb', '#4ac26b', '#2da44e', '#116329'] },
  dark: { fg: '#f0f6fc', text: '#9198a1', cells: ['#151b23', '#033a16', '#196c2e', '#2ea043', '#56d364'] },
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86_400_000;
const CELL = 10;
const STEP = 13;
const LEFT = 32;
const TOP = 40;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The file is user-controlled: keep only `"YYYY-MM-DD": positive integer`. */
export function clean(raw: unknown): Days {
  const days: Days = {};
  if (typeof raw !== 'object' || raw === null) return days;
  for (const [date, n] of Object.entries(raw as Record<string, unknown>)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && typeof n === 'number' && Number.isSafeInteger(n) && n > 0) days[date] = n;
  }
  return days;
}

/** GitHub-style intensity 0–4 from the quartiles of the non-zero days. */
export function levels(counts: number[]): (n: number) => number {
  const nz = counts.filter((n) => n > 0).sort((a, b) => a - b);
  const q = [0.25, 0.5, 0.75].map((p) => nz[Math.floor(p * (nz.length - 1))] ?? 0);
  return (n) => (n === 0 ? 0 : 1 + q.filter((t) => n > t).length);
}

/** A calendar year, or the 365 days up to today (UTC). */
export function range(year: number | null, now = new Date()): { from: Date; to: Date } {
  if (year !== null) return { from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year, 11, 31)) };
  const to = new Date(iso(now));
  return { from: new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), to.getUTCDate() + 1)), to };
}

export function render(o: { gh: Days; ext: Days; from: Date; to: Date; label: string; theme: Theme }): string {
  const { fg, text, cells } = PALETTE[o.theme];
  const start = o.from.getTime() - o.from.getUTCDay() * DAY; // the Sunday that starts the first column
  const days: { d: Date; n: number; col: number }[] = [];
  let gh = 0;
  let ext = 0;
  for (let t = o.from.getTime(); t <= o.to.getTime(); t += DAY) {
    const d = new Date(t);
    const a = o.gh[iso(d)] ?? 0;
    const b = o.ext[iso(d)] ?? 0;
    gh += a;
    ext += b;
    days.push({ d, n: a + b, col: Math.floor((t - start) / (7 * DAY)) });
  }

  const level = levels(days.map((x) => x.n));
  const cols = days[days.length - 1].col + 1;
  const width = LEFT + (cols - 1) * STEP + CELL;
  const bottom = TOP + 7 * STEP;
  const fmt = (n: number) => n.toLocaleString('en-US');
  const rect = (x: number, y: number, fill: string) =>
    `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}"/>`;
  const label = (x: number, y: number, s: string, end = false) =>
    `<text x="${x}" y="${y}"${end ? ' text-anchor="end"' : ''}>${s}</text>`;

  const parts = [
    `<text x="0" y="14" font-size="14" fill="${fg}">${fmt(gh + ext)} contributions ${o.label}</text>`,
    ext > 0 ? label(width, 14, `GitHub ${fmt(gh)} · GitLab ${fmt(ext)}`, true) : '',
    ...days
      .filter(({ d, col }) => d.getUTCDate() === 1 && col < cols - 1) // a label needs two columns
      .map(({ d, col }) => label(LEFT + col * STEP, TOP - 8, MONTHS[d.getUTCMonth()])),
    ...(['Mon', 'Wed', 'Fri'] as const).map((s, i) => label(0, TOP + (2 * i + 1) * STEP + 9, s)),
    ...days.map(({ d, n, col }) => rect(LEFT + col * STEP, TOP + d.getUTCDay() * STEP, cells[level(n)])),
    label(width - 36 - 5 * STEP, bottom + 17, 'Less', true),
    ...cells.map((c, i) => rect(width - 32 - 5 * STEP + i * STEP, bottom + 8, c)),
    label(width, bottom + 17, 'More', true),
  ];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${bottom + 22}" viewBox="0 0 ${width} ${bottom + 22}" ` +
    `font-family="-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif" font-size="12" fill="${text}">` +
    `${parts.join('')}</svg>`
  );
}

const QUERY = `query ($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) { contributionsCollection(from: $from, to: $to) {
    contributionCalendar { weeks { contributionDays { date contributionCount } } } } }
}`;
type Calendar = {
  errors?: { type?: string; message: string }[];
  data?: {
    user: {
      contributionsCollection: {
        contributionCalendar: { weeks: { contributionDays: { date: string; contributionCount: number }[] }[] };
      };
    } | null;
  };
};

async function github(login: string, from: Date, to: Date): Promise<Days | null> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${process.env.GITHUB_TOKEN}`, 'user-agent': 'mergegraph' },
    body: JSON.stringify({
      query: QUERY,
      variables: { login, from: from.toISOString(), to: new Date(to.getTime() + DAY - 1).toISOString() },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL: ${res.status}`);
  const json = (await res.json()) as Calendar;
  const error = json.errors?.find((e) => e.type !== 'NOT_FOUND');
  if (error) throw new Error(`GitHub GraphQL: ${error.message}`);
  const user = json.data?.user;
  if (!user) return null;
  const days: Days = {};
  for (const week of user.contributionsCollection.contributionCalendar.weeks) {
    for (const day of week.contributionDays) days[day.date] = day.contributionCount;
  }
  return days;
}

async function extra(login: string): Promise<Days> {
  const res = await fetch(`https://raw.githubusercontent.com/${login}/${login}/mergegraph/mergegraph.json`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return {}; // no GitLab set up
  if (!res.ok) throw new Error(`mergegraph.json: ${res.status}`); // don't cache a graph without it
  if (Number(res.headers.get('content-length')) > 1_000_000) return {}; // decades of days are ~50 kB
  return clean(await res.json().catch(() => null));
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const user = q.get('user') ?? '';
  const year = q.get('year');
  const theme = q.get('theme') ?? 'light';
  if (
    !/^[a-z\d][a-z\d-]{0,38}$/i.test(user) ||
    (year !== null && !/^20\d\d$/.test(year)) ||
    (theme !== 'light' && theme !== 'dark')
  ) {
    return new Response('Usage: /<github-user>.svg?year=2024&theme=dark\n', { status: 400 });
  }
  const { from, to } = range(year === null ? null : Number(year));
  const [gh, ext] = await Promise.all([github(user, from, to), extra(user)]);
  if (!gh) return new Response(`GitHub user ${user} not found\n`, { status: 404 });
  return new Response(render({ gh, ext, from, to, label: year ? `in ${year}` : 'in the last year', theme }), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-security-policy': "default-src 'none'",
      'cache-control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
