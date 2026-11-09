# PLAN: Explosive Endurance workout app (mobile mockup)

Status: **plan agreed and merged (PR #2). PR 1 in progress.**

## 1. What I understand the request to be

Ed wants a small personal app for running the 8-week Explosive Endurance
Program on his phone at the gym. The source material is in the project files:

- `APP_BRIEF.md` lists the must-haves, nice-to-haves and constraints.
- `program.json` is the source of truth for exercises, days, doses and
  progression. The UI must read it, not hard-code it.
- `Explosive Endurance Program.md` is the human-readable version, used here
  only to resolve ambiguities in `program.json`.

The ask for this round is a **mockup optimised for mobile**: something Ed can
open on his phone and click through to judge the layout and flow, built on
real program data so it can grow into the real app instead of being thrown
away. Following the brief's own suggestion, the first screens are "Today's
workout", then timers, then logging.

## 2. Proposed stack

| Choice | Pick | Why |
| --- | --- | --- |
| App type | Installable web app (PWA) | The brief's default. Works offline, no app store, no backend. |
| Language | TypeScript | Catches shape errors when reading `program.json`. |
| UI | Plain TypeScript + DOM, no framework | Four or five screens don't need React. Fewer moving parts, tiny bundle, nothing to upgrade. |
| Build/dev server | Vite | Zero-config TypeScript, fast reload, simple static output. |
| Unit tests | Vitest | Shares Vite's config; no separate setup. |
| E2E tests | Playwright on a phone viewport (iPhone 13 profile) | Exercises the real UI the way Ed will use it. |
| Storage | `localStorage`, behind a small storage module | Offline, no accounts, enough for one user's 8 weeks of logs. |
| Styling | One hand-written CSS file, dark theme, system font | Readable in a gym, large tap targets (min 48px), thumb-reachable bottom nav. |

Alternatives considered: **Preact/React** (nicer component model, but more
tooling than a mockup needs; easy to adopt later if the UI grows) and a
**native app / Expo** (better timers in the background, but needs a build
toolchain and app-store or dev-client install for one user).

`program.json` will be copied into `public/program.json` and fetched at
startup, so Ed can edit it without touching code.

## 3. How the code is organised

```
 public/program.json ──fetch──▶ program/wire.ts   (ProgramWire: exact JSON shape)
                                     │ parseProgram()
                                     ▼
                               program/model.ts   (Program: internal types)
                                     │
        settings (start date, maxes) │
        settings/storage.ts ─────────┤
                                     ▼
                               program/schedule.ts  buildSession(program, settings, date)
                                     │   week, day, phase, deload, rep targets
                                     ▼
                               ui/today.ts ──▶ ui/timer.ts, ui/log.ts
                                                     │
                                     log/storage.ts ◀┘ (LogWire ⇄ LogEntry)
```

Per CLAUDE.md section 6, every boundary gets its own wire type and explicit
mapping: `ProgramWire → Program` (`parseProgram`), and `SettingsWire ⇄
Settings`, `LogWire ⇄ LogEntry` for local storage. UI code only ever sees
internal types.

## 4. Rules I'll implement, and the assumptions behind them

These are my readings of the brief and `program.json`, agreed with Ed as
the starting point. Revisit them if the app shows they're wrong.

1. **Current week and day.** Day 1 of week 1 is the day Ed starts the
   program (a "Start today" button sets it; Settings can correct it). The
   weekday names in `program.json` are shorthand for the order of the
   7-day cycle: day 1 runs the "Mon" session, day 2 "Tue", and so on, with
   day 7 the "Sun" rest day, whatever the calendar weekday is. Week =
   floor(days since start / 7) + 1. Dates before the start show "not
   started", and dates after week 8 show "program complete". *(Changed
   after the PR 1 review: week 1 used to start on the calendar Monday, so a
   late-week start lost days.)*
