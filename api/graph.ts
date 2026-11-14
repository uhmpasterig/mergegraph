// GET /<user>.svg?year=2024&theme=dark&years=all
// The user's public GitHub calendar plus the commits per day that their GitLab CI
// publishes to github.com/<user>/<user>, branch "mergegraph", file mergegraph.json.

export type Days = Record<string, number>;
type Theme = 'light' | 'dark' | 'night';

const SYSTEM = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif";
const THEMES = {
  light: {
    bg: '', pad: 0, rx: 2, glow: false, stats: false, font: SYSTEM, title: ['#1f2328', 14, ''], text: '#59636e', strong: '#1f2328',
    rail: '#d1d9e0', accent: ['#2da44e', '#116329'], cells: ['#eff2f5', '#aceebb', '#4ac26b', '#2da44e', '#116329'],
  },
  dark: {
    bg: '', pad: 0, rx: 2, glow: false, stats: false, font: SYSTEM, title: ['#f0f6fc', 14, ''], text: '#9198a1', strong: '#f0f6fc',
    rail: '#3d444d', accent: ['#2ea043', '#196c2e'], cells: ['#151b23', '#033a16', '#196c2e', '#2ea043', '#56d364'],
  },
  // A slate night sky; each day is a window: dark, glowing, dim, lit, lamp-bright. The total is one big
  // number, the sources small stats with a lamp edge, the years stops on a line.
  night: {
    bg: '#172029', pad: 32, rx: 0, glow: true, stats: true, font: `Inter,${SYSTEM}`, title: ['#ffffff', 34, '650'], text: '#9aa5b0', strong: '#c9d1d9',
    rail: '#3a4652', accent: ['#f0b54d', '#8a5806'], cells: ['#1e252c', '#5c5034', '#a07b3c', '#f0c46a', '#ffe3a3'],
  },
} as const satisfies Record<Theme, unknown>;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const CELL = 10;
const STEP = 13;
const LABEL = 32; // weekday labels left of the grid
const BAR = 64; // tallest weekly bar on the line

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The file is user-controlled: keep only `"YYYY-MM-DD": positive integer`, real dates since GitHub exists. */
export function clean(raw: unknown): Days {
  const days: Days = {};
  if (typeof raw !== 'object' || raw === null) return days;
  for (const [date, n] of Object.entries(raw as Record<string, unknown>)) {
    const real = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '2008-01-01' && !Number.isNaN(Date.parse(date)) && iso(new Date(date)) === date;
    if (real && typeof n === 'number' && Number.isSafeInteger(n) && n > 0) days[date] = n;
  }
  return days;
}

/** GitHub-style intensity 0–4 from the quartiles of the non-zero values. */
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

/** Weekly totals from the first busy year up to `to`; leading years under 2 % of the busiest are left out. */
export function weekly(all: Days, to: Date): { first: number; start: number; weeks: number[]; totals: Map<number, number> } | null {
  const totals = new Map<number, number>();
  for (const [date, n] of Object.entries(all)) {
    if (date <= iso(to)) totals.set(Number(date.slice(0, 4)), (totals.get(Number(date.slice(0, 4))) ?? 0) + n);
  }
  if (totals.size === 0) return null;
  const busiest = Math.max(...totals.values());
  let first = Math.min(...totals.keys());
  while ((totals.get(first) ?? 0) < busiest * 0.02) first++;
  const jan1 = Date.UTC(first, 0, 1);
  const start = jan1 - new Date(jan1).getUTCDay() * DAY; // weeks start on Sunday, like the grid
  const weeks: number[] = [];
  for (let t = jan1; t <= to.getTime(); t += DAY) {
    const w = Math.floor((t - start) / WEEK);
    weeks[w] = (weeks[w] ?? 0) + (all[iso(new Date(t))] ?? 0);
  }
  return { first, start, weeks: Array.from(weeks, (n) => n ?? 0), totals };
}

