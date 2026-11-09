# Explosive Endurance

A mobile-first web app for following an 8-week "Explosive Endurance" training
program. Today it shows today's session from `public/program.json` (with
deload weeks applied), turns max-based reps into concrete targets from your
tested maxes, shows exercise details (cues, alternative, evidence,
progression) and has a settings screen. Set logging and EMOM/interval timers
are planned but not built yet (see [PLAN.md](PLAN.md)). It is a static site
(Vite + TypeScript, no UI framework).

## Install

Requires Node 22.

```sh
npm ci
```

## Run (development)

```sh
npm run dev
```

To preview another day, add `?date=YYYY-MM-DD` to the URL (e.g.
`http://localhost:5173/?date=2026-11-09`); it overrides "today" for the Today
screen. E2E tests use it too.

## Build and preview

```sh
npm run build      # type-checks, then writes the site to dist/
npm run preview    # serves dist/ locally (http://localhost:4173)
```

## Tests

```sh
npm test           # unit tests (Vitest)
npm run test:e2e   # end-to-end tests (Playwright, iPhone 13 profile)
```

The E2E run builds the app and serves it with `vite preview` automatically.
It needs a Playwright Chromium browser installed (`npx playwright install chromium`).

## Deployment (GitHub Pages)

`.github/workflows/pages.yml` ("CI and Pages deploy") runs `npm ci`, the unit
tests and the build on every pull request to `main` and on every push to
`main`. Only pushes to `main` (and manual runs on `main`) go on to deploy
`dist/` to https://eatea.github.io/workout-app-2026/. E2E tests are not run in
CI yet.

One-time repository setup: **Settings -> Pages -> Source: GitHub Actions**.

## More

- [PLAN.md](PLAN.md): the implementation plan and current progress.
- [docs/mockups](docs/mockups): visual design reference (`mockups.html` and PNGs).