2. **Deload (weeks 4 and 8).** Halve the sets and **round up**, so 5 sets
   become 3, 3 become 2, 2 become 1. EMOM minutes are halved the same way
   (9 → 5, 8 → 4) and heavy-bag rounds use the low end, halved (4 → 2).
   Warm-ups are not halved.
3. **Max-rep targets.** `floor(max × repsPctOfMax)`, minimum 1. Where
   `repsPctOfMax` is a range (Wednesday dips, 40–50%), show the range, e.g.
   "4–5 reps". The EMOM's "+1 rep per minute each week" adds `week − 1` in
   weeks 1–3, and `week − 5` in weeks 5–7 (the second block restarts from the
   base after the deload). A deload week keeps the previous week's EMOM reps
   (week 4 = week 3's, week 8 = week 7's) with the minutes halved, because
   the program says "keep intensity". Mini-dose reps don't increase weekly.
   *(Deload reps changed after the PR 1 review; they used to drop back to
   week 1's.)*
4. **Ranges** (`restSec: [30, 45]`, `rounds: [4, 5]`, `workSec: [20, 30]`)
   display as ranges. Timers default to the **low end of rest** and the
   **high end of work**, editable before starting.
5. **Week 8 retest** shows a prompt on the week 8 session to enter new max
   pull-ups and dips; saving them updates the settings.
6. **Weekly fatigue check** prompts once per program week (first session of
   the week) for broad jump and max pull-ups. "Best recent result" means the
   best of the previous 3 checks. A drop of more than 10% on either shows the
   `fatigueCheck.rule` text as a warning.
7. **Editing `program.json`.** Wrong types, missing fields, unknown
   exercise ids and gaps in the progression block the app with an error
   card, because the session would be wrong. Unknown fields (a typo or a
   note Ed adds) only show a warning banner listing their paths, and the
   session still loads. *(Changed after the PR 1 review; unknown fields
   used to block.)*

## 5. Milestones and PR merge points

Each milestone is a stopping point where the app builds, runs and is
reviewable. Each implementation PR is built step by step by a lower-cost
subagent, reviewed and committed by me, and challenged by a separate
higher-reasoning reviewer before I open it (CLAUDE.md section 10).

### PR 0 — this plan *(design)* — merged as PR #2

### PR 1 — Skeleton and "Today's workout" *(behavior change)*
1. [x] Skeleton: Vite + TypeScript, `index.html` with a placeholder, Vitest and
   Playwright wired up with one trivial test each, `README.md` with
   install/build/run/test commands, and a GitHub Actions workflow that
   deploys `main` to GitHub Pages so it can be opened on a phone. Verify it
   builds and runs. Playwright uses the iPhone 13 viewport on Chromium
   (the only browser installed here); CI runs unit tests and the build but
   not Playwright yet.
2. [x] Program wire and internal types, `parseProgram`, unit tests against the
   real `program.json`. The parser also rejects unknown fields, so a typo
   in `program.json` (e.g. `restSecs`) shows an error instead of being
   silently ignored; a genuinely new field needs a small parser change.
3. [x] Schedule logic: week/day/phase, deload halving, max-rep targets, EMOM
   weekly increase. Unit tests built from worked examples (below).
4. [x] Settings screen: start date, max pull-ups, max dips (stored locally).
5. [x] Today screen: header (week N of 8, phase, day focus), blocks in session
   order as cards, tap an exercise to open cues/alternative/evidence. Phase
   changes from `progression` shown in a collapsible strip. Rest-day card.
   E2E test: set a start date and maxes, see the right session.
- **Merge point:** Ed can open the mockup on his phone and see the correct
  session for any date.

### PR 1b — Rule changes from the PR 1 review *(behavior change)*
Agreed with Ed after PR 1 merged; rules 1, 3 and 7 in section 4.
1. [x] Count program days from the start date instead of calendar
   weekdays. Add a "Start today" button to the first-run card; show
   "Day N" instead of a weekday name.
2. [x] Deload weeks keep the previous week's EMOM reps.
3. [ ] Unknown `program.json` fields warn and still load.
- **Merge point:** the three rules work as agreed, with tests.

### PR 2 — Timers *(behavior change)*
1. Shared full-screen timer view: huge digits, round counter, start/pause/
   skip, thumb-reachable controls.
2. EMOM timer (beep + vibrate each minute, round N of M).
3. Interval timer for the heavy bag (work/rest rounds).
4. Rest timer launched from a set, using `restSec`.
5. Screen Wake Lock while a session or timer is active.
   Unit tests for the timer state machine with a fake clock; E2E test that
   runs a short EMOM.
- **Merge point:** a full session can be run with timers.

### PR 3 — Logging and "last time" *(behavior change)*
1. Tick off sets; record reps, load and an optional note per set.
2. Save by date in local storage; history list by date.
3. "Last time" hint next to each strength exercise.
   Unit tests for the log mapping and "last time" lookup; E2E test that logs
   a set, reloads, and sees it again.
- **Merge point:** the must-haves for a gym session are usable.

### PR 4 — Retest, fatigue check, offline install *(behavior change)*
1. Week 8 retest prompt that saves new maxes.
2. Weekly fatigue check with the 10% flag.
3. PWA manifest and service worker so it installs and works offline.

### Later (nice-to-haves, not planned in detail yet)
- Warm-up rotation reminder every 4 weeks.
- History chart per strength exercise.
- Export log as CSV or JSON.

## 6. Worked examples (used as unit-test fixtures)

Start date Mon 2 Nov 2026 (so day N lines up with the weekday names), max
pull-ups 12, max dips 15.

| Date | Week / day | Phase | Example figures |
| --- | --- | --- | --- |
| Mon 2 Nov | W1 Mon | Base | Pull-up EMOM 9 min × floor(12 × 0.40) = 4 reps; dip mini-dose 2 × floor(15 × 0.50) = 7 |
| Mon 16 Nov | W3 Mon | Base | Pull-up EMOM 4 + 2 = 6 reps/min |
| Wed 4 Nov | W1 Wed | Base | Dip EMOM floor(15×0.40)–floor(15×0.50) = 6–7 reps; plyo push-ups 5 × 5 |
| Mon 23 Nov | W4 Mon | Deload | Med ball slams 3 × 6; pull-up EMOM 5 min × 6 (week 3's reps); dip mini-dose 1 × 7 |
| Sun 8 Nov | — | Rest | Rest-day card |
| Sat 26 Dec | W8 Sat | Deload + retest | Skater bounds 3 × 6 per side (retest prompt comes in PR 4) |
| Wed 4 Nov, starting that day | W1 day 1 | Base | "Mon" session (Upper: pull); Tue 10 Nov is day 7 (rest); Wed 11 Nov is W2 day 1 |

## 7. Open questions

1. **Mockup feedback.** Anything in the screens below to change before PR 1.

Resolved:

- **Assumptions in section 4:** agreed as a starting point.
- **Mockup fidelity:** "mockup" means static images, not a clickable app.
  They're in `docs/mockups/` (section 8).
- **Previewing on your phone:** GitHub Pages. PR 1 adds a workflow that
  builds and deploys `main` to Pages.

## 8. Mockups

Static screens in `docs/mockups/`, drawn at iPhone size from the worked
example above (start Mon 2 Nov, max 12 pull-ups and 15 dips, viewed on
Mon 9 Nov, week 2). `0-overview.png` shows all six side by side. They're
design references for PR 1–4, not app code: edit `mockups.html` and run
`node docs/mockups/render.cjs` to refresh the PNGs.

| Screen | File | Built in |
| --- | --- | --- |
| Today's workout | `1-today.png` | PR 1 |
| Logging a set | `2-log-set.png` | PR 3 |
| EMOM timer | `3-emom-timer.png` | PR 2 |
| Interval / rest timer | `4-interval-timer.png` | PR 2 |
| Exercise details sheet | `5-exercise-details.png` | PR 1 |
| Weekly fatigue check | `6-weekly-check.png` | PR 4 |
