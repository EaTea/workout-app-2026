# Explosive Endurance

A mobile-first web app for following an 8-week "Explosive Endurance" training
program. Today it shows today's session from `public/program.json` (with
deload weeks applied), turns max-based reps into concrete targets from your
tested maxes, shows exercise details (cues, alternative, evidence,
progression) and has a settings screen. EMOM rows have a "Start EMOM" button
that opens a full-screen timer with a beep and vibration each minute and a
3-2-1 countdown (the beeps ask Safari 16.4+ to play through an iPhone's
silent switch; older iOS versions may still mute them, and iOS Safari has no
vibration). The heavy bag row has a "Start timer" interval timer and rows
with a prescribed rest (and superset blocks) have a "Rest 30s" button, all with
adjustable numbers before Start. The screen stays awake while a timer is open,
and on Today and the log screen while a session is in progress (from its first
logged set until every set is logged, or until midnight; needs a browser with the Screen Wake Lock API, e.g. iOS Safari 16.4+), and
Today shows an "It's a new day" banner (with a button to switch) if left open past midnight.

Tapping an exercise on Today opens its log screen: tick sets off one at a time
with reps and kg steppers (pre-filled from the previous set or the plan; kg
moves in 2.5 kg steps and the number can be tapped to type, e.g. 22.5), an
optional note, Skip, and "Log all as planned" (handy after an EMOM; it keeps
the edits made to the current set). Logging a set that has a prescribed rest
opens the rest timer already running. Logged sets can be
tapped to edit or delete (delete asks for a second tap), and Today rows show progress such as "2/6". The log
is kept in this browser's local storage (nothing is sent anywhere); the
exercise details sheet is behind the ⓘ button on the log screen. "Last time"
hints (last week's same day and block type, else the same kind of block on
another day) show on Today rows and the log screen. The History tab lists every logged
session, newest first, with a summary per exercise; tap an exercise to see its
sets and tap a set to edit or delete it. On every week 8 training day Today opens
with a "Retest week" card: steppers (pre-filled with your current maxes) and a
"Save max" button per exercise for pull-ups and dips. Saving stamps the max with
today's real date and switches week 8's EMOM targets to the new max at once; the
card stays until both are saved that week, and "Not today" hides it for that
date only. It is a static site
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
`http://localhost:5173/?date=2026-11-09`); it previews that day on the Today
screen and also sets the start date when you tap Start today, but never changes
when maxes count as saved. A "Previewing 16 Nov · back to today" strip shows on
Today and the log screen while it is in use; past dates can be logged to
(backfilling), future ones cannot. E2E tests use it too.

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

## Editing program.json

`public/program.json` is the training program. If you break something that would
make a session wrong (wrong type, missing field, unknown exercise id, a week
with no progression phase) the app shows an error card naming the path; a field
the app doesn't recognise is only a warning: the field is ignored, the session
still loads, and an amber banner on Today lists each one. A misspelt field name
(say `weeklyIncreese`) is ignored too, so that part of the session is missing;
the banner suggests the fix ("did you mean "weeklyIncrease"?") and opens its
list straight away when it spots a likely typo.

`days[].day` and `restDay` are whole numbers from 1 to 7: Day 1 is the session
on your start date, and Day 7 is the rest day in the shipped program (not
weekday names). A progression phase can set `"retest": true`; EMOMs in that
week hold the previous week's reps until you save a new max for that exercise
in Settings during the week; then they use that max with no weekly increase.

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
