# PLAN: Explosive Endurance workout app (mobile mockup)

Status: **PR 1, 1b and 2 merged (#3, #4, #5). PR 3 (logging) in review as #6. PR 4 in progress, stacked on PR 3.**

The program has no weekdays. Sessions are numbered Day 1 to Day 7 of a
7-day cycle that starts on the day Ed starts, and nothing in the app,
`program.json` or these docs names a weekday.

## 1. What I understand the request to be

Ed wants a small personal app for running the 8-week Explosive Endurance
Program on a phone at the gym. The source material is in the project files:

- `APP_BRIEF.md` lists the must-haves, nice-to-haves and constraints.
- `program.json` is the source of truth for exercises, days, doses and
  progression. The UI must read it, not hard-code it.
- `Explosive Endurance Program.md` is the human-readable version, used here
  only to resolve ambiguities in `program.json`.

The ask for this round is a **mockup optimised for mobile**: something Ed can
open on a phone and click through to judge the layout and flow, built on
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
   program (a "Start today" button sets it; Settings can correct it).
   `program.json` numbers its sessions `"day": 1` to `6`, and day 7
   (`"restDay": 7`) is the rest day. Days since start = d; week =
   floor(d / 7) + 1 and day = (d mod 7) + 1. The calendar weekday never
   matters, and the app never shows one: dates appear as "9 Nov". Dates
   before the start show "not started", and dates after week 8 show
   "program complete".
2. **Deload (weeks 4 and 8).** Halve the sets and **round up**, so 5 sets
   become 3, 3 become 2, 2 become 1. EMOM minutes are halved the same way
   (9 → 5, 8 → 4) and heavy-bag rounds use the low end, halved (4 → 2).
   Warm-ups are not halved.
3. **Max-rep targets.** `floor(max × repsPctOfMax)`, minimum 1. Where
   `repsPctOfMax` is a range (Day 3 dips, 40–50%), show the range, e.g.
   "6–7 reps". The EMOM's "+1 rep per minute each week" adds `week − 1` in
   weeks 1–3, and `week − 5` in weeks 5–7 (the second block restarts from the
   base after the deload). Mini-dose reps don't increase weekly.
   - A plain deload week (week 4) keeps the previous week's EMOM reps
     (week 3's) with the minutes halved, because the program says "keep
     intensity".
   - A retest week (week 8, marked `"retest": true` in `progression`)
     holds the previous week's EMOM reps (week 7's), like a deload, until
     Ed saves a new max for that exercise during the retest week. From then
     on, that exercise's EMOM uses the new max with no weekly increase and
     no hold: floor(max × %). "Saved during the retest week" means the max
     was saved on or after the week's Day 1. Settings records today's real
     date (never a `?date=` preview) on every max field Ed edits and saves,
     even if Ed re-types the same number, so "retested, same result"
     counts. Until PR 4's retest prompt exists, Ed saves the new max in
     Settings.
4. **Ranges** (`restSec: [30, 45]`, `rounds: [4, 5]`, `workSec: [20, 30]`)
   display as ranges. Timers default to the **low end of rest** and the
   **high end of work**, editable before starting.
5. **Week 8 retest** (PR 4). On every week 8 training day, Today opens
   with a "Retest week" card asking for new max pull-ups and dips (steppers
   pre-filled with the current maxes). Saving either one updates settings
   with today's real date, so week 8's EMOM targets switch from the held
   week 7 reps to the new max at once (rule 3). The card stays until both
   maxes have been saved during week 8; "Not today" hides it for that date.
   Before week 8 the prompt never appears.
6. **Weekly fatigue check** (PR 4, mockup 6). Once per program week, the
   first time Today shows a training day that week, a "Weekly check-in"
   card asks for best broad jump (metres, 2 decimals, 0.01 steps or typed)
   and max pull-ups. Either may be left blank. "Save check-in" stores it;
   "Remind me tomorrow" hides it until the next calendar day of the same
   week, and after the week ends it's simply skipped. Each value is
   compared with the best of the previous 3 checks that recorded it,
   shown as "Best recent: 2.34 m" and a percentage; a drop of more than 10%
   shows the `fatigueCheck.rule` text as a warning, both on the card and
   as a dismissible banner on Today for the rest of that week. Checks live
   in their own storage key with their own wire type and version, re-read
   before each save like the log. Saving a check-in never changes the
   EMOM maxes in settings (that's the week 8 retest's job). Week 8's
   retest card replaces the check-in that week: saving the retest also
   records the max pull-ups as that week's check.
7. **Editing `program.json`.** Wrong types, missing fields, unknown
   exercise ids and gaps in the progression block the app with an error
   card, because the session would be wrong. Unknown fields (a typo or a
   note Ed adds) only show a warning banner listing their paths, and the
   session still loads. A name close to a known field gets a "did you
   mean" hint.

8. **Logging (PR 3).** Every item on a training day can be logged, set
   by set. An item's "sets" are its sets (after deload halving), its EMOM
   minutes, or its heavy-bag rounds. Each logged set records reps (none for
   bag rounds and timed holds, where the set is just ticked), an optional
   load in kg, and an optional note. Reps and load are pre-filled from the
   same exercise's previous set this session. Otherwise reps come from the
   plan's target (it already carries this week's increase, so last week's
   reps would undo the progression), or from last time's same set when the
   plan has no number; load comes from last time's same set. Where the plan
   prescribes a different target for this set than for the previous one
   (the calf raise's heavy then moderate sets), the previous set is ignored
   and the same plan-then-last-time order applies. Loads are kg only for now.
   - The log is stored by program date in local storage, with its own
     wire type and version, separate from settings. Each save re-reads the
     stored log and applies just that change, so two open copies of the app
     (a home-screen app and a Safari tab) can't wipe each other's sets.
     A stored log with some unreadable sets keeps the readable ones, copies
     the original aside, and says so; it never starts silently empty.
   - The log screen's address carries its date. A Today screen left open
     past midnight keeps logging to the session it shows until Ed taps the
     new-day banner. A `?date=` preview shows a "Previewing" strip and can
     log to past dates (backfilling) but not to future ones.
   - **Last time** for an item is the most recent earlier session with the
     same day number and block type (last week's same slot), else the most
     recent earlier date with that exercise in the same kind of block. So
     the easy calf-raise mini-dose never pre-fills the heavy main lift's
     load, and a pull-up EMOM ignores pull-up mini-doses. Shown as "Last
     time (2 Nov): 6 × 6 at 6 kg" (sets × reps when every set matched,
     else the reps listed, e.g. "6, 6, 5"). Warm-ups don't show it.
   - Logging a set that has a prescribed rest opens and starts the rest
     timer (the Log tap counts as the tap that unlocks sound).
   - A session is "in progress" from its first logged set until the date
     changes, until every set is logged, or after 45 minutes with nothing
     logged. Optional items never started and warm-ups don't count, and a
     range of rounds is complete at its low end. While it is, the screen is
     kept awake on Today and the log screen.
   - Logged sets can be edited or deleted; deleting asks for a second tap.
     Load is in kg, in 2.5 kg steps, and the number can also be typed.
     Nothing is sent anywhere.

## 5. Milestones and PR merge points

Each milestone is a stopping point where the app builds, runs and is
reviewable. Each implementation PR is built step by step by a lower-cost
subagent, reviewed and committed by me, and challenged by a separate
higher-reasoning reviewer before I open it (CLAUDE.md section 10).

### PR 0 — this plan *(design)* — merged as PR #2

### PR 1 — Skeleton and "Today's workout" *(behavior change)* — merged as PR #3

### PR 1b — Rule changes from the PR 1 review *(behavior change)* — merged as PR #4
Agreed with Ed after PR 1 merged; rules 1, 3 and 7 in section 4.
1. [x] Count program days from the start date. "Start today" button.
2. [x] Deload weeks keep the previous week's EMOM reps.
3. [x] Unknown `program.json` fields warn and still load, with "did you
   mean" hints for likely typos.
4. [x] No weekdays anywhere: `program.json` numbers days 1–7
   (`"day": 1`, `"restDay": 7`) and its notes refer to days by number
   (e.g. "Day 4"); the app shows dates without weekday names; tests, README,
   mockups and the project-files copies of `program.json` and the program
   doc are updated to match.
5. [x] Mark week 8 `"retest": true` in `program.json`. Only EMOMs follow
   the retest rule; mini-doses keep their usual numbers.
6. [x] Week 8 EMOMs hold week 7's reps until a new max is saved during
   week 8. Settings records the date each max was saved (settings format
   v2; v1 data still loads, with no dates, so it counts as not retested).
- **Merge point:** the rules work as agreed, with tests. Steps 4–6 get
  their own challenger review before PR #4 is updated.

Follow-ups from the step 6 review, for PR 4's retest prompt:
- The "held" reps are week 7's formula applied to the max saved now, not
  a record of what week 7 actually showed; a max raised late in week 7
  makes the held figure higher. Revisit once logging (PR 3) stores what
  was shown.
- Moving the start date much earlier can make an old max date fall in
  week 8 and look like a retest. Consider counting only dates inside
  week 8, or clearing dates when the start date changes.

### PR 2 — Timers *(behavior change)* — merged as PR #5
1. [x] Timer engine (pure state machine, wall-clock based, so it catches
   up after the phone sleeps) and a shared full-screen timer view: huge
   digits, round counter, start/pause/skip, thumb-reachable controls.
2. [x] EMOM timer (beep + vibrate each minute, round N of M).
3. [x] Interval timer for the heavy bag (work/rest rounds).
4. [x] Rest timer launched from a set, using `restSec`.
5. [x] Screen Wake Lock while a timer is running, and notice when Today
   is left open past midnight (PR 1 follow-up).
   Unit tests for the timer state machine with a fake clock; E2E test that
   runs a short EMOM.
6. [x] Fixes from the challenger review:
   - One shared audio context for all timers (each timer made its own and
     never closed it, so beeps could go silent mid-session), resumed on
     every tap so iOS interruptions don't mute it; ask iOS to play through
     the silent switch where supported.
   - After the phone sleeps, play only the latest cue, not a burst.
   - Hold the wake lock for as long as a timer is open (ready, paused or
     finished too), not only while it runs.
   - Midnight: don't swap the session out from under Ed. Show a "new day"
     banner on Today with a button to switch, instead of re-rendering.
   - Rest buttons remember an adjusted rest for the rest of the visit.
   - Finished timers say "Done"; focus moves off buttons that become
     disabled; visible button text is part of each accessible name; the
     timer dialog keeps a stable name; the between-pairs button is labelled.
   - E2E for Skip and for catching up after the page was hidden.
- **Merge point:** a full session can be run with timers.

Follow-ups from the PR 2 review (later PRs):
- Schedule upcoming beeps on the audio clock so they stay on time while the
  browser throttles a hidden page.
- Let the phone's Back gesture close the timer instead of leaving the app.
- Power-endurance weeks (5–7): Ed chose that the heavy bag work default
  gets +5s and the core rest between pairs −15s. Explosive rest stays as
  written, since the program allows adding reps instead. Not built yet.

### PR 3 — Logging and "last time" *(behavior change)*
Rule 8 in section 4.
1. [x] Log model and storage: internal `WorkoutLog` and `LogWire` (v1)
   with `logFromWire`/`logToWire`, load/save under its own key, and pure
   functions to add, edit and delete a set and to read a day's sets. A
   corrupt log is kept aside (not overwritten) and the app starts empty
   with a warning. No UI yet.
2. [x] Log screen (mockup 2): open it from an item row; set list with
   ticks, reps and kg steppers pre-filled per rule 8, optional note, "Log
   set" (starts the rest timer when the item has one) and Skip. Today rows
   show progress such as "2/6".
3. [x] "Last time" lookup and hint on Today rows and the log screen.
4. [x] History screen (the "History" tab): sessions by date, newest
   first, each listing what was logged; tap a set to edit or delete it.
5. [x] Keep the screen awake while a session is in progress (rule 8).
   Unit tests for the log mapping, set edits and "last time"; E2E test that
   logs sets, reloads, and sees them on Today, the log screen and History.
6. [x] Fixes from the challenger review (rule 8 as now written):
   - Pin the shown session's date, carry it in the log screen's address,
     and drop the wake lock when the date changes.
   - Re-read before each save; keep readable sets of a damaged log.
   - "Last time" by session slot; rest timer starts on Log; session
     completion and idle timeout; preview strip and no future logging.
   - Focus after every log and History action; confirm delete; History can
     add reps to a set logged without them; "Log all" keeps the current
     set's edits; 2.5 kg steps and typed kg; a stale doc comment; a day
     number check in the loader; E2E for a damaged log; fix the midnight
     E2E race (the test could run its clock before the app had started).
- **Merge point:** the must-haves for a gym session are usable.

### PR 4 — Retest, fatigue check, offline install *(behavior change)*
Stacked on PR 3. Rules 5 and 6 in section 4.
1. [x] Week 8 retest card on Today (rule 5), saving through the existing
   settings storage and max-date stamping.
2. [x] Fatigue check storage: internal `FatigueCheck` and `FatigueCheckWire`
   (v1) with explicit mapping, tolerant load with backup, re-read before
   save, and the pure "best of previous 3" and 10% comparison.
3. [x] Weekly check-in card and the drop warning on Today (rule 6,
   mockup 6), including "Remind me tomorrow".
4. [x] Installable, offline app: web manifest and icons (home screen on
   iPhone and Android), and a hand-written service worker. Pages under
   `/workout-app-2026/` is the scope. The app shell and its hashed assets
   are precached at install (the list generated at build time), so the
   app opens with no signal. `index.html` and `program.json` are fetched
   network-first with a cache fallback, so edits to program.json show up
   whenever there is a connection. A new version takes over on the next
   launch, never mid-session.
   Unit tests for the fatigue maths and storage mapping; E2E for the retest
   card, the check-in and its warning, and the app loading offline after a
   first visit.
- **Merge point:** every must-have and constraint in the brief is met.

### Later (nice-to-haves, not planned in detail yet)
- Warm-up rotation reminder every 4 weeks.
- History chart per strength exercise.
- Export log as CSV or JSON.

## 6. Worked examples (used as unit-test fixtures)

Start date 2 Nov 2026, max pull-ups 12, max dips 15.

| Date | Week / day | Phase | Example figures |
| --- | --- | --- | --- |
| 2 Nov | W1 D1 | Base | Pull-up EMOM 9 min × floor(12 × 0.40) = 4 reps; dip mini-dose 2 × floor(15 × 0.50) = 7 |
| 16 Nov | W3 D1 | Base | Pull-up EMOM 4 + 2 = 6 reps/min |
| 4 Nov | W1 D3 | Base | Dip EMOM floor(15×0.40)–floor(15×0.50) = 6–7 reps; plyo push-ups 5 × 5 |
| 23 Nov | W4 D1 | Deload | Med ball slams 3 × 6; pull-up EMOM 5 min × 6 (week 3's reps); dip mini-dose 1 × 7 |
| 8 Nov | W1 D7 | Rest | Rest-day card |
| 21 Dec | W8 D1 | Deload + retest | Pull-up EMOM 5 min × 6 (week 7's 4 + 2, held: no max saved in week 8); after saving a retested max of 15 on 21 Dec, 5 min × 6 (floor(15 × 0.40), no hold) |
| 26 Dec | W8 D6 | Deload + retest | Skater bounds 3 × 6 per side (retest prompt comes in PR 4) |

A second start date shows the cycle doesn't depend on the weekday: start
4 Nov → 4 Nov is W1 D1 (Upper: pull), 10 Nov is W1 D7 (rest), 11 Nov is
W2 D1, and 3 Nov is "not started".

## 7. Open questions

None right now.

Resolved:

- **Weekdays:** dropped everywhere in favour of Day 1–7 (rule 1).
- **Week 8 EMOMs:** hold week 7's reps until a new max is saved during
  week 8, then use it with no hold (rule 3).
- **Assumptions in section 4:** agreed as a starting point.
- **Mockup fidelity:** "mockup" means static images, not a clickable app.
  They're in `docs/mockups/` (section 8).
- **Previewing on your phone:** GitHub Pages. PR 1 adds a workflow that
  builds and deploys `main` to Pages.

## 8. Mockups

Static screens in `docs/mockups/`, drawn at iPhone size from the worked
example above (start 2 Nov, max 12 pull-ups and 15 dips, viewed on
9 Nov, week 2 day 1). `0-overview.png` shows all six side by side. They're
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