export function render(o: { gh: Days; ext: Days; from: Date; to: Date; label: string; theme: Theme; years?: boolean }): string {
  const t = THEMES[o.theme];
  const [titleColor, titleSize, titleWeight] = t.title;
  const start = o.from.getTime() - o.from.getUTCDay() * DAY; // the Sunday that starts the first column
  const days: { d: Date; n: number; col: number }[] = [];
  let gh = 0;
  let ext = 0;
  for (let ms = o.from.getTime(); ms <= o.to.getTime(); ms += DAY) {
    const d = new Date(ms);
    const a = o.gh[iso(d)] ?? 0;
    const b = o.ext[iso(d)] ?? 0;
    gh += a;
    ext += b;
    days.push({ d, n: a + b, col: Math.floor((ms - start) / WEEK) });
  }
  const all: Days = { ...o.gh };
  for (const [date, n] of Object.entries(o.ext)) all[date] = (all[date] ?? 0) + n;

  const cols = days[days.length - 1].col + 1;
  const x0 = t.pad + LABEL;
  const right = x0 + (cols - 1) * STEP + CELL;
  const fmt = (n: number) => n.toLocaleString('en-US');
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const glow: string[] = [];
  const rect = (x: number, y: number, level: number, w: number = CELL, h: number = CELL) => {
    if (t.glow && level === 4) glow.push(`<rect x="${r1(x - 1)}" y="${y - 1}" width="${r1(w + 2)}" height="${h + 2}"/>`);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}"${t.rx ? ` rx="${t.rx}"` : ''} fill="${t.cells[level]}"/>`;
  };
  const label = (x: number, y: number, s: string, attrs = '') => `<text x="${x}" y="${y}"${attrs}>${s}</text>`;
  const end = ' text-anchor="end"';
  const parts: string[] = [];

  let y: number;
  if (t.stats) {
    y = t.pad + 96;
    parts.push(
      label(t.pad, t.pad + 30, fmt(gh + ext), ` font-size="${titleSize}" font-weight="${titleWeight}" letter-spacing="-0.03em" fill="${titleColor}"`),
      label(t.pad, t.pad + 52, `contributions ${o.label}`, ' font-size="13"'),
    );
    if (ext > 0) {
      ([['GitLab', ext], ['GitHub', gh]] as const).forEach(([source, n], i) => {
        const x = right - i * 104 - 92;
        parts.push(
          `<rect x="${x}" y="${t.pad + 6}" width="3" height="40" fill="${t.accent[0]}"/>`,
          label(x + 13, t.pad + 22, source),
          label(x + 13, t.pad + 42, fmt(n), ` font-size="17" font-weight="600" fill="${titleColor}"`),
        );
      });
    }
  } else {
    const head = t.pad + titleSize;
    y = t.pad + (t.pad ? 50 : 40);
    parts.push(
      label(t.pad, head, `${fmt(gh + ext)} contributions ${o.label}`, ` font-size="${titleSize}"${titleWeight ? ` font-weight="${titleWeight}"` : ''} fill="${titleColor}"`),
      ext > 0 ? label(right, head, `GitHub ${fmt(gh)} · GitLab ${fmt(ext)}`, end) : '',
    );
  }
  const level = levels(days.map((x) => x.n));
  parts.push(
    ...days
      .filter(({ d, col }) => d.getUTCDate() === 1 && col < cols - 1) // a label needs two columns
      .map(({ d, col }) => label(x0 + col * STEP, y - 8, MONTHS[d.getUTCMonth()])),
    ...(['Mon', 'Wed', 'Fri'] as const).map((s, i) => label(t.pad, y + (2 * i + 1) * STEP + 9, s)),
    ...days.map(({ d, n, col }) => rect(x0 + col * STEP, y + d.getUTCDay() * STEP, level(n))),
  );
  y += 7 * STEP;

  // The years as a line: every week a bar standing on the rail, one stop per year, the current one lit.
  const line = o.years ? weekly(all, o.to) : null;
  if (line) {
    const { first, start: t0, weeks, totals } = line;
    y += 34;
    parts.push(label(t.pad, y, `Every week since ${first}`));
    y += 16 + BAR;
    const x1 = t.pad + 6;
    const x2 = right - 6;
    const step = (x2 - x1) / weeks.length;
    const max = Math.max(...weeks);
    const bar = levels(weeks);
    weeks.forEach((n, i) => {
      if (n) {
        const h = Math.max(2, Math.round(BAR * Math.sqrt(n / max))); // sqrt: quiet years stay visible
        parts.push(rect(r1(x1 + i * step), y - h, bar(n), Math.max(1.2, r1(step - 1)), h));
      }
    });
    parts.push(`<rect x="${x1}" y="${y + 3}" width="${x2 - x1}" height="3" fill="${t.rail}"/>`);
    const now = o.to.getUTCFullYear();
    const every = Math.ceil(56 / (52 * step)); // label every n-th stop when the years get narrow
    for (let year = first; year <= now; year++) {
      const x = r1(x1 + 1 + Math.floor((Date.UTC(year, 0, 1) - t0) / WEEK) * step);
      const lit = year === now;
      parts.push(`<circle cx="${x}" cy="${y + 4.5}" r="5.5" fill="${lit ? t.accent[0] : t.bg || t.cells[0]}" stroke="${lit ? t.accent[1] : t.rail}" stroke-width="3"/>`);
      if ((year - first) % every && !lit) continue;
      const near = x > x2 - 48 ? end : ''; // keep the last labels inside the card
      const lx = near ? x + 6 : x - 5;
      parts.push(label(lx, y + 30, String(year), ` font-weight="600" fill="${t.strong}"${near}`), label(lx, y + 46, fmt(totals.get(year) ?? 0), near));
    }
    parts.push(`<circle cx="${x2}" cy="${y + 4.5}" r="3" fill="${t.accent[0]}"/>`); // today
    y += 46;
  }

  if (!t.stats) {
    y += 8;
    parts.push(
      label(right - 36 - 5 * STEP, y + 9, 'Less', end),
      ...t.cells.map((_, i) => rect(right - 32 - 5 * STEP + i * STEP, y, i)),
      label(right, y + 9, 'More', end),
    );
    y += CELL;
  }
  const width = right + t.pad;
  const height = y + (t.pad ? t.pad - 4 : 4);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `font-family="${t.font}" font-size="12" fill="${t.text}">` +
    (t.bg ? `<rect width="100%" height="100%" fill="${t.bg}"/>` : '') +
    (glow.length
      ? `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>` +
        `<g filter="url(#glow)" opacity="0.55" fill="${t.cells[4]}">${glow.join('')}</g>`
      : '') +
    `${parts.join('')}</svg>`
  );
}

