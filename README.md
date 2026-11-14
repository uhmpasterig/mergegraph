# mergegraph

Your GitHub contribution graph plus the commits you made on a self-hosted GitLab, for every year. One SVG for your profile README, refreshed hourly.

Your GitLab never talks to this service. A scheduled job in your own GitLab counts your commits per day and publishes only `{"2024-03-01": 7, …}` to your profile repo. No project names, commit messages or instance URLs leave GitLab, and both tokens stay in your GitLab CI variables.

## Embed

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://mergegraph-snowy.vercel.app/USER.svg?theme=dark">
  <img alt="Contributions" src="https://mergegraph-snowy.vercel.app/USER.svg">
</picture>
```

The default is the last 12 months; `?year=2023` shows one calendar year. Without the setup below you get your plain GitHub graph.

| Option | Effect |
| --- | --- |
| `theme=light` / `dark` | GitHub's look (default `light`) |
| `theme=night` | A card of its own: every day a window at night, from dark to lamp-bright, the total as one big number and GitHub and GitLab as small stats. Looks the same in light and dark mode, so no `<picture>` needed. |
| `years=all` | Adds a line below the graph: every week since your first busy year as a bar, one stop per year with its total. Quiet early years are left out. |

![night theme with all years](https://mergegraph-snowy.vercel.app/uhmpasterig.svg?theme=night&years=all)

## Add your GitLab commits

1. In GitLab, create a personal access token with the scope `read_api`.
2. In GitHub, create a fine-grained token for the single repository `USER/USER` with **Contents: Read and write**.
3. In any GitLab project of yours, add both as masked CI/CD variables `GITLAB_TOKEN` and `GITHUB_TOKEN`, add this job and a daily pipeline schedule:

```yaml
mergegraph:
  image: node:22-alpine
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  script: npx -y mergegraph@0.1.0
```

Keep the version pinned: the job runs with a token that can read all your GitLab code. Rather not trust npm at all? Copy [`cli.js`](cli.js) (one short file, no dependencies) into the project and run `node cli.js` instead.

To see what would be published, run it without `GITHUB_TOKEN`. It then only prints the JSON:

```sh
GITLAB_URL=https://gitlab.example.com GITLAB_TOKEN=glpat-… npx -y mergegraph@0.1.0
```

The job writes `mergegraph.json` to the branch `mergegraph` of `USER/USER`, so you can always read exactly what is public. It uses its own branch because commits on the default branch would count as GitHub contributions themselves.

**What counts:** every commit you authored (with any of your GitLab emails) on any branch of every project you are a member of, all years, each commit once, by its UTC date. Commits in a GitLab mirror of a GitHub repository count on both sides.

GitHub only counts commits on default branches, so the GitHub part of the graph can be lower than you expect for your own repos.

## Self-host

Deploy this repository to Vercel and set `GITHUB_TOKEN` to any GitHub token. It needs no scopes; it only reads public contribution calendars.

## Develop

```sh
npm install
npm run check
```
