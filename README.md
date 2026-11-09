# Explosive Endurance

A mobile-first web app for following an 8-week "Explosive Endurance" training
program: it shows today's session, lets you log sets, and provides EMOM and
interval timers. It is a static site (Vite + TypeScript, no UI framework) with
the program defined in `public/program.json`.

## Install

Requires Node 22.

```sh
npm ci
```

## Run (development)

```sh
npm run dev
```

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

Pushes to `main` run `.github/workflows/pages.yml`, which tests, builds and
deploys `dist/` to https://eatea.github.io/workout-app-2026/.

One-time repository setup: **Settings -> Pages -> Source: GitHub Actions**.

## More

- [PLAN.md](PLAN.md): the implementation plan and current progress.
- [docs/mockups](docs/mockups): visual design reference (`mockups.html` and PNGs).