type GraphQL<T> = { errors?: { type?: string; message: string }[]; data?: T };
type Calendar = { contributionCalendar: { weeks: { contributionDays: { date: string; contributionCount: number }[] }[] } };

async function graphql<T>(query: string, login: string): Promise<T | undefined> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${process.env.GITHUB_TOKEN}`, 'user-agent': 'mergegraph' },
    body: JSON.stringify({ query, variables: { login } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL: ${res.status}`);
  const json = (await res.json()) as GraphQL<T>;
  const error = json.errors?.find((e) => e.type !== 'NOT_FOUND');
  if (error) throw new Error(`GitHub GraphQL: ${error.message}`);
  return json.data;
}

/** Calendar years in one query; 'all' asks GitHub which years have contributions first. */
async function github(login: string, years: number[] | 'all'): Promise<Days | null> {
  if (years === 'all') {
    type Years = { user: { contributionsCollection: { contributionYears: number[] } } | null };
    const user = (await graphql<Years>('query ($login: String!) { user(login: $login) { contributionsCollection { contributionYears } } }', login))?.user;
    if (!user) return null;
    years = user.contributionsCollection.contributionYears;
    if (!years.length) return {};
  }
  const fields = years.map(
    (y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
      contributionCalendar { weeks { contributionDays { date contributionCount } } } }`,
  );
  const user = (await graphql<{ user: Record<string, Calendar> | null }>(`query ($login: String!) { user(login: $login) { ${fields.join(' ')} } }`, login))?.user;
  if (!user) return null;
  const days: Days = {};
  for (const year of Object.values(user)) {
    for (const week of year.contributionCalendar.weeks) {
      for (const day of week.contributionDays) if (day.contributionCount) days[day.date] = day.contributionCount;
    }
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
  const years = q.get('years');
  if (
    !/^[a-z\d][a-z\d-]{0,38}$/i.test(user) ||
    (year !== null && !/^20\d\d$/.test(year)) ||
    !(theme === 'light' || theme === 'dark' || theme === 'night') ||
    (years !== null && years !== 'all')
  ) {
    return new Response('Usage: /<github-user>.svg?year=2024&theme=light|dark|night&years=all\n', { status: 400 });
  }
  const { from, to } = range(year === null ? null : Number(year));
  const span = years ? 'all' : year ? [Number(year)] : [to.getUTCFullYear() - 1, to.getUTCFullYear()];
  const [gh, ext] = await Promise.all([github(user, span), extra(user)]);
  if (!gh) return new Response(`GitHub user ${user} not found\n`, { status: 404 });
  const svg = render({ gh, ext, from, to, label: year ? `in ${year}` : 'in the last year', theme, years: years === 'all' });
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-security-policy': "default-src 'none'",
      // Separate headers: with s-maxage in Cache-Control, Vercel sends max-age=0 downstream and
      // GitHub's image proxy would hit us on every profile view.
      'cache-control': 'public, max-age=3600',
      'vercel-cdn-cache-control': 'max-age=3600, stale-while-revalidate=86400',
    },
  });
}
