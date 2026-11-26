# PLAN: Workout app (mobile): Explosive Endurance, and Steady Strength

Status: **PR 1 to PR 28 and PR 30 are merged (#3 to #37). PR 29 (optional boxing on Today) is in review.**

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
     counts. The week 8 retest card (rule 5) is the usual way to save it;
     Settings works too. Only a date inside week 8 (Day 1 to Day 7) counts,
     so moving the start date can't turn an old save into a retest.
   - The held figure is worked out with the max that was in effect on the
     last week 7 day whose session has that EMOM (a max saved that same
     day counts, since a retest is done before the session), so a max
     raised later in week 7 doesn't change it (PR 7). Saved maxes are kept
     as a history for this; clearing a max keeps its history.
   - Week 4 uses the current max: a max raised late in week 3 changes
     week 4's held reps. Ed confirmed this is fine (11 Nov).
4. **Ranges** (`restSec: [30, 45]`, `rounds: [4, 5]`, `workSec: [20, 30]`)
   display as ranges. Timers default to the **low end of rest** and the
   **high end of work**, editable before starting.
5. **Week 8 retest** (PR 4). On every week 8 training day, Today opens
   with a "Retest week" card asking for new max pull-ups and dips (steppers
   pre-filled with the current maxes). Saving either one updates settings
   with today's real date, so week 8's EMOM targets switch from the held
   week 7 reps to the new max at once (rule 3). It also has an optional
   best broad jump (PR 7). The card stays until both maxes have been saved
   during week 8 and then, with only the jump showing, until the jump is
   saved or "Skip jump" is tapped (remembered for that retest week); "Not
   today" hides it for that date.
   Before week 8 the prompt never appears. In a `?date=` preview of any day
   other than the real today, the card is shown but can't save (a preview
   save would stamp today's date and change the max for every week).
   Saving re-reads the stored settings and changes only that one max, so
   two open copies of the app can't undo each other.
6. **Weekly fatigue check** (PR 4, mockup 6). Once per program week, the
   first time Today shows a training day that week, a "Weekly check-in"
   card asks for best broad jump (metres, 2 decimals, 0.01 steps or typed)
   and max pull-ups. Both start blank, with "Best recent" shown as a hint,
   and either may be left blank (a blank is never saved as a number).
   A preview of a date other than the real today can't save a check. "Save check-in" stores it;
   "Remind me tomorrow" hides it until the next calendar day of the same
   week, and after the week ends it's simply skipped. Each value is
   compared with the best of the previous 3 checks that recorded it,
   shown as "Best recent: 2.34 m" and a percentage; a drop of more than 10%
   shows the `fatigueCheck.rule` text as a warning headed "down more than
   10% this week" (one week down is a signal, not yet "stays down"); the
   percentage never rounds to a figure that contradicts the warning, both on the card and
   as a dismissible banner on Today for the rest of that week. Checks live
   in their own storage key with their own wire type and version, re-read
   before each save like the log; if the other copy of the app already
   saved this week's check, the card goes away instead of overwriting it. Saving a check-in never changes the
   EMOM maxes in settings (that's the week 8 retest's job). Week 8's
   retest card replaces the check-in that week: saving the retested
   pull-ups or the jump records them in week 8's check, merged whichever is
   saved first. Checks are keyed by date; a check's week is worked out from
   the current start date when read (PR 7), and checks dated before the
   start are kept but don't count.
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

Follow-ups from the step 6 review:
- The "held" reps are week 7's formula applied to the max saved now, not
  a record of what week 7 actually showed; a max raised late in week 7
  makes the held figure higher. Revisit once logging (PR 3) stores what
  was shown.
- (Done in PR 4: only a save dated inside week 8 counts as a retest.)

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

Follow-ups from the PR 2 review are planned as PR 6.

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
   are precached at install (the list generated at build time, fetched
   past the browser's HTTP cache, and the cache named from the files'
   contents), so the app opens with no signal. The app shell is served
   from the precache: page loads never overwrite it, so a half-arrived
   deploy or a stray URL can't break the offline app. `program.json` is
   network-first with a cache fallback, so edits show up whenever there
   is a connection. A new version is applied at launch, before anything
   is on screen, never mid-session.
   Unit tests for the fatigue maths and storage mapping; E2E for the retest
   card, the check-in and its warning, and the app loading offline after a
   first visit.
5. [x] Fixes from the challenger review (rules 3, 5, 6 and the step 4 text
   as now written): blank check-in fields; no saving from a preview; re-read
   settings and checks before saving; the shell-safe service worker; the
   iPhone status bar safe area; focus after each card action; the 10% pill;
   44px tap-to-type targets; no hard-coded "pull-ups and dips" text; doc
   and test gaps.
- **Merge point:** every must-have and constraint in the brief is met.

Follow-ups from the PR 4 review (later):
- Store fatigue checks by date and work out the week when reading, so a
  changed or restarted start date doesn't misfile old checks.
- Week 8 records max pull-ups through the retest but no broad jump.

### PR 5 — Nice-to-haves: progress charts, export, warm-up rotation *(behavior change)*
Stacked on PR 4. Ed asked for PR 5 and PR 6 after PR 4; these are the
brief's remaining nice-to-haves.
1. [x] **Warm-up rotation** (`warmupRotation`). The rotation alternates
   every `everyWeeks` weeks: weeks 1–4 use the warm-ups as written,
   weeks 5–8 use the swaps. In a swapped block, a warm-up row whose
   exercise is a swap's `out` shows the `in` name instead, with a small
   "rotated in for <original>" line (the `in` names aren't in the
   exercise library, so they have no details sheet; logging still files
   them under the original exercise id). On the first training day of a
   rotation (week 5), Today shows a dismissible card listing the swaps and
   `alsoAvailable`.
2. [x] **Export** from Settings: "Export log as CSV" (one row per logged
   set: date, week, day, block, exercise id, exercise name, set, reps,
   kg, note; RFC 4180 quoting) and "Export as JSON" (an export wire type
   holding the log, fatigue checks and settings, with its own version and
   explicit mapping, never the internal types). Files are named
   `explosive-endurance-YYYY-MM-DD.csv/.json` and downloaded, or shared
   through the phone's share sheet where downloading isn't supported.
   Import is out of scope.
3. [x] **Progress chart per strength exercise** in the History tab: pick
   an exercise that has been logged in a main-strength, mini-dose or
   explosive block; a simple line chart over the 8 program weeks of the
   best set each session (most reps, and heaviest load when loads were
   logged, as a second chart), with the deload weeks shaded, labelled
   axes, and the numbers also listed in a table for screen readers. Drawn
   as inline SVG, no chart library.
   Unit tests for the rotation, CSV quoting and export mapping, and the
   chart's data series; E2E for each feature.
4. [x] **Fixes from the challenger review.** Decisions taken:
   - The chart is per exercise *and* block type ("Pull-ups — EMOM",
     "Pull-ups — mini-dose"), so main-strength and mini-dose sets aren't
     mixed in one line. The table labels "best reps" and "heaviest load"
     as separate bests (they can come from different sets).
   - The rotation card shows on every training day of a rotated block
     until "Got it" is tapped, and the dismissal is kept per block (keyed
     by the block's first week), not just on its first day. "Got it" is
     disabled in a `?date=` preview, like the other cards.
   - History and the CSV show the name the warm-up was performed as (the
     rotated-in name); the CSV keeps the original in its own
     `exercise_name` column and adds `performed_as`. Timer and rest labels
     use the shown name too.
   - Export re-reads storage at the moment of the tap, and the JSON export
     includes any corrupt-log backups (`corruptLogBackups`, optional). The
     CSV starts with a UTF-8 BOM (for Excel) and guards formula-like cells
     even after leading spaces.
   - Stale doc comments fixed.
- **Merge point:** every nice-to-have in the brief is in.

### PR 6 — Power-endurance timer defaults and timer follow-ups *(behavior change)*
Stacked on PR 5. Ed's choice for weeks 5–7 plus the two follow-ups from
the PR 2 review.
1. [x] **Power-endurance adjustments in program.json.** A progression phase
   may carry an optional `"timerAdjustments": {"intervalWorkSec": 5,
   "coreRestBetweenPairsSec": -15}` (validated like every other field:
   whole numbers, unknown keys warned about). The shipped program sets it on
   the weeks 5–7 phase. `buildSession` applies it: every interval item's
   `workSec` range moves by the amount (Day 1 heavy bag 20–30s becomes
   25–35s, so the timer starts at 35s), and every `core` block's
   `restSecBetweenPairs` moves by its amount (45–60s becomes 30–45s, and
   Day 5's 45s becomes 30s), never below the timer's 5s floor. Today's
   rows show the adjusted numbers with a short "Power endurance: +5s work"
   / "−15s rest" line, so the text and the timer agree. Explosive rest is
   unchanged (Ed's decision: the program also allows adding reps instead).
   Steppers still let Ed change any number before Start.
2. [x] **Beeps on the audio clock.** On Start, resume and Skip, the cue
   player schedules every remaining 3-2-1 countdown and boundary beep of
   the plan on the AudioContext timeline (`osc.start(at)`), instead of
   waiting for the page's ticks, which a hidden or throttled page delays. Scheduled tones
   are cancelled on pause, Skip, a stepper change and close; the tick path
   no longer plays a tone that was already scheduled, so nothing beeps
   twice. Vibration stays tick-driven (it can't be scheduled) and the
   display still catches up after the page was hidden, as now.
3. [x] **Back closes the timer.** Opening a timer (EMOM, interval or rest)
   pushes a history entry with the same URL; the Back gesture or button
   then closes the timer instead of leaving the screen or the app. Closing
   with the timer's own button pops that entry, so Back afterwards behaves
   as before. Pushing the entry must not fire the hash router.
   Unit tests for the adjustments, the parsing, and the cue scheduling with
   a fake AudioContext; E2E for the week 5 defaults and Back closing each
   timer.
4. [x] **Fixes from the challenger review.** Decisions taken:
   - The audio-clock schedule is re-anchored whenever the audio clock and
     the wall clock disagree: when the page becomes visible again, when the
     AudioContext changes state (iOS suspends or interrupts it on lock, an
     app switch or a call), and on each display refresh if they drift by
     more than a quarter second. Then the queued tones are cancelled, the
     catch-up plays the latest cue once (as before PR 6), and the rest is
     queued again. Nothing counts as queued while the context isn't
     running, so the tick path plays the cues instead. On iOS a hidden page
     is silenced anyway, so the gain there is mainly a locked-then-woken
     timer staying right; Android and desktop gain on-time beeps while
     hidden.
   - Back: a timer opened while the previous timer's own close is still
     popping its history entry waits for that pop before pushing its own,
     so the late Back can't close it. The marker carries a per-page-load id,
     so an entry left by a reload is never taken for the current one. A
     hash navigation while a timer is open closes it without leaving a
     dead Back press behind.
   - The 5-second timer floor is a shared constant in the program model,
     used by both the timers and `buildSession`, so program code doesn't
     import timer code; adjustments are also capped at the steppers'
     maximums.
   - Tests for the timer's pause, Skip, close and stepper cancel wiring, a
     frozen-audio-clock test, Back for the interval timer, and the week 5
     rest figures; the timer E2E's due times are normalised so a −0 can't
     fail them.
5. [x] **Fixes from the Android Chrome pass** (Ed asked for a pass on an
   Android phone in Chrome). Back (the Android button or gesture) closes
   the exercise details sheet instead of leaving the log screen, using the
   same helper as the timers. Tap targets that were 44px tall (the
   tap-to-type value in the steppers, the check-in's Clear) become at least
   48px, Android's guideline, which also satisfies Apple's 44pt.
- **Merge point:** the program's weeks 5–7 changes are reflected in the
  timers, and the PR 2 follow-ups are done.

### PR 7 — Data follow-ups from earlier reviews *(behavior change)*
Stacked on PR 6. The brief's must-haves and nice-to-haves are all built;
these are the follow-ups the PR 1 and PR 4 reviews left open, so that a
changed start date or a late max doesn't quietly give wrong numbers.
1. [x] **Fatigue checks filed by date.** A check keeps its date as the
   key, and its program week is worked out from the current start date
   whenever it is read (the stored `programWeek` is still written, for
   older versions, but ignored on read). A restarted program then can't
   misfile old checks, and checks dated before the start date are kept
   but don't count as "best recent". Unit tests with a changed start date.
2. [x] **Broad jump in the week 8 retest.** The retest card gets an
   optional broad jump field (same stepper and blank rules as the weekly
   check-in), saved as week 8's check together with the retested
   pull-ups, so week 8 has a full check like the other weeks. Once both
   maxes are saved, the card stays with only the jump until it is saved
   or "Skip jump" is tapped (remembered for that retest week).
3. [x] **Held reps from what week 7 showed.** Saved maxes are kept as a
   history (date and value). *Changed after the review:* the history lives
   in its own storage key (`explosive-endurance.max-history`, its own wire
   v1 and mapping) and settings stay in their v2 format, so an older copy
   of the app (a suspended home-screen app, or the old shell before an
   update reload) still reads settings correctly and can't wipe them. On
   read, if settings' latest max disagrees with the history's last entry
   (an older copy saved a max), that max is added to the history. Week 8's held EMOM figure (rule 3) is
   then worked out with the max that was in effect on the last week 7 day
   that had that EMOM, so it matches what week 7 actually showed, and a
   max raised later in week 7 doesn't change it. Worked example (start
   2 Nov): pull-up max 12 saved 2 Nov, then 14 saved 18 Dec (W7 D5). The
   pull-up EMOM was on 14 Dec (W7 D1) with max 12, so W8 D1 holds
   floor(12 × 0.40) + 2 = 6, not floor(14 × 0.40) + 2 = 7. A save inside
   week 8 is the retest and replaces the hold, as now.
4. [x] **Fixes from the challenger review.** Settings back to v2 with the
   history in its own key (above, pending Ed's confirmation); the stored
   `programWeek` of every check is re-derived on each save (and dropped
   outside the program) so older versions and the export see current
   weeks; the export's settings type accepts every settings version; a
   week 8 retest merge never deletes a check hidden in the same derived
   week; test fixtures seed real histories; E2E for the week 8 hold
   (12 then 14 → W8 D1 shows 6) and for a start-date change moving checks.
- **Merge point:** checks and held reps stay right after a start-date
  change or a late max.

### PR 8 — Import a JSON export *(behavior change)*
Export exists but there is no way back, so a new phone or a cleared
browser loses the log. Settings gets "Import from JSON": it reads an
`explosive-endurance-export` v1 file through its own wire parser (unknown
versions refused with a clear message; settings inside it may be any
settings wire version, and an optional `maxHistory` block, which the
export now writes too, restores the max history), shows what it holds (sessions,
sets, checks, date range), and on a confirm tap replaces the log, checks
and settings. The current data is first kept as a backup key, like the
corrupt-log backups, so an import can be undone from the next export.
Unit tests for the parser and mapping; E2E for export → clear → import.
1. [x] Export writes the max history and lists import backups.
2. [x] Import: parser, apply with backup and rollback, Settings card.
3. [x] **Fixes from the challenger review.** Decisions taken (the undo
   and retention ones are on a card for Ed; built as recommended):
   - A failed import whose rollback succeeds removes its backup; backups
     are written compactly, and only the 3 newest import backups are kept.
   - The Import card gets "Undo last import", which restores the newest
     backup the same way (with its own backup of the current data).
   - A settings or max-history section with an unknown version is refused
     like the log ("Nothing was changed"), never silently reset.
   - Parsing never throws (own-property checks for exercise ids such as
     "constructor"; a try/catch around the whole parse) and files over
     10 MB are refused.
   - The backup also keeps the raw stored text of each key, so settings
     or history the loaders couldn't read aren't lost.
   - After an import, all drafts are cleared, focus goes to the main
     heading, and the toast says an undo is available. Dismissal flags
     (retest, rotation, snooze) are out of scope and stay as they were.
   - The preview shows the file's export date and the current session
     count ("You have N sessions now").
   - Known limit, in the README: another open tab saving Settings can
     overwrite imported settings; reload other tabs after an import.
- **Merge point:** a phone change loses nothing.

### PR 9 — Run the E2E suite in CI *(external non-functional change)*
CI runs only the unit tests and the build. The workflow gains a job that
installs the pinned Playwright's Chromium and runs `npm run test:e2e`
(traces only on failure, uploaded as an artifact). No app changes.
1. [x] `e2e` job (browser cached per Playwright version), CI-only
   Playwright settings (forbid `.only`, GitHub reporter), and deploy now
   needs both `build` and `e2e`, so a main commit that fails E2E is never
   published.
- **Merge point:** every PR into main is checked end to end.

### PR 10 — Day 6 wall sits *(behavior change)*
Ed asked for 5 × 90s wall sits with 60s rest between sets on Day 6.
Day 6 (Lower: ankle) has no finisher, so the wall sits go in a new
`finisher` block after the Zercher split-squat mini-dose. The program's
`sessionOrder` already puts finishers last, so the bounds and calf raises
are done fresh. Day 6's `targetMinutes` goes from 30 to 42, because the
block adds 5 × 90s + 4 × 60s = 11.5 minutes.
- **Shape:** it is an interval item, like the heavy bag
  (`"format": "interval", "rounds": 5, "workSec": 90, "restSec": 60`).
  Its timer is the existing work/rest interval timer with beeps, titled
  "Wall sit · 5 rounds". Its rounds are ticked in the log like bag rounds
  (no reps or kg, an optional note). A `note` replaces
  the timer's "Go hard" work label with a cue.
- **Same every week (Ed's decision):** 5 rounds of 90s work with 60s
  rest in all 8 weeks. The weeks 5–7 +5s work adjustment doesn't apply,
  and neither does the deload halving in weeks 4 and 8. Right now both
  rules hit every interval item, so an item can now opt out of all the
  week-by-week changes with `"sameEveryWeek": true`. It is validated like
  any other field. The wall sit sets it, and the heavy bag keeps its +5s
  and its deload halving. Today shows no "Power endurance" line for an
  opted-out item. In the weeks where other items change (deloads and
  power endurance), its row says "Same every week" instead, so it doesn't
  look like a missed adjustment next to the "Deload week: sets halved"
  note. The flag can't be combined with `weeklyIncrease`, or used in a
  block with its own `rounds` or `minutes` (a deload halves those for the
  whole block): the parser refuses both, since neither would really stay
  the same.
- **Timer name:** the interval timer's dialog used to be announced as
  "Heavy bag timer" whatever the item. It now uses the item's name
  ("Wall sit timer").
- **Library:** a new `wall_sit` exercise ("Wall sit", category
  `finisher`). Its cues are back flat on the wall, thighs parallel and
  knees over the ankles. The JSON export and import need no change, since
  sets are filed by exercise id like every other item.
1. [x] `sameEveryWeek` opt-out: wire and internal types, parser,
   `buildSession` (skips the phase timer adjustments and the deload
   halving), and unit tests on a heavy bag marked with the flag.
2. [x] Wall sit in `program.json` (exercise, Day 6 finisher block and
   minutes), Today's "Same every week" line, the timer name, and the
   README's program notes. Unit tests for the Day 6 session in W1, W4, W5
   and W8. E2E: Day 6 shows the block, the timer runs 5 × 90s / 60s, and a
   round can be logged.
3. [x] **Fixes from the challenger review:** the parser refuses the two
   combinations that would break "same every week", the doc comments and
   plan steps match the code, and the E2E suite also checks the 60s rest,
   the 1/5 progress and week 8.
- **Merge point:** Day 6 has the wall sits with a working timer and log.

### PR 11 — Program overview as the welcome page *(behavior change)* — merged as PR #18
Ed asked for a program overview as the app's welcome page, with one clear
call to action on where to start. Today a first visit shows a small
"Welcome" card on Today ("Set your program start date…" and "Start
today"), which says nothing about what the 8 weeks hold.

**What the page shows.** A new Overview screen at `#/overview`, built only
from `program.json` (nothing hard-coded, per the brief), top to bottom:

```
 ┌──────────────────────────────────┐
 │ EXPLOSIVE ENDURANCE PROGRAM      │  program.name
 │ Build explosiveness and …        │  program.goal
 │ 8 weeks · 6 training days a week │  lengthWeeks, days (restDay excluded)
 │ · about 4 h a week               │  sum of targetMinutes (234 min)
 ├──────────────────────────────────┤
 │ THE 8 WEEKS                      │  progression[], one segment per week
 │ [1][2][3][4][5][6][7][8]         │  Base · Deload · Power endurance ·
 │  Base     Dl  Power end. Dl+rt   │  Deload + retest, with each phase's
 │                                  │  first change as a one-line summary
 ├──────────────────────────────────┤
 │ A TYPICAL WEEK                   │  days[1..7]
 │ Day 1  Upper: pull       ~50 min │  focus, targetMinutes, and the main
 │        Med ball slams · Pull-ups │  explosive + main-strength exercise
 │ …                                │
 │ Day 7  Rest                      │  restDay
 ├──────────────────────────────────┤
 │ EVERY SESSION                    │  sessionOrder as labels: Warm-up →
 │ Warm-up → Explosive → …          │  Explosive → Main strength → …
 ├──────────────────────────────────┤
 │ [ Start Day 1: Upper: pull ]     │  the one primary CTA, pinned above the nav
 │  or pick another start date      │  small text link to Settings
 └──────────────────────────────────┘
```

The phase strip uses the same phase names Today's phase pill uses, and the
week list uses Day 1–7 with no weekday names (rule 1).

**When it shows (my reading of "welcome page").**
- **No start date set (first run):** the app opens on the Overview instead
  of Today's "Welcome" card. Today's `noStartDate` card goes away; `#/today`
  with no start date sends you to the Overview.
- **Program started:** the app keeps opening on Today, so the gym flow
  stays one tap shorter. The Overview stays reachable from a "Program
  overview" link on Today's header and in Settings.
- **The CTA changes with the state**, so there is always exactly one:
  - Not started yet → **"Start Day 1: Upper: pull"** (the first training
    day's number and focus from `program.json`). It saves today as the
    start date (the existing "Start today" handler, so `?date=` previews
    and the inline storage-failure message work as now) and opens Today,
    which then shows Week 1 · Day 1.
  - Start date in the future → "Program starts 16 Nov" as text; the CTA
    becomes "Preview Day 1", opening Today with `?date=<start date>`.
  - Started → **"Go to today: Week 2 · Day 1"** (or "Rest day"), opening
    Today; the current week is highlighted in the phase strip.
  - Complete → "Set a new start date", opening Settings.
- **Maxes:** the CTA doesn't ask for max pull-ups and dips. Today already
  shows "Set max" on those rows and links to Settings, so Day 1 is usable
  straight away.

**Code.** Everything it needs is already in the internal `Program` model
(name, goal, lengthWeeks, restDay, sessionOrder, days with focus and
targetMinutes, progression), so no new wire type or parser change.
- `src/program/overview.ts`: a pure `buildProgramOverview(program,
  status)` that returns a view model (headline numbers, phases with their
  week ranges, the 7 day rows, the CTA kind and label). Unit-tested.
- `src/ui/overview.ts`: renders that view model. The router gets an
  `"overview"` route, and `app.ts` picks Overview when there is no start
  date.
- Alternatives considered: a fourth bottom-nav tab "Program" (more
  discoverable, but adds a tab used once or twice in 8 weeks), and showing
  the Overview on every launch (costs a tap at every session).

**Steps.**
1. [x] `buildProgramOverview` view model and its unit tests: phases
   grouped from `progression` (W1–3 Base, W4 Deload, W5–7 Power endurance,
   W8 Deload + retest), the 7 day rows in order with Day 7 as Rest, weekly
   total minutes, and the CTA for each status (no start date, future start,
   week 2 day 1, rest day, complete).
2. [x] Overview screen, `#/overview` route, first-run redirect, CTA wiring
   (reusing "Start today"), the "Program overview" links on Today and
   Settings, styles, and README. Replaces the old Welcome card and updates
   the E2E tests that used it.
3. [x] E2E (`e2e/overview.spec.ts`): first visit lands on the Overview,
   shows 8 weeks, the four phases and the 7 days, and "Start Day 1: Upper:
   pull" opens Today at Week 1 · Day 1; a started program opens on Today
   and the header link opens the Overview with "Go to today".
4. [x] **Fixes from the challenger review:**
   - [x] The Overview shows the program.json warnings banner and the
     "Previewing" strip like Today did (first run included), and no
     new-day banner while there is no start date.
   - [x] The start button stays in view: it sits in a bar pinned above
     the bottom nav, so it is visible on the first screen.
   - [x] The start button names Day 1 only when Day 1 trains ("Start the
     program" otherwise), and each phase lists all its changes, so week 8
     shows the retest.
- **Merge point:** a first visit lands on the program overview, and one
  tap starts Day 1.

### PR 12 — Day plans by week from the overview *(behavior change)* — merged as PR #20
Ed asked to tap a day on the Overview and see that day's whole workout,
and to pick a week to see what would be different for the same day.

**What it does.** Each training day row on the Overview (Day 1–6)
becomes a link to a new read-only **Day plan** screen at
`#/plan/<day>/<week>`, e.g. `#/plan/1/4` for Day 1 in week 4:

```
 ┌──────────────────────────────────┐
 │ ‹ Program overview               │  back link
 │ DAY 1 · WEEK 4 OF 8 · DELOAD     │  kicker
 │ Upper: pull                      │  h1
 │ ~50 min · 6 blocks               │
 │ [1][2][3][4][5][6][7][8]         │  week picker (current pick highlighted,
 │                                  │   cells tinted by phase)
 │ Deload: Halve all sets · Keep …  │  the phase and its changes
 ├──────────────────────────────────┤
 │ 2 · EXPLOSIVE                    │  every block and item, as on Today:
 │ Med ball slams          3 × 6    │  name, dose, details (rest, tempo…)
 │   Changed: 6 × 6 in week 3       │  ◀ only when it differs from the
 │ 3 · MAIN STRENGTH · 5 MIN        │    previous week
 │ Pull-ups                6 / min  │
 │ …                                │
 └──────────────────────────────────┘
```

- **Same numbers as Today.** The screen doesn't re-implement any rules.
  It asks the existing `buildSession` for the date that week and day fall
  on: from the saved start date when there is one, otherwise as if the
  program started today (what the Overview's Start button would give),
  without saving anything.
  So deloads, the +1 rep per week, the power-endurance timer changes, the
  warm-up rotation and EMOM targets from your maxes all match what Today
  will show. Without saved maxes the max-based rows read "Set max", as on
  Today. Week 8 shows the held week 7 EMOM reps until a retest is saved,
  which is also what Today does.
- **Read-only.** No logging, timers or check-in cards: it is for looking
  ahead (or back). Today stays the only place to train from.
- **Week picker.** It opens on the current week while the program is
  running, otherwise week 1. Tapping a week swaps the plan in place
  (`location.replace`, so Back still returns to the Overview in one step).
- **What changed.** An item whose dose or details differ from the same
  item in the **previous week** gets a "Changed: <previous figure> in week
  N" line under it, and the phase's changes are listed at the top. Week 1
  has nothing to compare with, so it shows none.
- Rest day (Day 7) rows stay plain text: there is no plan to show.

**Alternative considered:** comparing every week with week 1 instead of
the previous week. It shows the total change since the start, but in
weeks 5–8 almost every row would be marked and the week-to-week step
(what you'd actually notice in the gym) gets lost.

**Code.** No new wire types: it reads the internal `Program` and
`TrainingSettings` like Today does.
- `src/program/dayPlan.ts`: `planDateFor(startDate, week, day)` and
  `buildDayPlan(program, settings, week, day)`, which calls `buildSession`
  for that date (with a stand-in start date when none is saved), and
  `compareWithPreviousWeek(...)`, which matches items by block position and
  exercise id and reports the ones whose dose or details changed. Pure and
  unit-tested.
- `src/ui/dayPlan.ts` (+ CSS): renders it, reusing the existing
  `formatBlockTitle`, `formatItemDose` and `formatItemDetails` so the rows
  read the same as on Today.
- The router gets a `plan` route; the Overview's training-day rows become
  links; the bottom nav keeps Today highlighted, as for the Overview.

**Steps.**
1. [x] `dayPlan.ts` view model and unit tests: the date maths (start
   2 Nov, Day 1 week 4 = 23 Nov), the stand-in start date when none is
   saved, and the changes between weeks for Day 1 (worked examples below).
2. [x] Day plan screen, the `#/plan/<day>/<week>` route (bad or out-of-range
   numbers fall back to the Overview), the week picker, the Overview rows
   as links, styles and README.
3. [x] E2E (`e2e/dayPlan.spec.ts`): from the Overview tap Day 1, see all
   six blocks, pick week 4 and see the halved doses with their "Changed"
   lines, Back returns to the Overview; Day 7 is not a link; a first run
   (no start date) can browse plans without a start date being saved.
4. [x] **Fixes from the challenger review** (it confirmed every plan
   figure matches Today for Days 1–6 × weeks 1–8):
   - [x] "Changed" lines show only what differs: never "Set max" (no
     maxes saved: "2 sets", "9 min"), no repeated minutes when the block
     line already reports them, and the week 5 warm-up swaps are marked
     ("Changed: YTWI raises in week 4"). The block line follows the
     current figure, and the Overview row chevron is hidden from screen
     readers.
   - [x] Any malformed `#/plan/...` address shows the Overview, and
     focus stays on the week picker after a week is tapped.
   - **Open question for Ed:** past weeks use the current max (as Today
     does for past dates), so after a retest earlier weeks show the new
     targets. Using the max in effect on each date would change
     `buildSession`; a follow-up if Ed wants it.
- **Merge point:** every training day's plan can be browsed week by week
  from the Overview.

### PR 13 — Day 3 crab core block *(behavior change)*
Ed asked for a small amount of the core work from a video to go on Day 3.
Day 3 (Upper: push, 32 min) is the only upper-body day without a core
block. Ed described the two exercises, and they were agreed from
stick-figure animations (an artifact shared in the project thread):

1. **Crab knee-to-elbow touch.** Hold the crab position in place (hands
   behind, feet flat, hips up in a tabletop). Lift one hand and bring that
   elbow forward to meet the opposite knee, then put both back down and
   switch sides. No crawling.
2. **Crab to base switch and sprawl.** From the crab, post one hand and
   turn over into a quadruped with the knees hovering just off the floor
   (hands under shoulders, knees under hips). Sprawl explosively (legs shoot
   back, hips drop to the floor, chest up), snap back to the hovering
   quadruped, then switch back into the crab. Alternate the turn direction
   each rep.

**What goes on Day 3.** A new `core` block after the overhead-press
mini-dose, which is where `sessionOrder` already puts core work. It is a
superset like the Day 1 and Day 5 core blocks:

```
 Day 3 · Upper: push                 W1–3   W4 (deload)  W5–7     W8 (deload)
 1 warm-up    (unchanged)
 2 explosive  plyo push-ups          (unchanged)
 3 main       dip EMOM               (unchanged)
 4 mini-dose  overhead press         (unchanged)
 5 core  ◀ new, superset
     crab knee-to-elbow touch        3 × 10 2 × 10       3 × 10   2 × 10
       (alternating, 5 per side)
     crab to base switch + sprawl    3 × 6  2 × 6        3 × 6    2 × 6
       (alternating turn direction)
     rest between pairs              45–60s 45–60s       30–45s   45–60s
```

- **Shape in `program.json`:** `{"type": "core", "format": "superset",
  "restSecBetweenPairs": [45, 60], "items": [...]}` with
  `crab_knee_to_elbow` (`"sets": 3, "reps": 10, "note": "Alternate sides,
  5 each. Hips stay up."`) and `crab_base_switch_sprawl` (`"sets": 3,
  "reps": 6, "note": "Alternate the turn direction. Sprawl fast, knees
  hover in the quadruped. End the set if the sprawls slow down."`). The
  last sentence applies the program's rule that explosive sets end when
  rep speed drops, since the sprawl is explosive even though the block
  sits after the strength work.
- **Weekly progression:** the same as the other core blocks, with nothing
  new in the code. Deload weeks (4 and 8) halve the sets, rounding up
  (3 → 2). Weeks 5–7 cut the rest between pairs by 15s through the
  existing `coreRestBetweenPairsSec` adjustment (45–60s → 30–45s). Reps
  stay at 10 and 6 every week, so the Base phase's "add 1 rep per set"
  doesn't reach them. The other core items have rep ranges Ed climbs
  himself (`coreProgressions`), but a fixed count keeps the sprawls fast
  and the block small. **Open question for Ed:** give the touches a
  range to climb (for example 10–14) instead.
- **Time:** about 8 minutes (3 rounds of roughly 40s + 30s of work and
  about 50s rest, plus setting up), so Day 3's `targetMinutes` goes from 32
  to 40. The Overview's weekly total goes from about 234 to about 242
  minutes.
- **Library:** two new exercises, both category `core`, with cues taken
  from the descriptions above. `evidence` is `"coaching practice"`, like
  the other core items without a study behind them.
- **No code change expected.** The parser, `buildSession`, Today, the day
  plan and the JSON export already handle a core superset on any day.
  If the implementation finds otherwise, it stops and this plan is
  updated before any code changes.
- **Alternatives considered:** a timed block (for example 3 × 30s each)
  instead of reps. Reps match the other core blocks and Ed's description
  of single touches and sprawls. A third, optional exercise, which would
  push Day 3 past the "small amount" Ed asked for.
- **Not in scope:** the copy of `program.json` in the project files has
  already drifted from `public/program.json`, which is the one the app
  reads. This PR changes only `public/program.json`.

**Steps.**
1. [x] `public/program.json`: the two exercises, the Day 3 core block and
   `targetMinutes` 40. README program notes (nothing there named Day 3's
   blocks or minutes, so it needed no change). Unit tests for the Day 3
   session in W1, W4, W5 and W8 (worked examples below) and the Overview
   total of 242 min.
2. [x] E2E (`e2e/dayThreeCore.spec.ts`): Day 3 on Today shows the core block with both exercises and
   the 45–60s Rest button. The Day 3 plan for week 4 shows 2 × 10 and 2 × 6
   with their "Changed" lines, and a set of each can be logged.
3. [x] **Fixes from the challenger review** (it found no bugs, and every
   figure matched the worked examples in the app):
   - [x] The sprawl note says to end the set once the sprawls slow down
     (the program's explosive rule).
   - [x] E2E also checks the week 5 Rest button (30s) and the week 4 → 5
     "Changed" lines, and the 45s rest line by its full text.
   - [x] The plan no longer claims the other core items have fixed reps.
   - Not changed: the touches stay `"reps": 10` with "5 each" in the note
     rather than `perSide`, so a set logs as the 10 touches Ed counts.
     The new exercises stay at the end of the library, which has no
     order the app relies on.
   - **Follow-up, not in this PR:** the project files' `program.json` and
     `Explosive Endurance Program.md` have drifted from
     `public/program.json` since PR 10 (no wall sits, no week 5–7 timer
     changes, and now no Day 3 core). Nothing reads them, so Ed decides
     whether to sync them or treat them as frozen.
- **Merge point:** Day 3 has a working core block in every week.

### PR 14 — Plan: Steady Strength program and a program picker *(design)*
Ed asked for a completely different program, in the same `program.json`
format, for someone aged 75 or over with a history of slipped discs. It
should prioritise isometric holds, add some light strength work, and keep
the core, legs, wrists and shoulders stable and strong. The person starting
the app should be able to choose it, or Explosive Endurance, when they
begin. This section is that plan; PR 15 and PR 16 implement it.

Ed confirmed (11 Nov) that the slipped discs were in the **lower back**,
that Start must **not** require a doctor check, and that the evidence
behind the exercise choices is gathered now, in this plan (see "Evidence"
below), not during implementation.

**Safety first, and it is not medical advice.** The program is general
exercise guidance written for an app, not a prescription. Its file carries
a `safety` list that the app shows before anyone starts it (see "How the
program is chosen at the start" below), which says:

1. This is not medical advice. Check with your doctor or physiotherapist
   before starting, and show them this plan, especially with a history of
   slipped discs in the lower back, osteoporosis, heart or blood pressure problems, or a
   recent fall or operation.
2. Stop and get advice if you feel sharp pain, or pain, numbness, tingling
   or weakness that spreads into a leg or arm.
3. Get urgent medical help if you notice numbness around the groin or
   buttocks, or new problems controlling your bladder or bowels.
4. Breathe out during the effort and never hold your breath. Holds are
   short on purpose.
5. Keep a kitchen counter, a sturdy chair or a wall within reach for
   every standing exercise.

**How the program protects the back.** These are the program's `rules`.
Each one has a source (S-numbers refer to the Evidence table below), and
every exercise was picked to fit them:

- The spine stays in a neutral, "tall" position. No sit-ups, crunches,
  toe touches, twisting under load or bending forward to lift, and moves
  are slow and controlled (S3).
- No jumping, running or heavy weights. Loads are a resistance band, body
  weight or something light (a 0.5–1 kg tin or bottle, or a 1–2 kg bag for the suitcase hold).
  Light-to-moderate strength work is effective and safe for people over
  75 (S7) and for band training (S10).
- Effort is 5 to 6 out of 10: finish every set with 2 or 3 reps still in
  hand (S5). Mild muscle tiredness is normal; pain is the signal to stop.
- Breathe out during the effort and never hold your breath (S2). Holds
  stay short, at about half effort, because holds with big muscles raise
  blood pressure more in older adults (S12).
- Almost everything is standing at a counter, sitting on a chair or
  leaning on a wall, with "with support" versions first and "less support"
  as the progression, as in the Otago programme (S2). The one lying-down
  hold (the glute bridge) can be done on a bed and has a standing
  alternative.

**The week.** Same 7-day cycle and 8 weeks as Explosive Endurance (rule 1),
so the schedule, Today, the day plans and logging work unchanged. Three
main strength sessions on alternate days, with a rest day between, as in
the Otago programme (S2) and within the 2–3 days a week that works best in
older adults (S5, S6, S7). Balance practice is on six days, because
balance plus strength work cuts falls (S1) and Too Fit To Fracture
recommends balance daily (S3). Walking is on the short days and at the
end of each main session, towards the WHO weekly target (S4). Day 7 is a
full rest.

```
 Day 1  Legs and core              ~30 min  main session
 Day 2  Balance and walk           ~15 min  short
 Day 3  Shoulders, wrists and core ~30 min  main session
 Day 4  Balance and walk           ~15 min  short
 Day 5  Whole body                 ~30 min  main session
 Day 6  Balance and walk           ~15 min  short
 Day 7  Rest
                                   about 135 min (2 h 15 min) a week
```

Each main session runs: warm-up → balance → isometric holds → light
strength → core → cool-down (`sessionOrder`). The short days are
balance → walk. No study compares orders; balance goes first so it is
practised while fresh, which is a judgment, not a finding.

**The exercises.** Holds are interval items (rounds × work seconds / rest
seconds), so they get the existing interval timer with a beep at each
change. Holds marked "alternate" switch sides each round, so the round
count is even. Everything else is straight sets with a rest timer. Every
strength exercise is 2–3 sets of 8–12 reps with 60s rest (S5, S6). The
last column names each exercise's source.

The Otago warm-up (S2), the same on every main day:
| Exercise | Dose | Notes | Source |
| --- | --- | --- | --- |
| Head turns | 5 each side | Turn as far as comfortable | S2 |
| Neck retraction (chin tuck) | 5 | A hand on the chin guides the head straight back | S2 |
| Standing back extension | 5 | Hands on the small of the back, arch back just a little, to where it feels comfortable; stop if it sends pain down a leg; skip it if bending back brings on leg pain, heaviness or numbness | S2 |
| Ankle pumps, seated | 10 each foot | Pull the foot up, then point it | S2 |

The Otago warm-up also has trunk turns; they're left out because they
twist the lower back (S3).

Day 1 · Legs and core
| Block | Exercise | Weeks 1–2 | Notes and cues | Source |
| --- | --- | --- | --- | --- |
| Balance | Single-leg stand at the counter | 4 rounds × 20s, 20s rest, alternate legs | Hold the counter, then fingertips, then hover (progression) | S2, S1 |
| Isometric | High wall sit | 3 × 20s, 40s rest | Slide only a little way down (knees bent no more than a quarter); back flat on the wall; breathe; about half effort | S13, S12, S14 |
| | Glute bridge hold | 3 × 15s, 30s rest | On the bed is fine; squeeze the buttocks, don't arch the back. Alternative: standing buttock squeeze, 3 × 20s, on the same timer as the bridge | S8, S13 |
| | Pallof press hold (band) | 4 × 15s, 20s rest, alternate sides | Band anchored at chest height in a door; arms straight out, don't let the band turn you | S9, S10 |
| Strength | Sit-to-stand from a chair | 3 × 8–12, 60s rest | Two hands, then one hand, then no hands (progression) | S2, S7 |
| | Heel and toe raises at the counter | 2 × 10 each, 60s rest | Up onto the toes, then rock back onto the heels | S2 |
| | Side hip raise at the counter | 2 × 10 per side, 60s rest | Straight leg out to the side, toes forward, no leaning | S2 |
| Core | Standing bird dog at the counter | 2 × 6 per side, 5s hold | Both hands on the counter, slide one leg straight back and hold; hips level | S8, S9 |
| Cool-down | Slow walk | 3–5 min | | S4 |
| | Calf stretch at the wall | 60s per side | Gentle, no bouncing | S16, S5 |
| | Doorway chest stretch | 60s | Gentle | S16, S5 |

Day 3 · Shoulders, wrists and core
| Block | Exercise | Weeks 1–2 | Notes and cues | Source |
| --- | --- | --- | --- | --- |
| Balance | Heel-to-toe stand at the counter | 4 rounds × 20s, 20s rest, alternate front foot | One foot directly in front of the other; less support over the weeks | S2, S1 |
| Isometric | Wall push hold | 3 × 15s, 30s rest | Hands on the wall at shoulder height, fingers spread, lean in to bent elbows and hold; loads the wrists and shoulders | S13, S7 |
| | Grip squeeze | 4 × 10s, 15s rest, alternate hands | Soft ball or rolled towel, about half effort | S11, S12 |
| Strength | Band row | 3 × 8–12, 60s rest | Seated or standing, band anchored in a door; shoulders down, 2s squeeze | S10, S17 |
| | Band outward rotation | 2 × 10 per arm, 60s rest, 3s hold at the end | Elbow tucked at your side; replaces the door-frame press-out | S10, S15 |
| | Counter push-up | 2 × 8–12, 60s rest | Hands on the kitchen counter, body straight | S7 |
| | Wrist curl and reverse wrist curl | 2 × 10 each way, 60s rest | Forearm resting on a table, light tin or bottle | S11 |
| | Band pull-apart | 2 × 10–12, 60s rest | At chest height, arms nearly straight | S10, S17 |
| Core | Wall side plank | 4 × 15s, 20s rest, alternate sides | Forearm on the wall, feet a step away, body straight | S8 |
| | Tall sitting hold | 3 × 20s, 20s rest | Sit forward off the chair back, tall, gently brace and breathe; posture practice | S17, S8 |
| Cool-down | Slow walk | 3–5 min | | S4 |
| | Calf stretch at the wall | 60s per side | | S16, S5 |
| | Doorway chest stretch | 60s | | S16, S5 |

Day 5 · Whole body
| Block | Exercise | Weeks 1–2 | Notes and cues | Source |
| --- | --- | --- | --- | --- |
| Balance | Heel-to-toe walk along the counter | 3 × 10 steps | One hand on the counter | S2 |
| Isometric | Counter plank | 3 × 15s, 30s rest | Forearms or hands on the counter, body straight from head to heels | S8 |
| | Split-stance hold at the counter | 4 × 15s, 20s rest, alternate legs | One foot ahead, small knee bend in both legs, torso upright; about half effort | S13, S7 |
| | Suitcase hold | 4 × 20s, 20s rest, alternate hands | A light bag (1–2 kg) in one hand; pick it up from a counter or chair seat, never from the floor; stand tall and don't lean; about half effort | S8, S11 |
| Strength | Stair step-up | 2 × 8 per side, 60s rest | Bottom stair with the rail, whole foot on the step | S2 |
| | Sit-to-stand from a chair | 2 × 8–12, 60s rest | | S2, S7 |
| | Band row | 2 × 8–12, 60s rest | | S10 |
| | Back knee bend at the counter | 2 × 10 per side, 60s rest | Standing, bring the heel towards the bottom; replaces the wall slide | S2 |
| Core | Standing bird dog at the counter | 2 × 6 per side, 5s hold | | S8, S9 |
| | Pallof press (band) | 2 × 8 per side, 3s hold at arms' length | | S9, S10 |
| Cool-down | Slow walk | 3–5 min | | S4 |
| | Calf stretch at the wall | 60s per side | | S16, S5 |
| | Doorway chest stretch | 60s | | S16, S5 |

Days 2, 4 and 6 · Balance and walk
| Block | Exercise | Weeks 1–2 | Notes | Source |
| --- | --- | --- | --- | --- |
| Balance | Single-leg stand at the counter | 4 × 20s, 20s rest, alternate legs | | S2 |
| | Heel-to-toe stand at the counter | 4 × 20s, 20s rest, alternate front foot | | S2 |
| | Sideways walking along the counter | 2 × 10 steps each way | Side-step along the counter, one hand on it, feet don't cross | S2, S3 |
| | Sit-to-stand from a chair | 1 × 8 | Slow and controlled | S2 |
| Walk | Walk at a comfortable pace | 10–20 min | Indoors or out; you should be able to talk | S4, S2 |

**What changed after the evidence review (11 Nov).** Ed asked that
everything recommended has some justification. The review replaced the
items with none, and the doses nothing supported:

| Before | After | Why |
| --- | --- | --- |
| Warm-up of marching, shoulder rolls, wrist circles, ankle circles, chin tucks | The Otago warm-up (head turns, neck retraction, back extension, ankle pumps) | The Otago warm-up was used in the trial with women aged 80+ (S2); the old moves had no source. Trunk turns left out (S3). |
| Shoulder press-out into a door frame (isometric) | Band outward rotation with a 3s end hold | Isometric shoulder work has only poor-quality evidence, in tendinopathy, and is no better than moving exercise (S15); band work is supported in older adults (S10). |
| Wrist presses | Dropped; wrists are trained by the grip squeeze, wrist curls, wall push hold, counter push-up and counter plank | No study found; grip-specific training is supported (S11), and general strength work alone doesn't raise grip strength in people over 75 (S7). |
| Wall slide | Back knee bend (Otago) | No study found for the wall slide; the band row and pull-apart already train the upper back (S10, S17). |
| Stretches 2 × 20s | 60s single holds | 60s holds gave the fastest and longest-lasting gains in adults averaging 85 (S16). |
| Rest of 30–45s on some strength exercises | 60s on every strength exercise | The rest that worked best in older adults (S6). |
| Easy (deload) weeks 4 and 8 | No easy weeks; holds grow in two small steps instead | No study supports planned easy weeks for older adults, and the tested programmes (Otago, and the trials in people over 75) progress steadily for months (S2, S6, S7). Rest days and the "stop if" rules handle bad days. |
| Effort "about 5 out of 10" | 5 to 6 out of 10 | ACSM's figure for older adults (S5). |

**Progression.** Follows the Otago approach (S2): hold a little longer,
then use less support, rather than adding load by a formula.

```
 Week          1   2  |  3   4   5  |  6   7   8
 Phase        Settle in |   Build     |  Strengthen
 Hold change     +0s    |    +5s      |    +10s
 Balance holds   20s    |    25s      |    30s     (Otago: 10s up to 30s)
 Wall sit        20s    |    25s      |    30s     (capped at 30s, S12)
 Grip squeeze    10s    |    15s      |    20s
 Sets and reps   unchanged; move up the support steps by feel
```

- The hold change uses the existing phase `timerAdjustments.intervalWorkSec`
  (+5 in weeks 3–5, +10 in weeks 6–8), so no new progression code. Rest
  stays the same. 30s is also the hold length that built muscle best in
  the isometric training review (S13), though that review studied young
  adults and dedicated isometric trials in older adults are still only at
  the protocol stage (S14).
- No deload phases, so no phase name starts with "Deload" and the app
  never halves anything in this program.
- Strength reps progress inside the 8–12 range: when every set reaches 12
  at 5–6/10 effort, move to the next support step in the exercise's
  `progression` list (for example sit-to-stand: two hands → one hand → no
  hands, S2) or a slightly firmer band (S10). Each phase's `changes` say
  this in plain words.
- After week 8 the overview's "Set a new start date" restarts the cycle,
  and the person keeps the support steps they reached.

**Evidence.** Checked during planning (11 Nov). Each exercise's
`evidence` field gets the DOI link of its first source in the tables
above (the app already shows a URL as a link on the exercise sheet). Most
of the evidence is about older adults in general or back pain in general,
not about people over 75 with disc history, which is another reason for
the doctor or physio check.

| # | Source | What it supports here |
| --- | --- | --- |
| S1 | Sherrington et al. 2019, *Exercise for preventing falls in older people living in the community*, Cochrane Database Syst Rev. [doi:10.1002/14651858.CD012424.pub2](https://doi.org/10.1002/14651858.CD012424.pub2) | Balance and functional exercise cut the rate of falls by about 24% (high certainty); balance plus resistance work by about 34% (moderate). |
| S2 | Campbell et al. 1997, *Randomised controlled trial of a general practice programme of home based exercise to prevent falls in elderly women*, BMJ 315:1065–1069. [doi:10.1136/bmj.315.7115.1065](https://doi.org/10.1136/bmj.315.7115.1065); the exercises as published in the [Otago home exercise booklet](https://www.med.unc.edu/aging/cgwep/files/2018/09/OtagoExercises.pdf); and the 2025 Otago meta-analysis, Front Public Health 13:1522952, [doi:10.3389/fpubh.2025.1522952](https://doi.org/10.3389/fpubh.2025.1522952) | The Otago programme, in women aged 80+: fewer falls (0.87 vs 1.34 a year) and injurious falls. Its warm-up, strength moves (side hip, back knee, heel and toe raises), balance moves (one-leg stand 10s up to 30s, heel-to-toe stand and walk, sideways walking), sit-to-stand with fewer hands, stair walking, strength 3 times a week with a rest day between, breathing out during the effort, and with-support then without-support progression. |
| S3 | Giangregorio et al. 2014, *Too Fit To Fracture*, Osteoporos Int 25:821–835. [doi:10.1007/s00198-013-2523-2](https://doi.org/10.1007/s00198-013-2523-2) | Strength twice a week or more, about 2 × 8–12; daily balance progressing from static to moving; slow, controlled moves; avoiding bending and twisting under load. |
| S4 | Bull et al. 2020, *WHO 2020 guidelines on physical activity and sedentary behaviour*, Br J Sports Med 54:1451–1462. [doi:10.1136/bjsports-2020-102955](https://doi.org/10.1136/bjsports-2020-102955) | Older adults: balance and strength on 3 or more days a week, strengthening on 2 or more, and regular moderate activity such as walking. |
| S5 | Chodzko-Zajko et al. 2009, *Exercise and physical activity for older adults* (ACSM position stand), Med Sci Sports Exerc 41:1510–1523. [doi:10.1249/MSS.0b013e3181a0c95c](https://doi.org/10.1249/MSS.0b013e3181a0c95c) | Strength at 5–6 (moderate) to 7–8 out of 10, 8–12 reps, 2+ days a week; static stretches of the major muscle groups 2+ days a week at 5–6/10; balance by gradually reducing support. |
| S6 | Borde, Hortobágyi & Granacher 2015, *Dose–response relationships of resistance training in healthy old adults*, Sports Med 45:1693–1720. [doi:10.1007/s40279-015-0385-9](https://doi.org/10.1007/s40279-015-0385-9) | 2–3 sets, 60s rest between sets, 2 sessions a week and long training periods (50+ weeks) worked best. Weak evidence base, as the authors say. |
| S7 | Grgic et al. 2020, *Effects of resistance training on muscle size and strength in very elderly adults*, Sports Med. [doi:10.1007/s40279-020-01331-7](https://doi.org/10.1007/s40279-020-01331-7) | In adults aged 75–96, strength training gave large strength gains (also in the 80+), with no serious exercise-related adverse events; 1–4 sets of 4–15 reps, 1–3 days a week. General training didn't raise grip strength. |
| S8 | McGill & Karpowicz 2009, *Exercises for spine stabilization*, Arch Phys Med Rehabil. [doi:10.1016/j.apmr.2008.06.026](https://doi.org/10.1016/j.apmr.2008.06.026) | Spine-sparing core work (bird dog, side bridge, plank-type holds) and starting from easier positions. |
| S9 | Pourahmadi et al. 2022, *Does motor control training improve pain and function in adults with symptomatic lumbar disc herniation?*, Br J Sports Med 56:1230–1240. [doi:10.1136/bjsports-2021-104926](https://doi.org/10.1136/bjsports-2021-104926) | Trunk control training helped pain and function in lumbar disc herniation in the short term (low to very low certainty). |
| S10 | *Effect of elastic resistance training on functional capacity in older adults: a systematic review with meta-analysis*, Physiother Theory Pract 2023. [doi:10.1080/09593985.2022.2085219](https://doi.org/10.1080/09593985.2022.2085219) | Band training improves older adults' functional capacity. |
| S11 | *Optimal dose of resistance training to improve handgrip strength in older adults with sarcopenia*, Front Physiol 2025;16:1564988. [doi:10.3389/fphys.2025.1564988](https://doi.org/10.3389/fphys.2025.1564988) | Resistance training improves grip strength in older adults. |
| S12 | *Acute blood pressure response to different types of isometric exercise: a systematic review with meta-analysis*, Rev Cardiovasc Med 2023;24(2):60. [doi:10.31083/j.rcm2402060](https://doi.org/10.31083/j.rcm2402060) | Big-muscle holds raise blood pressure more than grip holds, most in older adults and people with high blood pressure. Why holds are short and at half effort, the wall sit is capped at 30s, and the safety notes name blood pressure. |
| S13 | Oranchuk et al. 2019, *Isometric training and long-term adaptations*, Scand J Med Sci Sports. [doi:10.1111/sms.13375](https://doi.org/10.1111/sms.13375) | Isometric training builds strength; longer holds (around 30s) and longer muscle lengths built more muscle than short ones. Young adults only. |
| S14 | *Protocol for a trial to assess the efficacy and applicability of isometric strength training in older adults with sarcopenia and dynapenia*, Healthcare 2025;13(13):1573. [doi:10.3390/healthcare13131573](https://doi.org/10.3390/healthcare13131573) | States the gap honestly: isometric training helps strength in older adults and allows controlled, pain-free work, but protocols for older adults still need testing. Its own holds start at 15s phases at low effort. |
| S15 | *Effectiveness of isometric exercise in the management of tendinopathy: a systematic review and meta-analysis of randomised trials*, BMJ Open Sport Exerc Med 2020;6(1). [doi:10.1136/bmjsem-2020-000760](https://doi.org/10.1136/bmjsem-2020-000760) | Isometrics are no better than moving exercise for tendon pain, and shoulder evidence is poor. Why the shoulder press-out became a band rotation. |
| S16 | Feland et al. 2001, *The effect of duration of stretching of the hamstring muscle group for increasing range of motion in people aged 65 years or older*, Phys Ther 81:1110–1117. [doi:10.1093/ptj/81.5.1110](https://doi.org/10.1093/ptj/81.5.1110) | In adults averaging 85, 60s stretches beat 15s and 30s for gains and for keeping them. |
| S17 | Katzman et al. 2017, *Targeted spine strengthening exercise and posture training program to reduce hyperkyphosis in older adults* (SHEAF RCT), Osteoporos Int 28:2831–2841. [doi:10.1007/s00198-017-4109-x](https://doi.org/10.1007/s00198-017-4109-x); and Bansal, Katzman & Giangregorio 2014, systematic review, Arch Phys Med Rehabil 95:129–140, [doi:10.1016/j.apmr.2013.06.022](https://doi.org/10.1016/j.apmr.2013.06.022) | Back and shoulder strengthening plus posture practice reduced the forward curve of the upper back in adults aged 60–88 (the review calls the wider evidence limited). The band row, band pull-apart and tall sitting hold. |

**Still set by judgment, not a study.** Where nothing better exists, as
Ed allowed: the order of blocks in a session, the split of upper and lower
body across the three days, the ~30 and ~15 minute session lengths, the
exact seconds of each hold inside the ranges above, and the 8-week cycle
length (chosen to match the app; the studies ran 8–52 weeks).

**What the program file leaves out.** No max-tested exercises, no EMOMs, no
retest week, no warm-up rotation and no weekly fatigue check (the current
check-in asks for a broad jump and max pull-ups, which don't fit). So
Steady Strength shows no "Set max", retest card, rotation card, check-in or
drop banner. A gentle weekly check (for example a 30-second chair stand
count) is a possible follow-up, not part of this work.

**How the program is chosen at the start.** The app gets a small
catalogue of programs, and a picker on the first screen:

```
 First visit (no program chosen yet)

 ┌──────────────────────────────────┐
 │ CHOOSE YOUR PROGRAM              │
 │ ┌──────────────────────────────┐ │
 │ │ Explosive Endurance        › │ │  name, goal and headline numbers
 │ │ Build explosiveness and …    │ │  read from each program file
 │ │ 8 weeks · 6 days · ~4 h/week │ │
 │ └──────────────────────────────┘ │
 │ ┌──────────────────────────────┐ │
 │ │ Steady Strength            › │ │
 │ │ Gentle holds and light …     │ │
 │ │ 8 weeks · 6 days · ~2¼ h/wk  │ │
 │ │ Check with your doctor first │ │  first safety line, when present
 │ └──────────────────────────────┘ │
 └──────────────────────────────────┘
          │ tap a card
          ▼
 the program overview (PR 11) for that program, with a
 "Before you start" card listing its safety notes just above the
 pinned "Start Day 1: Legs and core" button, and a "Switch program"
 link at the top that goes back to the picker.
```

- **Address:** the picker is `#/programs`. A first visit with no program
  chosen opens it instead of the overview.
- **Ed's phone doesn't change.** If Explosive Endurance already has data
  (a start date, a log, maxes), that counts as having chosen it: the app
  keeps opening on Today as now.
- **Switching never deletes anything.** Each program keeps its own start
  date, maxes, log and check-ins, so tapping the other program and coming
  back finds everything as it was. Because of that, tapping a card saves
  it as the active program straight away, with no confirmation.
- **Where else it's reachable:** "Switch program" on the overview, and a
  "Program: Steady Strength · Switch" row in Settings.
- **Everything follows the active program:** Today, the day plans,
  logging, history, progress charts and export.
- **Safety notes stay visible:** the "Before you start" card is on that
  program's overview every time (not only before starting), and the first
  line also shows on its picker card. Today gets a small "Safety notes"
  link under the header that opens the full list in the existing bottom
  sheet. Explosive Endurance has no `safety` list, so nothing changes for
  it.
- **Alternatives considered:** a dropdown in Settings only (hidden from a
  first-time user, who is exactly who needs to choose), and one shared log
  for both programs with the start date cleared on a switch (simpler, but
  a test run of the other program would mix into Ed's history and charts).

**Code shape.**

```
 public/programs.json  { "programs": [ { "id": "explosive-endurance", "file": "program.json" },
                                       { "id": "steady-strength",     "file": "steady-strength.json" } ] }
        │ loadCatalogue()   (CatalogueWire → ProgramCatalogue)
        ▼
 each file ──loadProgram()──▶ Program      a file that fails to parse only
                                            disables its own picker card
        │
 active program id  ◀── "workout-app.active-program" (ActiveProgramWire)
        │
        ▼
 storage keys per program:  explosive-endurance.settings / .log / ...  (unchanged)
                            steady-strength.settings / .log / ...      (new)
```

- `public/program.json` stays where it is, so Ed's edit habit, the
  service worker's precache and the project-files copy keep working. The
  new file is `public/steady-strength.json`, also precached for offline use.
- `program.safety` is a new optional list of strings. `fatigueCheck`,
  `warmupRotation` and `coreProgressions` become optional; the app hides
  the check-in, drop banner and rotation card when they are absent.
  Explosive Endurance's file still has them, so it behaves exactly as now.
- New block type labels: Balance, Isometric holds, Strength, Walk and
  Cool-down, next to the existing ones in `BLOCK_LABELS`. A block type the
  labels don't know already falls back to the raw id; the new ones get
  proper names.
- Storage modules take a program id and build their keys from it; the
  Explosive keys stay byte-for-byte the same, so no migration. The export
  file gets a `programId` (export wire v2; a v1 file is read as Explosive
  Endurance), and importing a backup made for the other program is refused
  with a message saying which program it belongs to.
- Settings hides the "Max reps" section when the program has no
  max-tested exercises.
- Per CLAUDE.md section 6, the catalogue and the active-program key each
  get their own wire type and mapping functions.
- Per CLAUDE.md section 10, a lower-cost subagent implements each step,
  I review and commit it, and a new higher-reasoning subagent challenges
  each PR before it opens.

### PR 15 — Program catalogue and per-program storage *(internal refactor)*
No visible change: Explosive Endurance is the only program in the
catalogue, and the app behaves exactly as before. This lands the risky
plumbing (loading, storage keys, export) on its own, so a mistake shows up
as a broken Explosive flow in review rather than hiding inside the new
program.

**Steps.**
1. [x] `public/programs.json` with one entry, its wire type, parser and
   loader, and `main.ts` loading the active program through it. Unit
   tests for the catalogue parser (missing file, duplicate id, bad id).
2. [x] Storage keys built from the program id (settings, max history, log,
   check-ins, snoozes, dismissals), with a unit test that Explosive's keys
   are unchanged. The active-program key and its wire type.
3. [x] Export wire v2 with `programId`, reading v1 as Explosive, and the
   import refusing another program's backup. Unit tests.
4. [x] `fatigueCheck`, `warmupRotation` and `coreProgressions` optional in
   the parser, and the UI hiding what depends on them. Unit tests with a
   cut-down program fixture. The whole E2E suite passes unchanged.
5. [x] Fixes from the challenger review. It compared every screen,
   storage key, export name and old-backup path with `main` and found no
   change for Explosive Endurance. Fixed: an E2E import of a version 1
   file, undo refusing another program's backup and undo of old backups
   pinned, file names in startup errors, "(missing)" for a missing
   `programId`, the README warning never to rename an existing program id
   or reorder the catalogue carelessly, `programs.json` documented and
   tested as cache-first, and stale comments. Not fixed, on purpose:
   - The Import card checks the program only after the whole file parses,
     so another program's broken file shows a section error first. Rare,
     and the program check still runs before anything is written.
   - A program with a retest and a max-tested pull-up but no
     `fatigueCheck` would still record the retest as a weekly check.
     Neither program has that combination.
- **Merge point:** the app runs from the catalogue with per-program
  storage, and every existing test still passes.

### PR 16 — Steady Strength program and the program picker *(behavior change)* — merged as PR #25
**Learned from the PR 15 review** (shapes the steps below):
- **Choosing at startup:** with no stored choice, Explosive Endurance
  opens when it has saved data (start date, log or maxes); otherwise the
  picker opens. This goes in `chooseCatalogueEntry`, so the order of
  `programs.json` stops mattering, and "nothing stored" stays distinct
  from "stored id not in the catalogue" (which opens the picker).
- **Loading:** all program files are loaded at startup, so the picker can
  show each name, goal and weekly numbers, and a file that fails to parse
  only disables its own card instead of blocking the app.
- **Switching** saves the active program and reloads the page, because
  the app shell holds one program's keys and data from startup.
- **Offline edits:** every program file listed in the catalogue is
  network-first like `program.json` (`programs.json` itself stays
  cache-first), so edits to `steady-strength.json` behave the same.
- **Wording:** the import messages name programs, not ids, and the "not
  an Explosive Endurance export file" message becomes program-neutral.

**Steps.**
1. [x] `public/steady-strength.json` exactly as tabled above (with the
   `evidence` links from the Evidence table), the
   `program.safety` field in the parser and model, the new block labels,
   and the catalogue entry. README program notes. Unit tests for the
   worked examples below.
1b. [x] Show Steady Strength's exercises where the app picks "key" ones:
   the overview's day rows and the day plan list key exercises only from
   `explosive` and `mainStrength` blocks, and Progress charts only chart
   `mainStrength`, `miniDose` and `explosive`. Add `isometric` and
   `strength` to the key-exercise blocks and `strength` to the charted
   blocks (holds log no reps, so they have nothing to chart). Explosive
   Endurance has none of these block types, so it doesn't change.
2. [x] The picker screen at `#/programs`, the first-visit redirect, the
   "Switch program" links on the overview and in Settings, and the hidden
   "Max reps" section. README.
3. [x] The "Before you start" card on the overview, its first line on the
   picker card, and the "Safety notes" link and sheet on Today.
4. [x] E2E (`e2e/programPicker.spec.ts`): a first visit shows both
   programs; choosing Steady Strength shows its overview with the safety
   card, and "Start Day 1: Legs and core" opens Today at Week 1 · Day 1 with
   the six blocks and no check-in; an interval hold starts the timer;
   switching to Explosive Endurance and back keeps each program's start
   date and logged sets. A started Explosive program still opens on Today.
5. [x] Fixes from the challenger review: weekly time rounds to 15 min,
   safety wording on the suitcase hold, back extension and holds, Safety
   notes on rest days, picker card names, and E2E for broken program files.
   Left as they are, with reasons in the PR: the large step 2 commit,
   `hasSavedProgramData` ignoring check-ins (Explosive always has a start
   date once used), and the thin older-adult evidence for some holds.
- **Merge point:** a first-time user can choose Steady Strength, read its
  safety notes and train Day 1 from Today.

### PR 17 — Plan: no-equipment swaps for Explosive Endurance *(design)* — merged as PR #26
Ed wants to be able to train Explosive Endurance away from his kit. He
agreed this flow (12 Nov):

1. Before a session, he ticks "No equipment" beside any exercise he can't
   do with what he has. Unticked exercises stay exactly as written.
2. Swaps only, chosen per exercise. There is no whole-session switch.
3. A swapped exercise keeps its sets and rest, and its reps or time go up
   to make up for the lost load. For example pike push-ups go from 3 × 10–15
   to 3 × 15–20, and a single-leg RDL with a backpack goes to 3 × 12–15 per
   leg with a 3s hold at the bottom.
4. Explosive swaps keep the same reps. Jumps, throws and bounds are about
   moving fast, not about load, so they need no extra dose.

This section is the plan; PR 18 and PR 19 implement it. The main program
stays as it is: every swap is an extra, optional field next to the item it
replaces, so a session with nothing ticked is identical to today's.

**"No equipment" means household items.** The swaps use a backpack loaded
with books, a full water jug or bottles, a sturdy chair, table, stair or
door, a sofa and the floor. A band, a bar or a bench doesn't count. The
med ball slam's existing `alternative` (explosive chest-to-bar pull-ups)
needs a bar, so it stays as an alternative on the sheet and isn't a swap.

**How the dose is set.** These rules turn the four agreed points into
something the file and the app can check:

- **Kept from the original, always:** the number of sets, rest, format
  (straight sets, EMOM, interval), EMOM minutes, interval rounds and work
  and rest seconds, per side, optional, `weeklyIncrease` and
  `sameEveryWeek`. The file can't override them, so a swap can't change
  them by mistake. The deload halving, weekly increases and power
  endurance timer changes then apply to the swap exactly as they would to
  the original.
- **Raised for lost load:** reps (or hold time) on main strength and core
  items, by roughly 5 reps or a third, rounded to tidy numbers, and
  sometimes a pause or hold at the hardest point instead of more reps.
- **Same reps:** explosive items (agreed point 4) and the heavy bag
  finisher. Shadow boxing is about snapping punches for the same rounds,
  so it's treated like explosive work.
- **Same dose:** warm-ups, which are light practice to begin with.
- **"Easy, ~50% effort" stays as written** on mini-doses, because an
  effort-based dose already adjusts itself to an easier exercise.
- **Never from a tested max.** Someone training without a bar can't test
  max pull-ups, so swaps for max-based items (the pull-up and dip EMOMs
  and mini-doses) get their own figures: a starting range that still gets
  "+1 rep per minute" each week, or "easy, ~50% effort" on a mini-dose.
  In week 8 a swapped EMOM holds week 7's figure for the whole week (as a
  plain deload holds), whatever max is saved, because it never uses one.
- **Descriptive text isn't carried over.** The original's `load`, `note`
  and `tempo` describe its kit ("hold a plate", "wrist straps are fine"),
  so the swap writes its own, which keeps the JSON readable on its own.

**The swaps.** One swap per item. Where Ed's earlier list gave two options,
the second becomes a cue when it has the same dose (a water jug instead of
the backpack), and is dropped when it would need a different dose (see
"Changes from the earlier list" below). Every swap rests on coaching
practice, and its `evidence` says so.

Explosive (same sets, reps and rest):
| Day | Original | Swap | Dose (week 1) | Cues |
| --- | --- | --- | --- | --- |
| 1 | Med ball slams 6 × 6, 30–45s rest | Explosive inverted rows under a table | 6 × 6, 30–45s rest | Test the table first: it mustn't tip or slide. Lie under the middle, grip the edge, pull the chest to the edge fast, then lower under control. Walk the feet in to make it easier |
| 4 | Kettlebell swings, 8-min EMOM × 12–15 | Backpack swings | 8-min EMOM × 12–15 | Hold the top handle with both hands; zip it shut and tuck the straps; a full water jug by its handle works too; snap the hips, arms stay loose |
| 5 | Dumbbell push press 5 × 5, 45s rest | Backpack push press | 5 × 5, 45s rest | Hug the backpack at the top of the chest, or a water jug in each hand at the shoulders; dip and drive |
| 2, 3, 6 | Split-squat jumps, plyo push-ups, lateral skater bounds | No swap | — | No kit needed, so no tick shows |

Main strength and mini-dose (same sets and rest, reps raised):
| Day | Original | Swap | Dose (week 1) | Cues |
| --- | --- | --- | --- | --- |
| 1 | Pull-ups, 9-min EMOM at 40% of max, +1 rep per minute each week | Inverted rows under a table | 9-min EMOM × 6–8, +1 rep per minute each week | Test the table first: it mustn't tip or slide. Lie under the middle and grip the edge. Walk the feet in to make it easier. A towel round the handle of a closed door that opens away from you works too |
| 5 | Pull-ups mini-dose 2 × 50% of max | Inverted rows under a table | 2 × easy, ~50% effort | As above |
| 3 | Dips, 9-min EMOM at 40–50% of max, +1 rep per minute each week | Chair dips | 9-min EMOM × 8–10, +1 rep per minute each week | Chair against a wall so it can't slide; bend the knees to make it easier, straighten the legs to make it harder; shoulders down |
| 1 | Dips mini-dose 2 × 50% of max | Chair dips | 2 × easy, ~50% effort | As above |
| 5 | Overhead press / pike push-up 3 × 10–15, 60s rest, 2s lowering | Pike push-ups | 3 × 15–20, 60s rest, 2s lowering | Hips high, head lowers between the hands. Ed's worked example |
| 3 | Overhead press / pike push-up mini-dose 2 × easy | Pike push-ups | 2 × easy, ~50% effort | |
| 2 | Zercher Bulgarian split squat 3 × 12–15 per leg, 45s between rounds | Backpack Bulgarian split squat | 3 × 15–20 per leg, 45s between rounds, 2s pause at the bottom | Hug the backpack in the crook of the elbows (Zercher style), or hold it at the chest goblet style; rear foot on a chair or sofa; torso upright; switch legs without rest |
| 6 | Zercher Bulgarian split squat mini-dose 2 × easy per leg | Backpack Bulgarian split squat | 2 × easy, ~50% effort per leg | |
| 4 | Single-leg RDL 3 × 10–12 per leg, 3s lowering | Backpack single-leg RDL | 3 × 12–15 per leg, 3s lowering, 3s hold at the bottom | Backpack or water jug in both hands; hips square. Ed's worked example |
| 2 | Single-leg RDL mini-dose 2 × easy per leg | Backpack single-leg RDL | 2 × easy, ~50% effort per leg | |
| 6 | Single-leg calf raise: 1 × 8–10 heavy, then 2 × 15–25, 2s pause at the bottom | Stair calf raise with a backpack on | 3 × 20–30 per leg, 2s pause at the bottom | Heel drops below the stair; hold the rail. The heavy first set can't be matched without weight, so every set is the same |
| 4 | Single-leg calf raise mini-dose 2 × easy per leg | Stair calf raise | 2 × easy, ~50% effort per leg | |

Core and finisher:
| Day | Original | Swap | Dose (week 1) | Cues |
| --- | --- | --- | --- | --- |
| 1 | Back extension 4 × 12–15 holding a plate, 2s hold at the top | Prone back extension | 4 × 15–20, 2s hold at the top | Face down on the floor, hands by the ears; lift the chest so the extra range comes from the upper back, not the lower back |
| 5 | Back extension 3 × 20 bodyweight | Prone back extension | 3 × 25, 2s hold at the top, slow | As above. The Day 5 lower-back rule still applies |
| 1 | Hanging leg raise 3 × 6–10 | Lying leg raise | 3 × 10–15, 2–3s lowering | Hands under the hips, lower back stays down; bent knees to make it easier |
| 5 | Hanging leg raise 4 × 8–12, 2–3s lowering | Lying leg raise | 4 × 15–20, 2–3s lowering | As above |
| 1, 5 | Heavy bag 4–5 rounds × 20–30s / 30s rest | Shadow boxing | 4–5 rounds × 20–30s / 30s rest (power endurance +5s still applies) | Snap every punch back as fast as it went out; hands up; move the feet |
| 1, 3, 5 | Side plank, hollow hold, crab core moves | No swap | — | No kit needed |

Warm-ups (same dose):
| Day | Original | Swap | Dose | Cues |
| --- | --- | --- | --- | --- |
| 1, 3 | Pallof press 12–15 | Plank shoulder taps | 12–15 per side | Feet wide, hips still: the same "don't let it turn you" job as the Pallof press |
| 3, 5 | Lateral raise 12–15 | Bottle lateral raise | 12–15 | A water bottle in each hand |
| 3 | Plate halo, 8 each direction, 5–10 kg plate | Water jug halo | 8 each direction | A full water jug or a heavy book, close to the head; ribs down |
| 2, 4 | Hip abduction / adduction 12–15 | Side-lying hip raises | 12–15 each way | Lie on your side: lift the top leg (abduction), then the bottom leg with the top foot in front (adduction) |
| 1, 2, 4, 5, 6 | YTWI raises, Cossack squat, single-leg hip thrust | No swap | — | YTWIs work lying face down on the floor, and the hip thrust with the shoulders on a sofa |

Rotated-in warm-ups (Kickbacks, Reverse fly, Ab raises, Tricep pushdown)
are free text in `warmupRotation`, not items, so they get no tick. In a
rotated week the item they replace shows no tick either.

**Changes from the earlier list.** Ed's list was a starting point; these
are the refinements, for him to confirm on the PR:

- **Pallof press:** a towel round a door frame gives nothing to resist, and
  a band isn't household kit, so the swap is plank shoulder taps, which do
  the same anti-rotation job.
- **Dropped second options** that would need a different dose under the
  "one swap per item" rule: the arm-swing jump (slams), broad jumps
  (swings), the pike jump (push press), the superman hold (back
  extension), the reverse crunch and dead bug (leg raise), and the pillow
  (heavy bag).
- **Added:** hip abduction / adduction (side-lying raises), which the
  earlier list didn't cover.
- **Pull-up and dip swaps don't use the tested max** (see the dose rules).

**What the person sees.**

```
 Today, Week 1 · Day 4 (Lower: hinge)

 ┌──────────────────────────────────────┐
 │ 2 EXPLOSIVE                          │
 │ Kettlebell swings                ⓘ  │
 │ 8-min EMOM × 12–15                   │
 │ [ ] No equipment                     │   tick before the first set
 ├──────────────────────────────────────┤
 │ 3 MAIN STRENGTH                      │
 │ Backpack single-leg RDL          ⓘ  │   ticked: name, dose and
 │ 3 × 12–15 per leg · 3s lowering,     │   sheet are the swap's
 │ 3s hold at the bottom                │
 │ Instead of Single-leg RDL            │
 │ [x] No equipment                     │
 └──────────────────────────────────────┘
```

- The tick shows only on items whose file entry has a swap. Ticking or
  unticking changes the row, its log screen, its timer and its exercise
  sheet straight away. The sheet for a swapped item shows the swap's cues
  and evidence and says what it replaces; the sheet for an unticked item
  with a swap gets a "No equipment" section naming the swap and its dose.
- **Ticks belong to one session.** A tick is saved for that date only, so
  every session starts as written (agreed point 1).
- **Logging decides after the first set.** Sets of a swapped item are
  logged under the swap's exercise id (for example `backpack_single_leg_rdl`),
  so "last time", History, Progress charts and the CSV export keep swaps
  apart from the real thing with no change to the log's wire format: a
  backpack RDL never pre-fills the loaded RDL's kilograms. Once an item has
  a logged set, its tick is locked to match (the row keeps
  "Instead of Single-leg RDL" and adds "· sets logged"); deleting the item's sets unlocks it. Today and the log
  screen work out "swapped" from the logged sets first and the saved tick
  second, so a log restored from an export (which doesn't carry ticks)
  still shows the swap.
- **Where a tick is allowed:** wherever logging is allowed, so a past date
  in a `?date=` preview can be ticked to backfill, and a future one can't.
- **Unchanged:** the overview, day plans, weekly minutes, retest card,
  check-in and Steady Strength (which has no swaps).

**Code shape.**

```
 program.json item  { "exercise": "single_leg_rdl", "sets": 3, "reps": "10-12", ...,
                      "noEquipment": { "exercise": "backpack_single_leg_rdl",
                                       "reps": "12-15",
                                       "tempo": "3s lowering, 3s hold at the bottom" } }
        │ parseProgram()   (NoEquipmentSwapWire → NoEquipmentSwap)
        ▼
 BlockItem.noEquipment?  ─────────────┐
                                      │
 "<programId>.no-equipment"           │
   (NoEquipmentTicksWire ⇄ ticks) ──▶ buildSession(program, settings, date, swappedItems)
 log: sets under the swap's id ─────▶     │ applyNoEquipmentSwap(item) for each swapped item
                                          ▼
                                     ItemView (swap's exercise and dose, swappedFrom: original)
                                          │
                                          ▼
                                     Today, log screen, timers, sheet
```

- **Wire:** a new optional item field `noEquipment` with `exercise`
  (required, a key of `exercises`) and optional `reps`, `durationSec`,
  `load`, `note` and `tempo`. Anything else in it (`sets`, `restSec`,
  `minutes`, `rounds`, `format`, `repsPctOfMax`, ...) is a parse error
  naming the path, because a swap keeps those from the original. Also
  errors: a swap exercise that is `maxTested`, a swap of a max-based item
  with no `reps` of its own, and a swap that is its own original. Like every boundary, it gets its own wire type and
  mapping function (CLAUDE.md section 6).
- **Library:** the 16 swap exercises are ordinary `exercises` entries
  (`explosive_inverted_row`, `backpack_swing`, `backpack_push_press`,
  `inverted_row`, `chair_dip`, `pike_push_up`,
  `backpack_bulgarian_split_squat`, `backpack_single_leg_rdl`,
  `stair_calf_raise`, `prone_back_extension`, `lying_leg_raise`,
  `shadow_boxing`, `plank_shoulder_tap`, `bottle_lateral_raise`,
  `water_jug_halo`, `side_lying_hip_raise`), each with a name, the
  original's category, cues and `"evidence": "coaching practice"`, so the
  existing sheet, History and charts handle them without special cases.
- **Schedule:** `applyNoEquipmentSwap(item)` builds the effective item
  (the original's structure, the swap's exercise, reps and text), and
  `buildItem` runs on that, so halving, weekly increases and timer
  adjustments need no new code. The one change in `chooseIncrease`: an
  EMOM whose effective reps aren't max-based holds the previous week's
  offset for the whole retest week.
- **Ticks:** their own key `<programId>.no-equipment`, with a versioned
  wire type: `{ "version": 1, "ticks": { "2026-11-05": ["3:single_leg_rdl"] } }`
  (block position and original exercise id). Re-read before each save,
  like the log. Dates more than 14 days old are dropped on save, since
  logged sets carry the lasting record. Not exported: an export already
  carries the swapped sets.
- **Tests:** unit tests for the parser errors, the worked examples below,
  and data checks over the shipped file (every explosive and heavy bag
  swap has the same reps as its original, and no swap needs a max). E2E:
  tick a swap on Today, see the swapped dose, log a set, see it locked,
  reload, and see last week's swap as "Last time" next week.
- Per CLAUDE.md section 10, a lower-cost subagent implements each step,
  I review and commit it, and a new higher-reasoning subagent challenges
  each PR before it opens.

**Alternatives considered.**
- **A whole-session "home day" switch:** simpler UI, but Ed chose per
  exercise, since he often has some kit (agreed point 2).
- **The swap on the exercise library entry instead of the item:** one entry
  per exercise, but the same exercise has different doses on different
  days (the RDL is 3 × 10–12 on Day 4 and an easy mini-dose on Day 2), so
  the dose has to live on the item.
- **A choice of two swaps per item:** keeps all of Ed's options, but turns
  one tick into a tick plus a picker, and doubles the doses to check. One
  swap, with same-dose variants as cues, covers the common case.
- **Remembering ticks between sessions:** fewer taps when kit is missing for
  weeks, but it contradicts "unticked exercises stay as written" and would
  silently carry a swap into a gym day. It's an easy follow-up if wanted.

### PR 18 — No-equipment swaps in the program file *(behavior change)* — merged as PR #27
The data and the parser, shown only on the exercise sheet, so the doses
can be reviewed on a phone before anything changes how a session runs.

**Steps.**
1. [x] `noEquipment` in the wire types, parser and model, with the errors
   listed above and the "did you mean" hint for misspelt keys. Unit tests,
   including the cut-down program fixture.
2. [x] The 16 swap exercises and every swap in `public/program.json`
   exactly as tabled above. Data tests over the shipped file. README:
   "Editing program.json" documents `noEquipment` and its rules.
3a. [x] The schedule builds each swap's view for the week
   (`applyNoEquipmentSwap`, the retest-week hold, `ItemView.noEquipment`),
   moved here from PR 19 because the sheet shows this week's dose. Unit
   tests for the worked examples.
3b. [x] The exercise sheet's "No equipment" section (swap name and this
   week's dose). E2E: the Day 4 RDL sheet names "Backpack single-leg RDL:
   3 × 12–15 · per side" (the app's formatter says "per side", as on Today).
4. [x] Copy the new `public/program.json` to the project files (the copy
   there is from before PR 13) and add a "No-equipment swaps" section to
   "Explosive Endurance Program.md" with the tables above.
5. [x] Fixes from the challenger review. It found no wrong figure: every
   unticked session for 2 Nov to 31 Dec matches `main`, every original
   item is unchanged, and every swap dose matches the tables and worked
   examples. Fixed: the Day 5 lower-back rule moved from a cue (it showed
   on Day 1 too) to a Day 5 note, stale doc comments, the step 3b text, a
   cue to check the backpack's handle, en dashes in the warm-up reps, the
   parser refusing a swap that changes hold to reps or reps to hold, and
   rotated-in warm-ups dropping the original's swap. Carried into PR 19
   (below): the log lookups that need to know swap ids. Left as is: the
   swap data test doesn't pin cues, loads and notes word for word.
- **Merge point:** the file carries every swap, the sheet shows them, and
  every session is unchanged.

### PR 19 — Tick "No equipment" and train the swap *(behavior change)*
**Learned from the PR 18 review** (shapes the steps below): logging swapped
sets under the swap's id isn't free. These lookups match a logged set to a
program item by `item.exerciseId` alone, so a swapped set would match no
item: "Last time" (`log/lastTime.ts`, `blockTypeOfLoggedSet`), Progress
charts (`log/progress.ts`), History's set/minute wording
(`ui/historyText.ts`, `findProgramItem`) and the log screen's route
(`ui/logScreen.ts`). Each must also match `item.noEquipment?.exercise.id`,
with a test. Pike push-ups are logged as `pike_push_up`, separately from
"Overhead press / pike push-up", which is the point of a swap but splits
that one exercise's history.

**Steps.**
1. [x] A ticked item uses its swap view: `buildSession` is unchanged; the
   pure `applyNoEquipmentChoices(session, swappedKeys)` in
   `src/program/noEquipment.ts` replaces items whose key
   (`noEquipmentItemKey(blockPosition, originalExerciseId)`, e.g.
   "3:single_leg_rdl") is ticked with their `ItemView.noEquipment` view and
   sets `ItemView.swappedFrom`. Helpers `hasNoEquipmentSwap` and
   `originalExerciseIdOf` build keys for Today and the log screen. Unit tests
   for the ticked worked examples.
2. [x] The ticks storage key, its wire type, mapping and pruning. Unit
   tests.
3a. [x] The log side, no UI. `src/noEquipment/choices.ts`:
   `noEquipmentChoices(unswappedSession, log, date, ticksForDate)` returns
   `{ swapped, locked }` key sets (sets under the swap's id: swapped and
   locked; under the original's id: not swapped, locked, whatever the tick
   says; else swapped iff ticked); `isExerciseLoggedForItem` (in
   `program/noEquipment.ts`) lets "Last time" (`lastTime.ts`), Progress
   (`progress.ts`) and History's wording (`historyText.ts`) match a set
   logged under a swap id to the item it replaces, so a swap has its own
   last time and chart and an unswapped item ignores swap sets. Unit tests
   incl. the "Logging" worked example, and a CSV test (swap id and name).
3b. [x] The tick on Today, the swapped row, log screen, timers and sheet,
   logging under the swap's id, the lock after the first set ("Instead of
   ... · sets logged"), session progress counting swapped sets. README. Notes from 3a:
   - Build the unswapped session, call `noEquipmentChoices` with
     `ticksForDate`, then `applyNoEquipmentChoices(session, choices.swapped)`;
     use `choices.locked` to disable the tick (the row keeps "Instead of
     <original>" when swapped).
   - `renderLogScreen` (`ui/logScreen.ts`, ~line 110) finds its item with
     `candidate.exercise.id === exerciseId` on the plain `buildSession`
     result: it must build the swapped session the same way, so the route's
     exercise id (the swap's id when swapped) matches. Today's route
     (`logRouteHash(..., item.exercise.id)`) then carries the swap id.
   - `isSessionInProgress` (`log/sessionProgress.ts`), Today's "2/6"
     (`ui/today.ts` ~345) and the log screen's `setsForItem` calls all use
     `item.exercise.id`, so they count swapped sets once they are handed the
     swapped session. `isSessionInProgress` must get the swapped session.
   - The rest-memory key uses `item.exercise.id`, so a swap remembers its
     own rest, separate from the original's.
   - A tick toggled after the first set must not change anything (locked).
4. [x] E2E (`e2e/noEquipment.spec.ts`): the flow in the code shape notes,
   plus an unticked session matching today's exactly.
5. [x] Fixes from the challenger review. It checked every worked
   example with every box ticked, and Today with nothing ticked matched
   `main` on every date apart from the new tick lines. Fixed: a backfill
   tick on a date more than 14 days old was silently pruned; Today's
   wording ("Instead of ..." stays when sets are logged, no extra line on
   an unswapped row, a dimmed disabled box that tells screen readers
   why); stale doc comments and two unused helpers; and E2E for deleting
   the set to unlock, the lock on the original, a restored log and the
   backfill. Left as they are, with reasons in the PR: a log address
   with the other exercise's id says "nothing to log"; a second open tab
   only sees new ticks once it toggles or reloads, as with the log; and
   each swappable row is about 56px taller, as in the approved mockup.
- **Merge point:** Ed can tick any swap on Today, train it with the right
  dose and timer, and see it in History.

### PR 20 — Plan: "Show me" animations for Steady Strength *(design)* — merged as PR #28
Ed asked (12 Nov) for an animation of every exercise in Steady Strength,
opened from the exercise, so that someone aged 75 or over with poor
eyesight can see quickly how to do the movement. The program is for a
person with a history of slipped discs in the lower back, so the
animations must only ever show the safe range the program asks for.

This section is the plan; PR 21 and PR 22 implement it. Explosive
Endurance is out of scope: its rows don't change.

**What the person sees.**

```
 Today (Steady Strength, Day 1)                 "Show me" view (full screen)
 ┌────────────────────────────────────┐         ┌────────────────────────────────────┐
 │ High wall sit          3 × 20s     │         │ ‹ Close            High wall sit   │
 │ [ Rest 40s ]  [ ▶ Show me ]        │──tap──▶ │ ┌────────────────────────────────┐ │
 └────────────────────────────────────┘         │ │  (wall)  big 3D mannequin      │ │
                                                │ │   │  O    sliding a little way   │ │
                                                │ │   │ /|    down the wall        │ │
                                                │ │   │  |_                        │ │
                                                │ └────────────────────────────────┘ │
                                                │        HOLD                        │  ◀ big step label
                                                │ Back on the wall. Slide down a     │  ◀ one-line cue
                                                │ little and hold.                   │
                                                │ [ ↻ Turn: side · front · angle ]   │  ◀ turns the camera
                                                │ [ ❚❚ Pause ]   [ Slower ]          │
                                                └────────────────────────────────────┘
```

1. **Where it opens.** Every Steady Strength row on Today and on the day
   plan gets a large "▶ Show me" button beside it, a sibling of the row
   button like "Start EMOM", so tapping the row still opens the log screen.
   The log screen's header also gets "Show me" next to ⓘ. The button only
   appears for exercises that have an animation, so it never appears on
   Explosive Endurance.
2. **The view.** A full-screen overlay like the timer: the Back button or
   gesture, Escape and "Close" all close it and return focus to the button
   that opened it (it reuses `closeOnBack`). The screen behind is inert.
3. **The figure.** One large 3D mannequin, like an artist's wooden
   figure, on a plain black background (Ed, 12 Nov: 3D rather than stick
   figures; white on black). It is built from smooth rounded shapes (a
   head, a chest and pelvis, and tapered limbs with rounded joints and
   simple hands and feet), with no face, hair or clothing detail to pick
   out. The body is matt white with soft lighting from the front and above,
   so its shape reads in 3D without dark shadows; the body parts that move
   are yellow (#FFD60A) so the eye goes straight to them. The far-side limbs
   are naturally shaded a little darker, which tells near from far.
   Furniture (counter, chair, wall, door frame, stair, bed) is plain mid
   grey blocks; things held (band, ball, bag, tin) are yellow like the
   moving parts. A faint floor line under the feet and nothing else: no
   room, textures or cast shadows.
4. **Start and end of each rep.** A rep is: start position held 1.5s, a
   slow 2.5s move, end position held 1.5s (or 4s for a hold exercise,
   labelled "Hold"), a slow 2.5s move back. About 8 to 10 seconds a loop,
   repeating until closed. A big step label under the figure says what is
   happening ("Start", "Stand up", "Hold", "Sit down slowly"). "Slower"
   halves the speed. "Pause" freezes the figure where it is.
5. **One-line cue.** One sentence per exercise in at least 24px type
   under the step label (table below). The full cues stay on the ⓘ sheet.
6. **Views.** Each exercise opens at the camera angle that shows its
   movement best ("View" in the table): side, front, or a three-quarter
   angle, which shows depth best in 3D. One "↻ Turn" button moves the
   camera smoothly round to the next of side, front and three-quarter, and
   the loop keeps its place. There is no drag-to-rotate, so a shaky touch
   can't knock the view sideways. Hand and foot exercises (grip squeeze,
   wrist curl, ankle pumps) are framed close up so the hand or foot fills
   the panel.
7. **Reduced motion.** With "Reduce motion" on in the phone's settings, the
   figure doesn't move by itself. It shows the start and end positions side
   by side, labelled "Start" and "End" (and "Hold" for hold exercises),
   with a "Next step" button that steps through the positions on a tap.
   "Turn" jumps straight to the next angle instead of swinging round.
8a. **No 3D on the phone.** If the browser can't draw 3D (WebGL is off or
   missing), the view draws the same poses flat, as a thick outline figure
   from the same joint positions, so every exercise still has its
   animation and cue.
8. **The dose isn't animated.** The view says this week's dose in its
   header (for example "3 × 20s") from the same text as the row, but the
   loop shows one rep (or a short hold) only. Showing a real 20s hold or
   12 reps would be too slow to take in.
9. **Swaps and alternatives.** Each animation shows the main exercise,
   never its `alternative` (for example the glute bridge, not the standing
   buttock squeeze). Where an exercise has a `progression` of supports
   (counter, then fingertips, then hovering; two hands, one hand, none), it
   shows the first, most supported stage, because that is the safe one to
   learn from.

**Safe range only.** Every pose stays inside what the program's own cues
allow, and the lower back is shown neutral throughout: no rounding to
reach the floor, no loaded bending, no twisting. Where a cue sets a limit,
a unit test checks the poses against it, so a later edit can't drift past
it:

| Exercise | Limit shown (and tested) |
| --- | --- |
| High wall sit | Knees bent no more than a quarter: knee angle at least 135° |
| Standing back extension | A small arch only: trunk back no more than 10° from upright |
| Glute bridge hold | Hips lift to a straight shoulder–hip–knee line and no higher (no arch) |
| Sit-to-stand, stair step-up | The trunk tips forward from the hips with a straight back, no more than 30° |
| Standing bird dog | Leg slides back with the toes on or just off the floor; hips level, back flat |
| Suitcase hold | The bag starts on the counter, never lower than the hand at the side; no lean |
| Head turns | About 45° each way, no tipping the head back |
| Counter plank, counter push-up, wall side plank | Body in a straight line from head to heels in every pose |
| Calf, doorway chest stretch | A gentle lean only; no bouncing (the move into it is as slow as any other) |

**The exercises.** All 34 in `public/steady-strength.json`. "View" is the
camera angle it opens at ("Turn" reaches the others); "Moves" is what is
in yellow.

| # | Exercise | View | Start → end | Moves | One-line cue |
| --- | --- | --- | --- | --- | --- |
| 1 | Head turns | Front, close up | Facing forward → head turned to one side; then the other side | Head | Sit or stand tall and turn your head slowly to one side, then the other. |
| 2 | Neck retraction | Side, close up | Head forward, hand on the chin → head slid straight back, chin level | Head, hand | With a hand on your chin, slide your head straight back. |
| 3 | Standing back extension | Side | Standing, hands on the lower back → leaning back a little | Trunk | Hands on your lower back, lean back just a little. |
| 4 | Ankle pumps, seated | Side, close up | Foot flat → toes pulled up → toes pointed | Foot | Sitting, pull your toes up, then point them. |
| 5 | Single-leg stand | Three-quarter | Both feet down, hand on the counter → one foot lifted a little | Lifted leg | Hold the counter and lift one foot a little off the floor. |
| 6 | Heel-to-toe stand | Side | Feet side by side → one foot stepped in front, heel touching toe, held | Front foot | Hold the counter, put one foot right in front of the other and stand still. |
| 7 | Heel-to-toe walk | Side | Steps along the counter, each heel to the other toe | Legs | One hand on the counter, walk with each heel touching the other toe. |
| 8 | Sideways walking | Front | Side steps along the counter, feet never crossing | Legs | One hand on the counter, step sideways and don't cross your feet. |
| 9 | High wall sit | Side | Standing, back on the wall → slid a little way down, held | Legs | Back on the wall, slide down a little and hold. |
| 10 | Glute bridge hold | Side | Lying, knees bent → hips lifted to a straight line, held | Hips | Lying with knees bent, lift your hips into a straight line and hold. |
| 11 | Pallof press hold | Three-quarter | Hands at the chest, band from the door at the side → arms straight out, held | Arms, band | Side-on to the door, push your hands straight out and hold. Don't turn. |
| 12 | Wall push hold | Side | Hands on the wall → leaning in on bent elbows, held | Arms | Hands on the wall, lean in on bent elbows and hold. |
| 13 | Grip squeeze | Front, close up | Open hand round the ball → fingers squeezed, held | Fingers | Squeeze the soft ball at half effort, hold, then let go. |
| 14 | Counter plank | Side | Standing at the counter → hands on it, feet back, body straight, held | Whole body | Hands on the counter, step back, keep your body straight and hold. |
| 15 | Split-stance hold | Side | Standing at the counter → one foot ahead, both knees a little bent, held | Legs | Hold the counter, one foot ahead, bend both knees a little and hold. |
| 16 | Suitcase hold | Front | Hand on the bag on the counter → bag lifted to the side, standing tall, held | Arm, bag | Lift the bag off the counter, stand tall without leaning and hold. |
| 17 | Sit-to-stand | Side | Seated, hands on the chair arms → standing; then sitting down slowly | Whole body | Lean forward a little, push through your feet and stand, then sit down slowly. |
| 18 | Heel and toe raises | Side | Standing, hand on the counter → up on the toes → back on the heels | Feet | Hold the counter, rise onto your toes, then rock back onto your heels. |
| 19 | Side hip raise | Front | Standing, hand on the counter → straight leg out to the side | Leg | Hold the counter and lift one straight leg out to the side. Don't lean. |
| 20 | Band row | Side | Arms forward holding the band → elbows pulled back, held 2s | Arms, band | Pull the band back with your elbows close and squeeze for 2 seconds. |
| 21 | Band outward rotation | Front | Elbow at the side, hand at the belly → forearm swung out to the side | Forearm, band | Elbow at your side, swing your hand out to the side and back. |
| 22 | Counter push-up | Side | Hands on the counter, arms straight → chest lowered towards it → pushed back | Arms, body | Hands on the counter, lower your chest towards it, then push back. |
| 23 | Wrist curl and reverse | Side, close up | Forearm on the table, palm up: hand curled up and down; then palm down: back of the hand lifted | Hand, tin | Forearm on the table, curl the tin up and down, then turn your hand over and lift. |
| 24 | Band pull-apart | Front | Arms out in front holding the band → arms pulled apart to the sides | Arms, band | Arms out in front, pull the band apart, then let it back slowly. |
| 25 | Stair step-up | Side | At the bottom stair, hand on the rail → stepped up with the whole foot → stepped down | Legs | Hold the rail, step up with your whole foot, then step back down. |
| 26 | Back knee bend | Side | Standing at the counter → heel brought up behind towards the bottom | Lower leg | Hold the counter and bend one knee to bring the heel up behind you. |
| 27 | Standing bird dog | Side | Both hands on the counter → one leg slid straight back, held | Leg | Hands on the counter, slide one leg straight back and hold. Keep your back flat. |
| 28 | Pallof press | Three-quarter | Hands at the chest → pressed straight out → back to the chest | Arms, band | Side-on to the door, push your hands straight out and back. Don't turn. |
| 29 | Wall side plank | Front | Side-on to the wall → forearm on it, feet a step away, body straight, held | Whole body | Side-on to the wall, forearm on it, feet a step away, body straight and hold. |
| 30 | Tall sitting hold | Side | Sitting back on the chair → shuffled forward, sitting tall, held | Trunk | Sit forward away from the chair back, sit tall, breathe and hold. |
| 31 | Slow walk | Side | A slow walking step, looping | Legs | Walk slowly for a few minutes. |
| 32 | Calf stretch | Side | Hands on the wall → one foot back, heel down, leaning in gently, held | Back leg | Hands on the wall, one foot back with the heel down, lean in gently and hold. |
| 33 | Doorway chest stretch | Three-quarter | Forearm on the door frame → stepped forward gently, held | Body, arm | Forearm on the door frame, step forward gently until you feel a stretch, and hold. |
| 34 | Walk at a comfortable pace | Side | A walking step at a normal pace, looping | Legs | Walk at a pace where you can still talk. |

The one-sided exercises (5, 6, 15, 19, 26, 27 and the single side of 32
and 33) show one side, and the step label says "Then the other side" at
the end of the loop. Head turns and sideways walking show both directions.

**Code shape.**

```
 src/demo/model.ts          Pose (3D joint rotations + where the figure stands), Prop, Demo
 src/demo/skeleton.ts       jointPositions(pose) ─▶ 3D points for every joint (forward
                            kinematics); limb lengths fixed, so a pose can't stretch a limb.
                            Pure TypeScript, no three.js, so the safety tests run in Vitest
 src/demo/timeline.ts       frameAt(demo, elapsedMs) ─▶ { pose, label, stepIndex }; the view
                            scales elapsed time for Slower and stops it for Pause
                            (pure, unit tested; eased like the crab drill artifact)
 src/demo/steadyStrength.ts the 34 demos, keyed by exercise id
 src/demo/registry.ts       hasDemo(programId, exerciseId) (cheap id list, in the main bundle);
                            loadDemo(...) ─▶ Promise<Demo | undefined> (builds demos in a lazy chunk)
 src/demo/render3d.ts       three.js scene: mannequin meshes posed from jointPositions(),
                            props, lights, camera angles (loaded only when "Show me" opens)
 src/demo/renderFlat.ts     the flat fallback, drawn from the same jointPositions()
 src/ui/demoView.ts         the overlay: picks a renderer, controls, reduced motion, Back to close
 src/ui/today.ts, dayPlan.ts, logScreen.ts   the "▶ Show me" buttons (only when hasDemo is true)

   Demo (poses) ──timeline──▶ blended Pose ──skeleton──▶ joint points ──┬─▶ render3d (WebGL)
                                                                        └─▶ renderFlat (no WebGL)
```

- **Poses are joint rotations, not points.** The crab drill artifact used
  points, which let a forearm grow or shrink between poses. Rotations at
  each joint (bend, out to the side, twist), worked out from the pelvis
  outwards, keep every limb its own length, make the safety limits above
  direct to test (a knee bend is a number in the pose) and blend smoothly.
  One pose drives every camera angle, so the side and front views can
  never disagree.
- **The mannequin is built in code, not downloaded.** Each body part is a
  rounded shape (three.js capsules and spheres) placed between two joint
  points, so no model file, rig or licence is involved, and the figure
  can't move in a way the skeleton doesn't allow.
- **three.js** (MIT licence) is the one new dependency. It is loaded as a
  separate chunk the first time "Show me" opens, so Today doesn't get any
  slower, and the service worker's precache list picks the chunk up like
  any other build file, so it works offline. Expected size: about 150 KB
  gzipped; the PR reports the real figure.
- **The demos are code, not program data.** They describe drawing, not the
  program, so they don't go in `steady-strength.json` and need no wire
  type: nothing crosses a boundary (CLAUDE.md section 6 doesn't apply).
  `hasDemo` and `loadDemo` are keyed by program id too, so an id that happens to match in
  another program doesn't pick up a Steady Strength drawing. A unit test
  fails if any Steady Strength exercise has no demo, so a new exercise in
  the file can't ship without one.
- **Animation.** One `requestAnimationFrame` loop while the view is open,
  stopped on close and while the tab is hidden, and the 3D renderer is
  disposed on close so its memory is given back. No CSS animation, so the
  reduced-motion path is just "don't start the loop".
- **Accessibility.** The canvas is `role="img"` with a label naming the
  movement and the start and end ("High wall sit: standing with your back
  on the wall, then slid a little way down and held"). The step label is
  not a live region, so a screen reader isn't interrupted every 2
  seconds. Buttons are at least 56px tall.

**Alternatives considered.** A realistic 3D human from a model library,
rigged and animated (more lifelike, but it needs a model with a licence
that allows shipping it, is 1 to 3 MB to cache, and skinned animation is
much harder to keep inside the tested safe range; fine detail such as
fingers and a face is also harder to read with poor eyesight than a clean
mannequin). Stick figures, as first planned (simplest and smallest, but
Ed asked for 3D, and a solid body shows which way a limb points much
better). Video clips or GIFs of a real person (clearer
for some people, but they need filming or licensing, are large to cache
offline, and can't highlight the moving limb or be slowed reliably).
Drawing each frame by hand as SVG files (no shared engine, so 34 drawings
would each need their own care, and the safety limits couldn't be tested).
Putting the animation on the ⓘ sheet only (one more tap to find it, and
the sheet's small type is the opposite of what this audience needs).

**Checking the drawings.** Each PR adds a script that renders every demo's
start and end frames into one contact sheet PNG, so Ed can check all the
positions at a glance on the PR. It is attached to the PR and saved in the
project files under `screenshots/demos/`.

### PR 21 — "Show me" view and the Day 1 to Day 2 exercises *(behavior change)*
**Steps.**
1. [x] `src/demo/model.ts`, `skeleton.ts` and `timeline.ts`, with unit
   tests: forward kinematics, limb lengths unchanged across poses, the
   timeline figures in the worked examples, half speed, and pausing.
2. [x] three.js added; `src/demo/render3d.ts` (the mannequin, props,
   lights, the three camera angles) and `renderFlat.ts`. A check that the
   lazily loaded chunk is in the service worker's precache list. Commit
   message records the dependency choice and its size.
   Built: the three.js chunk is about 540 KB raw, 134 KB gzipped, and
   only loads when "Show me" first opens. Vite warns about chunks over
   500 KB; the warning is expected for this chunk and is left on so any
   other large chunk still shows up.
3. [x] `src/ui/demoView.ts`: the overlay, controls, Turn, reduced-motion
   stills and "Next step", the flat fallback, Back to close and disposal.
   One demo (high wall sit) to drive it.
4. [x] The demos for every exercise on Days 1 and 2 (18 exercises: 1–6, 8–11,
   17–19, 27, 31–34), with the safety tests above that apply to them.
5. [x] The "▶ Show me" buttons on Today, the day plan and the log screen.
   README: a line on "Show me".
6. [x] E2E (`e2e/showMe.spec.ts`): on Steady Strength Day 1 the high wall
   sit row opens the view with its cue and a drawn 3D canvas, Pause freezes
   it, Back closes it and focus returns to the button; with reduced motion
   the Start and End stills show and "Next step" moves between them; Turn
   on the single-leg stand moves to the front angle; with WebGL switched
   off the flat figure shows instead; Explosive Endurance Day 1 has no
   "Show me". Screenshots of the 3D view for Ed.
7. [x] The contact sheet for these 18 (`node docs/demos/render.cjs`, see README).
8. [x] **Fixes from the challenger review.** Every suite passed and the
   mechanics (kinematics, clock, Back and focus, disposal, offline cache)
   checked out, but several drawings taught the wrong thing:
   - [x] Start-up: all demos were built at import, which made Today about
     1.4 s slower to open on a slow phone. Only the list of ids is in the
     main bundle now; demos are built in a lazy chunk when "Show me" opens.
   - [x] Stale "later step" comments in the demo modules.
   - [x] Sit-to-stand stood up with the weight behind the feet (a fall
     back into the chair). Feet tucked back, the lean held through
     seat-off, and a test that the body's centre of mass is over the feet
     once the hands leave the chair.
   - [x] Doorway chest stretch: the near post hid the arm, the forearm sat
     on the side of the post, and the hold showed no stretch.
   - [x] Calf stretch moved the wrong foot (forward, not back).
   - [x] Heel-to-toe stand slid one foot through the other.
   - [x] Sideways walking went one way and jumped at the loop restart; it
     now steps out and back, so it shows both directions.
   - [x] Pallof press faced the door instead of standing side-on to it.
   - [x] Ankle pumps held the leg off the floor (a leg raise the program
     doesn't ask for); the heel now rests on the floor.
   - [x] The bridge's "no higher than a straight line" test could never
     fail; it now checks which side of the shoulder–knee line the hips
     are. Hands on supports are checked against the furniture, every
     frame. Spine extension is capped at 0° except the back extension.
   - [x] Turn reached angles where a wall, counter or bed hid the figure.
     Each demo now lists the angles that show it, and Turn cycles only
     those (a demo with one useful angle has no Turn button).
   - [x] Small screens: Show me moves under the title on the log screen,
     the controls fit a 568 px tall screen, and landscape gets a bigger
     stage. The view stops redrawing while paused.
   - [x] A bolder face marker so head turns show, closer framing for the
     bridge, and walks at a real slow and comfortable step rate.
   - Changed from the plan: reduced motion shows one large still at a
     time with "Next step" and a "Start → Hold" caption, not two stills
     side by side. Two stills would each be half the size, which is the
     wrong trade for someone with poor eyesight.
- **Merge point:** Days 1, 2, 4 and 6 have an animation for every
  exercise. Days 3 and 5 show "Show me" only where they share an exercise
  with Day 1 or Day 2.

### PR 22 — The Day 3 and Day 5 exercises *(behavior change)*
**Steps.**
1. [x] The demos for the remaining 16 exercises (7, 12–16, 20–26, 28–30),
   with their safety tests. Small model and renderer additions made for
   them: `grip` (0–1, blended) on the arm angles with curled fingers in the
   3D and flat figures, and a ball or tin seated in the palm; a `rail` prop
   (stair step-up); a `wall` that can stand beside the figure (wall side
   plank); a `band` that can be tied to a joint instead of a fixed point
   (band pull-apart, between the hands). Palm up / palm down in the wrist
   curl are told by the step labels (the model has no forearm twist).
2. [x] The test that every Steady Strength exercise has a demo is switched
   on (it now expects none missing).
3. [x] E2E: the Day 3 band outward rotation and the Day 5 suitcase hold
   open with their cues (and the flat figure draws the suitcase hold's
   fingers and bag).
4. [x] The contact sheet for all 34 (`docs/demos/render.cjs`).
5. [x] Fixes from the challenger review (medium effort, to save tokens).
   Its PR 21 comparison found the 18 earlier demos unchanged. It found:
   - [x] Stair step-up and heel-to-toe walk let the weight leave the only
     foot on the ground; the test counted the foot in the air. The test
     now counts only grounded feet, and both demos shift the weight first
     (smallest margins now 1.9 cm and 1.7 cm).
   - [x] The wrist curl's "palm down" phase was drawn palm up; arms gain an
     optional forearm twist so the palm really turns over, with a test.
   - [x] Split stance and back knee bend now shift the weight onto the
     standing leg while the other foot is up.
   - [x] Counter plank and wall side plank step one foot at a time; the
     side plank's forearm stays put on the wall; the suitcase counter is
     closer, so the pick-up is a shorter reach.
   - For Ed: the wall side plank tips the whole body about 18° towards the
     wall in one straight line, so it is exempt from the 5° pelvis-roll
     check (the spine itself stays straight).
- **Merge point:** every exercise in Steady Strength has an animation.

### PR 23 — Plan: combine two days on Today *(design)*
Ed asked (12 Nov) for a way to fit a week's work into fewer sessions when
time is short and availability is patchy. From a draft with three options,
Ed chose **combine on the day**: Today offers to merge one more day into
today's session, either the next day (pulled forward) or a day just missed
(caught up). Ed also asked that **warm-ups are not cut** on a combined day.
Steady Strength is out of scope: it shows no combine button.

PR 24 and PR 25 implement it. The draft Ed chose from is the Claude Doc
"Combining two days when short on time" in the project thread.

**What the person sees.**

```
 Today · Week 2 · Day 1                  Today · Week 2 · Day 1 + Day 2
 Upper: pull · ~50 min                   Upper: pull + Lower: knee · ~73 min
 ┌──────────────────────────────┐        ┌──────────────────────────────────┐
 │ 1 Warm-up  YTWI · Pallof     │        │ 1 Warm-up   D1 YTWI · Pallof     │
 │ 2 Explosive  Med ball slams  │ tap    │ 2 Warm-up   D2 Cossack · Hip ab  │
 │ ...                          │──────▶ │ 3 Explosive D1 Slams  ⇄ alternate│
 │ [ Short on time?             │        │             D2 Split-squat jumps │
 │   Add Day 2 to today ]       │        │ 4 Main      D1 Pull-up EMOM      │
 └──────────────────────────────┘        │ 5 Main      D2 Zercher BSS       │
                                         │ ...                              │
                                         │ [ Undo combine ]                 │
                                         └──────────────────────────────────┘

 Tomorrow (Day 2's date) then shows:  "Day 2 done with Day 1 on 9 Nov"
                                      and no session, like a rest day.
```

**Rules.**

1. **Allowed pairs** live in `program.json`, so Ed can edit them:
   `"combining": { "pairs": [[1, 2], [2, 3], [3, 4], [5, 6]] }`. Each pair
   is one upper day and the lower day next to it in the same week. Left
   out on purpose: Day 4 + 5 (swings, single-leg RDL and back extensions
   in one session load the lower back three times), any two upper days or
   two lower days (an exercise would appear twice, or two leg plyometric
   blocks), and Day 6 + the next Day 1 (crosses into a new week, so phase
   and deload would differ). Validation: each pair is two different
   training days (1–6, not the rest day) that are next to each other; a
   bad pair is a program warning and is ignored, like other bad fields.
   A program without `combining` (Steady Strength) never offers combining.
2. **When Today offers it.** On a training day D in week W, before any
   set is logged today:
   - "Add Day D+1 to today" when [D, D+1] is an allowed pair and Day D+1
     hasn't been combined already.
   - "Add missed Day D−1 to today" when [D−1, D] is an allowed pair, Day
     D−1's date is in the past, nothing was logged on it, and it wasn't
     combined already. When both apply, both buttons show.
   - Never on the rest day, before the start date or after week 8.
   - Only on the real today (the device's date), never on a `?date=`
     preview: combining is "on the day". The buttons sit just under the
     session header card, so there is no scrolling to find them.
3. **Undo.** "Undo combine" shows (just under the header, on the real
   today only) until the first set of the combined session is logged, and
   puts both days back as they were.
4. **Merged session order.** Built by a pure function from the two days'
   sessions as Today already builds them for week W (deload halving,
   power-endurance changes, max-rep targets and no-equipment swaps
   already applied). Block types follow `sessionOrder`, and within each
   type the earlier day's block comes first:
   1. Warm-ups: both days' warm-up blocks in full (Ed: never cut).
   2. Explosive: both blocks. When both are set-based they are shown as
      one "alternate" block: a set of one, then a set of the other, so
      each one's rest is spent on the other, so logging a set there does
      not auto-start the rest timer (the Rest button stays for manual
      use). An EMOM (kettlebell swings) can't alternate, so it runs as its
      own block after the other.
      When the two have different set counts (Day 2 + 3 in an even week:
      split-squat jumps 5 × 6 per leg ⇄ wall throws 4 × 5 per side), they
      alternate while both have sets left and the longer one finishes
      alone (assumed; open question for Ed, raised with PR 27).
   3. Main strength, then mini-doses: each day's block as written.
   4. Core, then finishers: each day's blocks, except that items marked
      `"optional": true` (side plank, hollow hold) are left out and the
      heavy bag's rounds are capped at the bottom of their range (4).
   Rows carry a "D1"/"D2" label so it's clear where each came from.
5. **Length.** The header shows the two days' `targetMinutes` added up,
   minus 3 minutes when the explosive blocks alternate and minus 4 when
   optional core items and a bag round are dropped. That gives Day 1 + 2
   ~73, Day 2 + 3 ~67, Day 3 + 4 ~70 and Day 5 + 6 ~85 minutes (estimates,
   not timings).
6. **The donor day.** The day that was folded in shows "Day N done with
   Day M on <date>" on its own date and no session. The day plans by week
   (PR 12) show both days as planned, with a "Combined" note. A combine
   *lapses* when its host date is before the real today and nothing is
   logged on it: it is then treated as if it never existed (the donor date
   shows its normal session, offers ignore it, no "Combined" note, and the
   host date's past view is the single day). A host date of today or
   later, or with sets logged, stays active.
7. **Logging.** Sets from a combined session are saved on today's date.
   Each set records the day and block position it has in **its own day**
   (not in the merged view), so "last time" hints, History and the CSV
   and JSON exports keep working: a Day 2 split squat logged on Day 1's
   date still finds the last Day 2 split squat. Every set of a combined
   session stores its `day` (single-day sessions store none, so they
   behave exactly as before; PR 24). History headings read
   "Week 2 · Day 1 + Day 2", and History lists one day's blocks, then
   the other's. The progress chart keeps placing a set at the date's own
   day.
8. **What doesn't change.** Week, phase, deload and weekly increases come
   from the date, and both days of a pair are in the same week. The
   week 8 retest prompt and the weekly fatigue check are unaffected.

**Storage.** A new key per program, `combines`, holds one record per host
date: `{ "2026-11-09": { "hostDay": 1, "addedDay": 2, "addedDate":
"2026-11-10" } }`. It has its own wire type and `parse`/`serialize`
functions, like the other stores, and is included in the JSON export and
import (an older export without it imports as no combines).

**Worked examples** (start 2 Nov, as in section 6):

| Date | Situation | Expected |
| --- | --- | --- |
| 9 Nov (W2 D1) | Nothing logged yet | "Add Day 2 to today" shows; no "missed" button (no pair ends on Day 1) |
| 9 Nov (W2 D1) | Day 2 added | Blocks: D1 warm-up, D2 warm-up, slams ⇄ split-squat jumps, D1 pull-up EMOM, D2 Zercher BSS, D1 dip mini, D2 SL RDL mini, D1 core (no side plank), D1 bag 4 rounds; ~73 min |
| 10 Nov (W2 D2) | After the combine above | "Day 2 done with Day 1 on 9 Nov", no session, no buttons |
| 12 Nov (W2 D4) | Day 3 (11 Nov) had nothing logged | "Add missed Day 3 to today"; no "Add Day 5" ([4, 5] isn't a pair) |
| 12 Nov (W2 D4) | Day 3 added | Explosive: rotational wall throws (Day 3's even-week item, PR 26), then the kettlebell swing EMOM as its own block; Day 3 crab core kept; ~70 min |
| 23 Nov (W4 D1, deload) | Day 2 added | Both days' sets halved first, then merged |
| 14 Nov (W2 D6) | Day 5 (13 Nov) had nothing logged | "Add missed Day 5 to today"; Day 5 core and bag, then the Day 6 wall sits; ~85 min |

**Notes from implementing PR 25 steps 1 to 3.**
- *The no-equipment ticks are not in the export*, so the combines store was
  modelled on the fatigue/max-history sections instead: `combines` is an
  optional top-level section of export v2, read tolerantly on import, and the
  key is one of the keys an import replaces (so an import without it clears
  combines).
- Offers (`program/combineOffers.ts`) also refuse when the added day's date
  has something logged on it, not only the missed day's.

### PR 24 — Logged sets remember their own day *(internal refactor)*
No behavior change. Today each logged set's slot is found from the
session's day plus the set's block position. A combined session holds two
days, so each set needs to carry its own day.

**Steps.**
1. [x] `LoggedSet` gets `day` (the day the set's block belongs to). The
   log wire format gains an optional per-set `day`; old sets use the
   session's day when read and match any day when matched, so nothing is
   migrated and old logs behave as before.
2. [x] `findLastTime`, History and the CSV export read the set's `day`
   instead of the session's. Unit tests for an old-format log and for a
   session whose sets carry two different days.
3. [x] Fixes from the challenger review.
- **Merge point:** all existing tests and E2E pass unchanged; the log can
  hold two days on one date.

### PR 25 — Combine two days on Today *(behavior change)*
**Steps.**
1. [x] `combining.pairs` in `program.json`, its wire type, parse and
   validation (rule 1), with tests for each rejected pair.
2. [x] The combines store (wire type, parse/serialize, per program) and
   its place in the JSON export and import.
3. [x] The pure merge function (rules 4 and 5), tested against the worked
   examples above.
4. [x] Today: the "Add Day N" and "Add missed Day N" buttons (rule 2),
   Undo (rule 3), the merged session with day labels, the donor day's
   card (rule 6), and the "Combined" note on the day plans.
5. [x] Logging from a combined session (rule 7) and the "Day 1 + Day 2"
   History heading.
   Everything keyed by a date and block position needs the day too, since
   both days have a block 2 (found in the PR 24 review): the log screen
   route (`#/log/<date>/<block>/<exercise>` gains the day), the rest
   memory keys (`ui/restMemory.ts`), the "No equipment" tick lookup
   (`noEquipment/choices.ts`), Today's row progress and session
   progress (one day per session today), the History group order, and
   "last time"'s `setsOfLargestBlock`, which groups by block only.
6. [x] E2E (`e2e/combine.spec.ts`): on 9 Nov add Day 2, log a split-squat
   set, see 10 Nov's "done with Day 1" card, and see the set in History;
   undo before logging puts both days back.
7. [ ] Fixes from the challenger review.
- **Merge point:** Ed can combine any allowed pair on Today and log it.

### PR 26 — Plan: Day 3 rotational wall throws on even weeks *(design)*
Ed asked (12 Nov) to add rotational medicine ball wall throws to Explosive
Endurance as a Day 3 alternate, after research in the project thread
"Add rotational wall throws to Day 3". The agreed shape:

- **Odd weeks (1, 3, 5, 7):** plyo push-ups, 5 × 5, 45s rest, as now.
- **Even weeks (2, 4, 6, 8):** rotational med ball wall throws, 4 × 5 per
  side, 45s rest, 3–4 kg ball. Weeks 4 and 8 are deloads, so they halve to
  2 × 5 per side like every other item.
- **Cues:** side-on, 1–2 m from a solid wall; turn from the hips, ribs
  stacked over the pelvis; catch and reset each rep in weeks 1–4; from
  week 5 a catch-and-rebound is fine if the back feels fine.
- **Evidence:** Szymanski et al. (2007), with Brazier et al. (2026) and
  Vera-Garcia et al. (2014) in the program doc.

The project-file copies of `program.json` and "Explosive Endurance
Program.md" already carry the dose, as a stop-gap `note` on the plyo
push-up ("Odd weeks only…") and a new `rotational_wall_throw` exercise that
no day uses yet. PR 27 replaces the note with real week-by-week items.

**What the person sees.**

```
 Today · Week 1 · Day 3              Today · Week 2 · Day 3
 ┌───────────────────────────┐       ┌────────────────────────────────────┐
 │ 2 Explosive               │       │ 2 Explosive                        │
 │   Plyo push-ups  5 × 5    │       │   Rotational med ball wall throws  │
 │   45s rest                │       │   4 × 5 · per side · 45s rest      │
 └───────────────────────────┘       └────────────────────────────────────┘
```

Only one of the two shows on a given week, on Today, on the day plans by
week (PR 12) and on a combined day (PR 25). The other never appears as
"missed" or "not done".

**How the file says it.** A new optional item field, `weeks`, lists the
program weeks an item runs in. An item without it runs every week, so
every existing item and the Steady Strength program are unchanged.

```json
{ "type": "explosive", "items": [
  { "exercise": "plyo_push_up", "weeks": [1, 3, 5, 7], "sets": 5, "reps": 5, "restSec": 45 },
  { "exercise": "rotational_wall_throw", "weeks": [2, 4, 6, 8], "sets": 4, "reps": 5, "perSide": true, "restSec": 45 }
]}
```

Alternatives considered: a swap-style field on the plyo item
(`alternateWeeks: { exercise, … }`, like `noEquipment`) keeps one item but
needs its own rules for which fields carry over, and the throws differ in
sets and "per side"; an `everyOtherWeek` flag is shorter but can't express
anything else. A plain week list is the easiest for Ed to read and edit.

**Rules.**

1. **Parsing.** `weeks` is a non-empty list of whole numbers from 1 to
   `lengthWeeks`, with no repeats. Anything else is a parse error, like
   other malformed fields (it would silently drop or double an exercise).
   It lives in the wire type only as `weeks`, and the model holds it as
   `runsInWeeks: ReadonlySet<number> | "everyWeek"`.
2. **A gap is a warning.** If a block has items with `weeks` and some
   week has none of the block's items, the program loads with a warning
   naming the block and the weeks, and that week's block is left out.
3. **Schedule.** `buildSession` drops items whose `weeks` don't include
   the current week, before the deload halving and power-endurance
   changes, which then apply as usual. A block left with no items is
   dropped (only possible after a rule 2 warning). Block positions are
   unchanged, because the filter works within a block, so logging,
   History and "Last time" keep their keys.
4. **Lookups stay on the whole program.** "Last time", Progress and
   History find a logged set's item in `program.days` (not the week's
   session), so a week 2 throws set still matches in week 4. Each gets a
   test.
5. **No equipment.** The throws get no `noEquipment` swap: a swap keeps the
   original's sets and "per side", which would make plyo push-ups 4 × 5 per
   side. The exercise's `alternative` ("No ball or no solid wall: do plyo
   push-ups, 5 × 5") shows on its sheet instead, as the slam's does.
6. **Retest and fatigue checks** are unaffected: neither exercise is
   max-tested.

**Worked examples** (start date 2 Nov, so Week 1 Day 3 is 4 Nov):

| Date | Week · Day | Phase | Explosive block |
| --- | --- | --- | --- |
| 4 Nov | 1 · 3 | Base | Plyo push-ups 5 × 5, 45s rest |
| 11 Nov | 2 · 3 | Base | Rotational wall throws 4 × 5 per side, 45s rest |
| 25 Nov | 4 · 3 | Deload | Rotational wall throws 2 × 5 per side, 45s rest |
| 9 Dec | 6 · 3 | Power endurance | Rotational wall throws 4 × 5 per side, 45s rest |
| 16 Dec | 7 · 3 | Power endurance | Plyo push-ups 5 × 5, 45s rest |
| 23 Dec | 8 · 3 | Deload + retest | Rotational wall throws 2 × 5 per side, 45s rest |

Every other day and week matches `main` exactly.

### PR 27 — Day 3 rotational wall throws *(behavior change)*
**Steps.**
1. [x] `weeks` in the wire types, parser and model (rule 1) and the gap
   warning (rule 2). Unit tests for each rejected value and the warning.
   `lengthWeeks` is now read before the days, since `weeks` is checked
   against it.
2. [x] `buildSession` filtering by week (rule 3). Unit tests for the
   worked examples. Blocks now carry their `position` in the program day,
   and Today, the log screen, session progress and the day plans use it,
   so a block left out of a week doesn't renumber the ones after it. The
   check that every other session from 2 Nov to 27 Dec matches `main`
   moves to step 3, where the shipped file changes.
3. [x] `public/program.json`: the `rotational_wall_throw` exercise and the
   two Day 3 items (the stop-gap note was only ever in the project-file
   copy). Data tests over the shipped file, including every session from
   2 Nov to 27 Dec matching the program without `weeks` except Day 3's
   explosive block in even weeks. README "Editing program.json" documents
   `weeks`.
4. [x] Tests for rule 4 ("Last time", Progress, History), session
   progress with a block left out, and the day plans by week. E2E: with
   the start date set so today is Week 2 Day 3, Today shows the throws
   and not the plyo push-ups; Week 1 shows the reverse.
5. [x] Copy `public/program.json` to the project files and update
   "Explosive Endurance Program.md" if its wording differs (it already
   described the alternation). The doc's Day 3 row still says ~32 min with
   no core block, from before PR 13; that drift is older than this PR and
   is left as a separate follow-up.
6. [x] Fixes from the challenger review. It found no wrong figure: every
   session from 1 Nov to 29 Dec matches `main` except Day 3's explosive
   block in weeks 2, 4, 6 and 8, which match the worked examples, and
   Steady Strength is unchanged. Fixed: the PR 23 example and alternation
   rule, step ticks, deload weeks losing the "Changed" note (an item is now
   compared with the last week it ran), the overview naming only plyo
   push-ups for Day 3, `weeks` with `weeklyIncrease` and a repeated
   exercise in one block (now parse errors), two doc comments and the
   evidence link (now a DOI). Left as is: no UI test that Today and the
   log screen number blocks after a dropped one (no shipped data drops a
   block, and `buildSession` and session progress test it), and the
   README gained `weeks` in step 3 rather than step 1.
- **Merge point:** Day 3 shows the right explosive exercise each week, and
  every other session is unchanged.

**Open questions for Ed** (with the answer I'm assuming):

1. **Which weeks.** Throws in the even weeks, so the deloads (4 and 8) are
   throw weeks. Swapping to odd weeks would put throws in week 1, before
   you've had a week to learn plyo push-ups. Even is my pick.
2. **No-equipment.** No tick for the throws; the sheet's alternative says
   to do plyo push-ups instead (rule 5).

### PR 28 — Plan: optional boxing and a gear-up break *(design)*
Ed asked (14 Nov) for boxing (the heavy bag finisher on Days 1 and 5) to
be **optional, decided when getting ready to begin the session**. He also
asked whether the next set waits for him, because before boxing he needs
**a couple of minutes to wrap his hands and put gloves on**.

PR 29 and PR 30 implement it.

**How the app behaves today (the answer to Ed's second question).**

- *Between sets, yes, it waits for Ed.* "Log set" starts the rest timer
  (rule 8). When the rest ends it beeps and shows DONE ("Next set when it
  ends"); nothing is logged or started for him. The next set only counts
  when he taps "Log set" again (`ui/logScreen.ts`, `ui/restTimer.ts`).
- *Between blocks, yes.* Nothing moves on by itself. Each EMOM and
  interval timer opens only from its row's "Start timer" button and sits
  in its `ready` state until Start is tapped (`timer/engine.ts`,
  `ui/today.ts` `renderStartIntervalButton`). So Ed can already take as
  long as he likes to wrap his hands before tapping Start.
- *Inside the heavy bag timer, no.* Once started, rounds run work, rest,
  work... without a tap (that's the point of an interval timer). Pause
  and Skip are there.
- *The catch:* the gear-up pause has to happen **before** tapping Start,
  and then Start has to be tapped **with gloves on**. Nothing reminds him
  to gear up or times the break. That's what rule 4 below fixes.

**What the person sees.**

```
 Today · Week 2 · Day 1               Heavy bag timer (after Start)
 Upper: pull · ~50 min                ┌──────────────────────────┐
 ┌───────────────────────────────┐    │        GEAR UP           │
 │ Boxing today?                 │    │         1:42             │
 │ [ Yes ✓ ]   [ Skip ]          │    │ Wrap hands, gloves on    │
 └───────────────────────────────┘    │ then round 1 by itself   │
 1 Warm-up ...                        │ [ ❚❚ Pause ] [ Ready › ] │
 ...                                  └──────────────────────────┘
 6 Finisher  Heavy bag 5 × 30s          then WORK, round 1 of 5 ...

 Skip boxing tapped:  header "~43 min · 5 blocks", the finisher card
 becomes one line "Boxing skipped today · Add it back".
```

**Rules.**

1. **The file marks the block.** A new optional block field,
   `"optional": { "label": "Boxing" }`, on the Day 1 and Day 5 finisher
   blocks. It is a block field, so it doesn't clash with the item field
   `"optional": true` (side plank, hollow hold), which means "shown, but
   doesn't hold up completion". `label` is what the question and the
   skipped line say. Steady Strength marks nothing, so nothing changes
   there. Parse rules like other fields: a wrong type is an error card,
   a missing `label` is an error.
2. **When the question shows.** On a training day whose session has an
   optional block, a "Boxing today?" card sits just under the header (in
   the same place as the combine buttons, so it's seen before starting).
   Two buttons: **Yes** (selected by default: the program as written) and
   **Skip** (fixed words, so any `label` reads well; their accessible
   names include the label). Once skipped, the card goes and the block's
   "Add it back" line is the way back. Ed can change his mind until a
   round of that block is logged; after that the card is gone, and a
   logged round always wins over a stored skip. It shows on today and on
   past `?date=` previews (backfilling a session that had no boxing), but
   not on future dates, which take no writes elsewhere either.
3. **When boxing is skipped.**
   - Today replaces the finisher card with one line, "Boxing skipped
     today · Add it back". Block numbers don't change (blocks keep their
     `position`, PR 27).
   - The header's block count drops by one and its minutes drop by the
     block's estimated length: the timer's default plan plus the gear-up
     break, rounded to the nearest minute (Day 1, week 2: 5 × 30s work +
     4 × 30s rest + 2:00 = 6:30, so ~50 becomes ~43, 6 blocks becomes 5).
   - Session progress, the "in progress" wake lock and "every set logged"
     ignore the block, so the session completes without it.
   - With "No equipment" ticked the block is shadow boxing; the question
     and the skip apply the same way (it is the same block).
   - On a combined day (PR 25) each day's optional block gets its own
     card line ("D1 boxing", "D5 boxing"); in the shipped pairs only one
     day of each pair has boxing, so there is one.
   - The log screen for a skipped block's item still opens from History
     or a direct link, but Today doesn't offer it.
4. **Gear-up break before the first round.** A new optional item field,
   `"gearUpSec"`, on the heavy bag items (120 in the shipped file). When an
   interval item has it, the timer plan starts with a **GEAR UP**
   segment of that length, labelled "Wrap hands, gloves on", before round
   1. It counts down with the usual 3-2-1 beeps and then round 1 starts by
   itself, so no tap is needed with gloves on. Skip (shown as "Ready ›"
   during this segment) starts round 1 early; Pause holds the break.
   - The timer's setup row gets a fourth stepper, "Gear up 2:00", 0 to
     5 minutes in 15s steps; 0 means no break. The value chosen is
     remembered for the page load, like the rest stepper.
   - The no-equipment swap (shadow boxing) has no gear-up: swaps don't
     inherit `gearUpSec` (no wraps or gloves), and a swap can't set it.
     `gearUpSec` is only allowed on interval items, as a whole number
     of seconds from 0 to 300 (the stepper's range).
   - The engine gets a fourth segment phase, `gearUp`, with its own colour
     (neutral, not green work or blue rest) and its own start cue. It is
     not a round, so "Round 1 of 5" counts from the
     first work segment.
5. **Logging.** The choice is stored per date and per block, so History
   can say "Boxing skipped" instead of showing the bag as unlogged. A
   new key per program, `optionalBlockChoices`:
   `{ "2026-11-16": { "skipped": ["1:6"] } }` (day and block position, so
   a combined day's two blocks don't collide). Only skips are stored;
   "Box" is the absence of a record. It has its own wire type with
   `parse`/`serialize`, is in the JSON export as an optional section of
   export v2 (an older export imports as no skips; an import replaces it,
   like `combines`), and the CSV export gains no rows (it lists logged
   sets only). "Last time" for the bag looks past skipped sessions
   naturally, since they have no sets.
6. **What doesn't change.** Deload halving, the power-endurance "+5s
   work", rounds and work/rest defaults, the week 8 retest and the weekly
   check.

**Steps.**

- **PR 29 — Optional boxing on Today** *(behavior change)*
  1. [x] Block `optional` in the wire types, parser and model (rule 1), and
     the field on Days 1 and 5 in `public/program.json`. Unit tests and
     data tests over the shipped file.
  2. [x] The `optionalBlockChoices` store: model, wire, parse/serialize,
     storage, export and import (rule 5). Unit tests.
  3. [x] Applying a skip to the session view, header minutes and block count,
     and session progress (rule 3). Unit tests for the worked examples.
  4. [x] The "Boxing today?" card and the skipped line on Today, single and
     combined days, and "Boxing skipped" in History. E2E: skip on Week 2
     Day 1, header reads ~43 min · 5 blocks, add it back, log a round and
     the card goes away.
  5. [x] README "Editing program.json" documents the block field.
  6. [x] Fixes from the challenger review: a logged round now wins over a
     stored skip (it used to leave Today stuck on "Boxing skipped");
     History only lists skips for the session's own days; no question on
     future dates; fixed "Yes"/"Skip" buttons instead of deriving "Box"
     from the label; the question hides once skipped; README data and
     import sections; E2E for combined, past and future dates. Accepted:
     the combined-day estimate is about a minute high (see below).
  - **Merge point:** boxing can be skipped before a session and the
    session completes without it.
- **PR 30 — Gear-up break before the heavy bag** *(behavior change)*
  1. [x] The `gearUp` phase in the engine, plans and cues; `gearUpSec` in the
     wire types, parser, model and the shipped file (rule 4). Unit tests
     with a fake clock: the break runs, beeps 3-2-1, round 1 starts by
     itself; Skip starts it early; 0 gives no break.
  2. [x] The timer view: GEAR UP colour and text, "Ready ›" on Skip, the
     fourth stepper, the round line counting from round 1. E2E: start the bag
     timer, see GEAR UP 2:00, tap Ready, see WORK round 1 of 5.
  3. [x] README documents `gearUpSec`.
  - **Merge point:** the bag timer opens with a gear-up countdown that
    runs into round 1 without a tap.

The two PRs don't depend on each other. PR 30 landed first (#37), so PR
29 merged `main` and its figures include the 2:00 gear-up (~43 min). On a
combined day the skip takes off the full 5-round estimate (7 min) though
the combined bag would run 4 rounds, so the header is about a minute low;
accepted, since these are estimates.

**Worked examples** (start 2 Nov, as in section 6):

| Date | Situation | Expected |
| --- | --- | --- |
| 9 Nov (W2 D1) | Nothing logged, nothing chosen | "Boxing today?" with Yes selected; ~50 min · 6 blocks |
| 9 Nov (W2 D1) | Skip boxing | Finisher shows "Boxing skipped today · Add it back"; ~43 min · 5 blocks; logging every other set completes the session |
| 9 Nov (W2 D1) | One bag round logged | No card; the choice can no longer change |
| 13 Nov (W2 D5) | Bag timer opened | Setup row: Work 30s · Rest 30s · 5 rounds · Gear up 2:00; Start shows GEAR UP 2:00, then round 1 of 5 |
| 30 Nov (W5 D1) | Skip boxing | Block estimate 5 × 35s + 4 × 30s + 2:00 = 6:55, so ~43 min |
| 23 Nov (W4 D1, deload) | Bag timer opened | Rounds already 2 (deload: low end 4, halved), gear-up still 2:00 |
| 9 Nov (W2 D1) | No equipment ticked on the bag | Shadow boxing; question still shows; its timer has no gear-up |
| 10 Nov (W2 D2) | Any | No card (no optional block) |

**Decided by Ed (14 Nov):**

- **Default:** Yes (box) is pre-selected, so not answering means boxing as
  written.
- **Gear-up break:** kept. It counts down (2:00 by default) and starts
  round 1 by itself, so Start is tapped bare-handed and nothing is tapped
  with gloves on; "Ready ›" starts early.
- **Not remembered:** each session asks fresh, like the no-equipment
  ticks.

**Open question for Ed** (with the answer I'm assuming):

1. **Changing your mind.** Allowed until the first bag round is logged.

### PR 31 — Plan: logging from timers, real Skip, and scroll *(design)*
Ed reported four problems on 16 Nov, with these decisions:

1. **Can't log sets from an EMOM.** The EMOM timer has Start/Pause and
   Skip only. Sets are saved only from the log screen.
2. **Skip does nothing for a whole exercise.** Skip on the log screen only
   moves to the next unlogged set and saves nothing. Skipping every set
   leaves the exercise looking untouched, and Skip disables on the last
   set.
3. **Timers don't log anything.** The boxing timer has the same gap.
4. **Leaving a set returns to the top of Today.** The user has to scroll
   to the latest exercise.

Ed's answers: **skipped sets are recorded as skipped, and a skipped set
can be opened again to log it.** The **EMOM timer comes first, then the
boxing timer.** He asked for a design PR before code.

Full screen (asked in the first message) is not in these PRs. See the
last milestone.

**How it should behave.**

- *Skip (log screen).* Records the set as skipped, not logged. Today and
  History show "Skipped" on that set. Tapping a skipped set opens it to
  log, and that clears the skip. When every set of an item is logged or
  skipped, the item counts as done on Today (for example "4 logged · 2
  skipped"), so the day can complete.
- *Skip (timers).* Unchanged: it jumps to the next minute, round, or
  segment. It logs nothing.
- *Log from the EMOM timer.* A "Log set" button saves the set for the
  current minute, pre-filled by the same rule as the log screen (rule 8),
  through the same save path and session context. The timer keeps
  running. The minute maps to set number = minute. Assumed: an EMOM's
  total sets equal its minutes; the implementation checks this.
- *Log from the boxing timer.* Same idea, one set per bag round, on the
  heavy bag item (later PR).
- *Scroll.* On returning to Today from the log screen or a timer, Today
  scrolls to the first item in session order that still has an unlogged
  set. If none is left, it stays at the top.

**Data.** A skip is stored apart from logged sets, so "Last time",
progress and export of reps stay as they are. The log moves from version
1 to version 2 with a `skippedSets` list per session. Each entry names the
date, day (for combined days), block position, exercise and set number.
A version 1 log loads with no skips. Export and import handle both
versions, as PR 29 did for boxing skips.

**Files.** `src/log/model.ts`, `wire.ts` (v2 with a v1 reader),
`operations.ts`, `itemSets.ts` (skipped sets count as closed for
`nextSetNumber`), `sessionProgress.ts`, `history.ts`, `lastTime.ts` (skips
are ignored), `storage.ts`; `src/ui/logScreen.ts`, `today.ts`,
`timerView.ts`, `app.ts` (scroll target), `src/timer/plans.ts` (minute to
set number); `src/export/csv.ts`; `README.md`; unit tests and E2E tests.

**Milestones** (one PR each, in this order):

- **PR 32 — Skip records skipped sets** *(behavior change)*
  *Built as an optional `skippedSets` field on v1, not a v2 format: an older
  log reads as none skipped and a log with no skips is written unchanged, so
  no version bump is needed.*
  1. [x] Model, wire types, parser and `skippedSets` (rule 1 and rule 6),
     with a v1 reader. Unit tests for old and new load, save and round trip.
  2. [x] Operations: skip a set, clear a skip, and "item done" for logged or
     skipped sets. Unit tests.
  3. [x] Log screen: Skip records the skip, skipped sets can be reopened, and
     Skip stays enabled while any set is open. Today progress shows skips;
     a day with only skips gets no History card. Unit and E2E tests.
  4. [ ] Still open: export and import of skips, and an E2E run through
     History. Not done in this PR; the README documents skips.
  - **Follow-ups found in review, not in this PR:** a date with only skips
    still counts as "nothing logged" for combine Undo and combine offers
    (`ui/today.ts`, `program/combineOffers.ts`); the import summary counts
    skip-only sessions as sessions (`export/import.ts`); "Log all as
    planned" keeps the open set's draft (done in this PR) but not its
    note on a skipped set.
  - **Merge point:** Skip does what Ed expects, and a whole exercise can be
    skipped.
- **PR 33 — Log sets from the EMOM timer** *(behavior change)*
  1. [x] Pure mapping from an EMOM minute to its set number (minute =
     set number, with a check that the set count matches), in
     `ui/timerSetLogging.ts`. Unit tests.
  2. [x] "Log set N" on the EMOM timer, pre-filled and saved through the log
     path (`ui/today.ts` wiring, `ui/timerView.ts` round action). Unit tests
     and an E2E test that logs two minutes from the timer and sees the row
     count after a reload.
  3. [x] Follow-up found in review: closing the timer after a logged set
     redraws Today and returns focus to the Start EMOM button.
  - **Order changed:** PR 33 was built before PR 32, at Ed's request (EMOM
    first). PR 32 is still to do. When it lands, a set logged from the
    timer must clear a skip for that minute the same way the log screen
    does, so the timer's save path and the log screen's stay in step.
  - **Merge point:** an EMOM can be logged without leaving the timer.
- **PR 34 — Scroll to the next exercise** *(behavior change)*
  *Status: built. Unit tests in `ui/returnScroll.test.ts`; E2E in `e2e/timer.spec.ts`.*
  1. [x] Pure "next unfinished row" function, with unit tests in session
     order (`ui/returnScroll.ts`).
  2. [x] Today scrolls to it when it re-renders after the log screen. An EMOM
     timer that closes after a logged set keeps the page where it was rather
     than scrolling (the timer is opened from its row, so the row stays in
     view). E2E checks the scroll position on a long day.
  - **Merge point:** returning from a set lands on the next exercise.
- **PR 35 — Log sets from the boxing timer** *(behavior change)*
  *Status: built. The round action is shared with the EMOM timer (`ui/timerSetLogging.ts`, `ui/today.ts` `timerSetLoggingFor`). The gear-up break has no round, so no button there. E2E in `e2e/boxingLog.spec.ts`.*
  1. Round-to-set mapping for the heavy bag, with unit tests.
  2. "Log round" on the boxing timer, saved through the log path. E2E on
     Day 1.
  - **Merge point:** boxing rounds can be logged from the timer.
- **PR 36 — Full screen** *(behavior change)*
  1. A Full screen button that uses the Fullscreen API where the browser
     allows it, and an "Add to Home Screen" note for iPhone Safari, which
     does not allow it for web pages. Unit tests for the support check.
  - **Merge point:** Ed can use full screen on Android and desktop. On
    iPhone, the home-screen app is the way to go full screen.

**Open questions for Ed** (with the answers I'm assuming):

1. **EMOM "Log set".** Assumed: the timer keeps running and does not jump
   to the next minute.
2. **Full screen on iPhone.** Assumed: home-screen app plus the button
   elsewhere is enough. Safari gives no other way.
3. **Boxing rounds.** Assumed: one set per bag round, logged from the
   timer's round counter.

### Day 3 on-the-spot crawl *(behavior change, content only)*

Ed asked for an extra finisher on Day 3: an on-the-spot crawl with the legs
off the ground, 5 rounds of 1 minute with 30 seconds rest between rounds. He
confirmed the placement (a finisher after the core work), the 30-second rest,
no deload change, and that Day 3's target can grow.

1. [x] Add an `on_the_spot_crawl` exercise and a Day 3 finisher block to
       `public/program.json`, and extend Day 3's `targetMinutes` from 40 to 47.
2. [x] Mirror the change in the program document (kept in the project files, not this repo)'s Day 3 row and notes.

### Plan: History loads week by week *(design)*

**The problem.** History gets slow as the log grows. `draw()` in
`src/ui/history.ts` builds a card for every logged date, and the progress
charts, and it runs again on every expand, collapse, open set, Cancel, Save
and Delete. With about a year of daily sessions, each tap takes roughly 0.8
to 1 s on a slowed phone CPU. Ed asked (18 Nov) for History to load
progressively, week by week. Startup latency is a separate piece of work,
so this plan does not touch `src/main.ts` or how `src/log/storage.ts`
loads the log.

**How it should behave.**

- History first shows the cards for the **latest 2 program weeks**, newest
  first, as now.
- Under the last card, a **"Show older weeks"** button adds the next 2
  weeks below the cards already shown. The cards on screen stay as they
  are (expanded rows stay expanded), and focus moves to the heading of the
  first card it added. When nothing older is left, the button goes.
- The **progress charts still use the whole log**, not only the shown
  weeks.
- Leaving History and coming back starts again at 2 weeks.
- The window is a number of weeks, not a fixed set of dates: if a Delete
  removes the only card of a shown week, the next older week moves up into
  view.
- **Taps redraw only what they change.** Expand, collapse, open a set and
  Cancel redraw only that session's card. Save redraws that card and the
  progress charts. Delete does the same, or removes the card if it was the
  session's last set. Focus rules stay as they are today.
- Nothing about storage changes: no new fields, no new keys.

**What counts as a week.** Program weeks come from the stored
`programWeek` on each session, which is what the card headers show. Walking
the dates newest first, a new week starts when the stored week changes, or
when the date is 7 or more days before the newest date of the current
week. The second rule keeps two runs of the program apart (week 1 of a
restart next to week 1 of the first run), and gives old sessions with no
stored week groups of at most 7 days. A day with only skipped sets has no
card today, so it isn't counted.

```
 dates, newest first     stored week    group
 2026-11-18                  3          ─┐ week A (shown)
 2026-11-16                  3          ─┘
 2026-11-11                  2          ─┐ week B (shown)
 2026-11-09                  2          ─┘
 2026-11-04                  1          ── week C  ◀ "Show older weeks"
```

**Approach, and alternatives.** A pure function groups the dates into
weeks, and the screen keeps a count of weeks shown. Each card is built by
one function and kept in a map by date, so one card can be swapped in
place. I considered:

- *Paging by a fixed number of sessions* (say 14 cards): simpler, but
  breaks a program week across the button, while the card headers are all
  about weeks.
- *Infinite scroll* (load more near the bottom): no button to tap, but
  it needs a scroll observer, is harder to test, and is harder to use with
  a screen reader. A button is enough for one user.
- *Only per-card redraws, no paging*: fixes taps but not the first draw of
  a year of cards. Doing both is still small.

**Files.** A new `src/log/historyWeeks.ts` (the grouping, with
`historyWeeks.test.ts`), `src/ui/history.ts`, `src/style.css` (the
button), `e2e/history.spec.ts`, `README.md` (History section). No wire
types change, so there is nothing new to map (CLAUDE.md section 6).

**Milestones** (one PR each, in this order):

- **History PR 1 — History shows 2 weeks, then "Show older weeks"** *(behavior change)*
  1. [x] `groupDatesIntoWeeks(log)` in `src/log/historyWeeks.ts`, by the
     rule above. Unit tests: an empty log, one week, a week change, a
     restart at week 1, sessions with no stored week, a gap of 7 days or
     more inside the same stored week, and skip-only days left out.
  2. [x] History draws only the shown weeks, with the "Show older weeks"
     button and the focus rule above. Progress charts stay on the whole
     log. E2E: seed 5 weeks, see only 2 weeks of cards, tap twice to see
     all, the button goes, an expanded card stays expanded, and the
     existing History tests still pass. README updated.
  - **Merge point:** a long log opens with 2 weeks and the rest is a tap
    away.
- **History PR 2 — Redraw only the tapped card** *(internal refactor, with a speed-up)*
  *Optional follow-up, not started (Ed, 23 Nov). With History PR 1 a tap
  takes about 31 ms at a year of sessions (was about 0.5 s), so this only
  helps after many "Show older weeks" taps.*
  1. [ ] Build each card through one function and keep it by date; expand,
     collapse, open a set and Cancel replace only that card. The progress
     charts are no longer rebuilt on those taps.
  2. [ ] Save replaces the card and the progress charts; Delete does too,
     or removes the card, and shows the page message the same way as now.
  3. [ ] E2E: after expanding a row, the other cards and the charts are
     the same DOM nodes as before the tap (checked with a marker set in
     the page), and the focus tests still pass. Before and after timings
     for a tap, with a year of seeded sessions and the CPU slowed 4×, go
     in the PR description.
  - **Merge point:** a tap on History costs one card, not the whole page.

History PR 2 has no visible change apart from speed, so it is kept apart
from History PR 1's behavior change (CLAUDE.md section 2).

**Open questions for Ed** (with the answers I'm assuming):

1. **How much to show.** Assumed: 2 weeks at first, and 2 more for each
   tap. 4 at first is an easy change if 2 feels short.
2. **Week labels.** Assumed: no extra "Week 5" heading between groups,
   since every card header already names its week.
3. **Coming back to History.** Assumed: it starts again at 2 weeks rather
   than remembering how far you went.
### Startup time with a long log *(design, then internal refactor: tooling only)*

Ed asked why opening the app (Today) gets slower as the log grows, and for
the smallest safe fix. An earlier look reported 0.9 s at a year of daily
sessions and 1.8 s at two years (4× slowed CPU).

**What I measured.** Built app, headless Chromium, iPhone 13 profile, CPU
slowed 4×, a session every day with all of the day's sets logged, time from
navigation to the first Today row. Each figure is the median of 11 runs;
the range is across 3 to 4 separate batches on different builds of the same code:

| Log | Sets | Open Today |
| --- | --- | --- |
| empty | 0 | 0.24 to 0.30 s |
| 1 year | 7,261 | 0.30 to 0.38 s |
| 2 years | 14,503 | 0.32 to 0.41 s |
| 4 years | 29,011 | 0.40 to 0.44 s |

The log adds about 0.1 s at two years. I could not reproduce the earlier
0.9 s and 1.8 s. The likely cause is the test setup: writing the log into
storage from a Playwright init script runs on the slowed CPU at the start of
every page load, and is then timed as if it were the app. Seeded that way, my
2-year figure rises to 0.58 to 0.79 s (median 0.65 s). The rest of the gap
is probably the machine the earlier numbers came from; I did not confirm that.

**Where the 0.1 s goes** (CPU profile, 2 years):

- `loadLog` (`src/log/storage.ts`), about 85 ms: `JSON.parse` about 20 ms and
  `logFromWire` (checking and converting every set) about 60 ms. It is
  linear in the number of sets (about 170 ms at 4 years).
- "Last time" hints on Today (`src/log/lastTime.ts`), about 10 to 15 ms:
  every row re-sorts every session date (`sessionDates`).
- Building the Today page itself does not grow with the log.

**Fixes I tried and rejected.** A fast path in `logFromWire` that skips
building error-path strings for valid sets cut its time in a warm Node run
(15 ms to 11 ms) but made no difference in the browser that I could tell
apart from noise (two runs each, before and after). Sorting the dates once
per render would save at most about 10 ms. Neither is worth the risk of
changing how the log is checked.

**Decision.** Leave the app's startup code as it is. The real fix, if a log
ever gets big enough to matter, is to stop reading the whole log at startup
(for example, one storage key per month, read newest first). That changes
the storage format, needs a migration and touches import/export, so it is a
follow-up only if Ed wants it.

What this milestone does instead is make startup measurable, so a future
change (or the History week-by-week work) is judged on real numbers:

1. [x] A long-log generator (`src/bench/longLog.ts`): builds a stored-format
       (wire) log of N days from the program file, a session a day with every
       set logged (the rest day has no session, as in the measurements above). Unit-tested (set counts, dates, valid under `logFromWire`).
2. [x] `npm run bench:startup`: builds, starts `vite preview`, and for an
       empty log, 1 year and 2 years writes the log into storage on a
       throwaway page, then times opening Today with the CPU slowed 4×
       (11 runs, prints min, median and max). Not run in CI: timings on
       shared runners are too noisy to gate on. After the challenger review it
       times inside the page (Playwright's polling had added 75 to 95 ms to
       every figure), anchors the fake log's day cycle to the program start
       date (7,398 and 14,815 sets for 1 and 2 years), and refuses to report
       a run unless Today showed with the log read cleanly ("Last time"
       hints present, no warning, no corrupt-log backup). Two runs gave
       0.21 to 0.22 s empty, 0.25 to 0.26 s at 1 year and 0.31 to 0.33 s at
       2 years: still about 0.1 s for two years of log.
3. [x] README: a "Measuring startup time" section with the command, what it
       measures, and the init-script trap above.

Merge point: one PR for steps 1 to 3. No app behavior changes.

Follow-up for Ed to decide (from the challenger review): nothing runs the
benchmark automatically, so a change to Today's markup or the storage keys
could break `npm run bench:startup` unnoticed. A one-run smoke check with no
time limits, in CI or the E2E suite, would catch that.

### PR 37 — Plan: total reps for uneven rep lists *(design)*

Ed's nit: when an EMOM's minutes had different rep counts, the summary
lists them all ("4, 5, 5, 5, 5, 5, 4, 4, 4") and the total is hard to work
out at a glance. He asked for a "total reps" count in parentheses, and
chose to have it for regular sets with uneven reps too, not only EMOMs.

Where the list shows: `formatSetsSummary` in `ui/format.ts`, which feeds the
"Last time" hint (Today rows, the log screen) and History's exercise rows.
The EMOM timer itself only shows one minute's target, so it doesn't change.

- **PR 38 — Show the total for uneven rep lists** *(behavior change)*
  1. `formatSetsSummary` appends " (41 total)" after the listed reps
     whenever the reps differ, for EMOM minutes and regular sets alike:
     "4, 5, 5, 5, 5, 5, 4, 4, 4 (41 total)", "6, 6, 5 (17 total)". With a
     load it reads "6, 6, 5 (17 total) at 6 kg". Even lists keep "9 × 5",
     whose total is already easy. Unit tests in `ui/format.test.ts`, and
     E2E expectations that show an uneven list updated (and one added for
     History if none covers it).
  - **Merge point:** uneven rep lists show their total in History and Last
    time.

### Plan: train around an injury *(design)*

Ed hurt the right shoulder on a rest day (22 Nov) and asked what the app
could do to manage an injury during Explosive Endurance. The proposal was
discussed in the project thread, and Ed answered its questions (22 Nov):

1. **Areas:** the shoulder first. Only once the whole shoulder feature is
   built does planning start for the other areas.
2. **Levels and stand-ins:** the shoulder tables below are agreed.
3. **A day with nothing left** becomes a shoulder-free session, not a rest
   day.
4. **Day 4 kettlebell swings** are replaced with broad jumps.
5. **No extra leg work** on the upper-body days.
6. **Easing back in:** a week at half the sets was too cautious.
7. **The program keeps moving** while an area is flagged. There is no pause.

This section is the plan. The milestones at the end implement it.

**Not medical advice, and no clearance.** The app never diagnoses, never
says an injury has healed, and never tells Ed an area is ready to load
heavily again. It changes the session while an area is flagged, says when
to get it checked, and keeps a record. Clearing the flag is Ed's call, and
the app says so in plain words.

**How it behaves.**

```
 Settings / Today              Today while flagged                    Clearing the flag
 ┌───────────────────┐        ┌──────────────────────────────────┐   ┌─────────────────────────┐
 │ Injury            │──────▶ │ Right shoulder · since 22 Nov    │──▶│ Everything as written   │
 │ + Add area        │        │ [When to get it checked]         │   │ First session back per  │
 │ area, side, note  │        │ Avoid   → left out · Add it back │   │ exercise: "pain-free    │
 └───────────────────┘        │ Swap    → stand-in               │   │ only" + "Half sets      │
                              │ Caution → "Pain-free only"       │   │ today"                  │
                              │ Nothing left → area-free session │   └─────────────────────────┘
                              └──────────────────────────────────┘
```

1. **Flag an area.** Settings gets an "Injury" section, and Today an
   "I'm injured" link next to "Safety notes". Ed picks the area, the side
   (left, right or both) and an optional note. The start is today's real
   date, never a `?date=` preview. More than one area can be flagged at
   once; each row then follows the strictest level among them.
2. **Each exercise is tagged** in `program.json` with how much it loads
   each area: `avoid`, `caution` or nothing. While an area is flagged:
   - **Avoid:** left out. The block shows "Left out for your shoulder:
     Pull-ups · Add it back". Adding it back is for that date only, with
     "Pain-free only" on the row and the sets halved (the deload rounding,
     rule 2).
   - **Stand-in:** where the item has one for that area, it replaces the
     item, as a no-equipment swap does: same sets, rest and format, logged
     under the stand-in's exercise id, locked after the first set.
   - **Caution:** kept as written, with "Pain-free only · stop if it
     hurts". The existing Skip leaves it out.
   - **Untagged:** unchanged.
3. **An area-free session when nothing is left.** If a flag leaves no
   main block on a training day (Day 3 with the shoulder flagged), Today
   shows the area's session from the file instead, headed "Shoulder-free
   session · instead of Day 3 (Upper: push)". It has no leg work (Ed's
   answer 5). Days 1 and 5 keep their core work and don't get it.
4. **When to get it checked.** A short sheet, shown in full once when the
   flag is set, and linked from Today's banner. It reuses the Steady
   Strength safety-notes sheet. Wording below.
5. **Clearing the flag.** "My shoulder feels OK" asks nothing medical and
   says: "The app can't tell whether your shoulder is ready. If a physio or
   doctor has given you a plan, follow theirs." Everything returns as
   written at once (Ed's answer 6). The first session in which each
   left-out exercise comes back, its row says "First time back · pain-free
   only" and offers "Half sets today", for that date only.
6. **The record.** Each injury keeps its area, side, start and end dates
   and note. History marks flagged days and lists what was left out or
   swapped. The JSON export and import carry the injuries.
7. **The program keeps moving** (Ed's answer 7). Weeks and days still come
   from the start date.

**Other screens.**

- *Weekly check-in:* with the shoulder flagged, max pull-ups shows "Skip
  while your shoulder is flagged" (a blank is already allowed). A broad
  jump is skipped the same way when a lower-body area that tags it is
  flagged. After an injury, the 10% warning adds "expected after time
  off".
- *Week 8 retest:* with the shoulder flagged, the pull-up and dip retest
  is held back, and the EMOMs keep week 7's figure, as they already do
  when no new max is saved (rule 3).
- *Exercise sheet:* a "Your shoulder" section with the level, what Today
  does with it, and the stand-in's cues.
- *No-equipment ticks:* an injury wins. A row that is left out or has an
  injury stand-in hides its no-equipment tick. Stand-ins are written to
  need little or no kit (a bag or water jug works as the one-hand weight).
- *Combine days:* a combined day is filtered the same way.
- *Unchanged:* the overview, day plans and Steady Strength.

**The shoulder.** "Uninjured side" in a cue means the file never needs to
know left from right. All levels rest on coaching practice.

Days 1, 3 and 5 (upper body):

| Day | Exercise | Level | Today, while flagged |
| --- | --- | --- | --- |
| 1, 5 | YTWI raises | Avoid | Stand-in: dead bug, legs only, 8 per side (so the warm-up isn't empty) |
| 1, 3 | Pallof press | Caution | Kept, pain-free only (weeks 5–8: rotated-in Ab raises, Avoid, left out) |
| 3, 5 | Lateral raise | Avoid | Left out |
| 3 | Plate halo | Avoid | Left out |
| 1 | Med ball slams | Avoid | Left out |
| 3 | Plyo push-ups | Avoid | Left out |
| 3 | Rotational wall throws | Avoid | Left out |
| 5 | Dumbbell push press | Avoid | Left out |
| 1, 5 | Pull-ups (EMOM, mini-dose) | Avoid | Left out |
| 1, 3 | Dips (EMOM, mini-dose) | Avoid | Left out |
| 3, 5 | Overhead press / pike push-up | Avoid | Left out |
| 1, 5 | Back extension | Caution | Stand-in: bodyweight back extension, arms crossed on the chest, same reps |
| 1, 5 | Hanging leg raise | Avoid | Stand-in: lying leg raise, at its no-equipment dose |
| 1 | Side plank | Caution | Stand-in: side plank on the uninjured side only, same holds; it no longer shows "per side" (the stand-in sets `perSide: false`) |
| 5 | Hollow body hold | Caution | Stand-in: hollow hold with the arms by the sides, same holds |
| 3 | Crab knee-to-elbow, crab switch and sprawl | Avoid | Left out (loaded shoulder extension) |
| 3 | On-the-spot crawl | Avoid | Left out (weight on the hands) |
| 1, 5 | Heavy bag / shadow boxing | Avoid | Left out |

Days 2, 4 and 6 (lower body):

| Day | Exercise | Level | Today, while flagged |
| --- | --- | --- | --- |
| 2, 6 | Cossack squat | None | Unchanged |
| 2, 4 | Hip abduction / adduction | None | Unchanged |
| 4, 6 | Single-leg hip thrust | Caution | Kept; a cue says to do it with the shoulders on the floor if the bench presses on the shoulder |
| 2 | Split-squat jumps | None | Unchanged |
| 6 | Lateral skater bounds | None | Unchanged; arms swing loosely |
| 4 | Kettlebell swings | Avoid | Stand-in: broad jumps, hands on hips, 8-min EMOM × 5 (Ed's answer 4, dose confirmed 22 Nov) |
| 2, 6 | Zercher Bulgarian split squat | Avoid | Stand-in: suitcase Bulgarian split squat, one weight in the uninjured hand, same reps |
| 2, 4 | Single-leg RDL | Caution | Stand-in: weight in the uninjured hand only, same reps |
| 4, 6 | Single-leg calf raise | Caution | Stand-in: weight in the uninjured hand, the other hand lightly on the wall, same reps |
| 6 | Wall sit | None | Unchanged |

The shoulder-free session (instead of Day 3, about 12 minutes, core only):

| Block | Exercise | Dose |
| --- | --- | --- |
| Warm-up | Dead bug, legs only (arms resting on the floor) | 2 × 8 per side |
| Core (superset) | Lying leg raise | 3 × 10–15, 2–3s lowering |
| Core (superset) | Hollow hold, arms by the sides | 3 × 20–30s |
| Core (superset) | Prone back extension, arms by the sides | 3 × 12–15, 2s hold at the top |
| Core (superset, 4th item) | Side plank, uninjured side only | 2 × 30s |

Rest between core pairs 45s. It follows the deload halving in weeks 4
and 8, like any block.

**The other areas** (Ed's answer 1) are planned only after Injury 3 is
merged, in their own design PR. The format is ready for them (an area is
a new key in `loads`, `injury` and `injurySessions`); the areas, their
tables and their order are in the next section.

**"When to get it checked"** (the shoulder's wording; each area gets its
own red flags):

> This isn't medical advice, and the app can't tell how bad an injury is.
>
> Get your shoulder checked by a doctor or physio soon if any of these
> happen:
> - You can't lift the arm, or it feels weak or unstable.
> - It popped, slipped out or changed shape, or you fell on it.
> - Numbness, tingling or pins and needles run down the arm.
> - It's very swollen or bruised, or the pain keeps you awake.
> - It isn't getting better after a week or two.
>
> While it's flagged, train only what's pain-free. Mild discomfort that
> settles straight away is OK. If anything is worse the next morning,
> drop it again.
>
> The app doesn't decide when you're ready to load the shoulder again. A
> physio's plan beats the app's.

**Code shape.**

```
 program.json
   exercises.pull_up.loads   { "shoulder": "avoid" }            new, per exercise
   item.injury               { "shoulder": { "exercise": "lying_leg_raise",
                                             "reps": "10-15" } } new, per item
   injurySessions            { "shoulder": { "name": "Shoulder-free session",
                                             "blocks": [...] } } new, top level
        │ parseProgram()  (LoadsWire, InjurySwapWire, InjurySessionWire → internal)
        ▼
 "<programId>.injuries"        (InjuriesWire ⇄ Injury[]: area, side, from, to?, note)
 "<programId>.injury-choices"  (per date: "Add it back", "Half sets today"; pruned
        │                        after 14 days, like the no-equipment ticks)
        ▼
 buildSession(...) ──▶ applyInjuries(session, activeInjuries, choices, log)
                           │  area-free session if no main block is left,
                           │  else left out / stand-in / caution per item
                           ▼
                      Today, log screen, timers, sheet, History
```

- `injury.<area>` takes the same fields as `noEquipment` (`exercise`
  required; optional `reps`, `durationSec`, `load`, `note`, `tempo`) and
  the same parse errors, plus an optional boolean `perSide` that a stand-in
  may set (a `noEquipment` swap may not), so a stand-in keeps the original's
  sets, rest and format. It reuses `applyNoEquipmentSwap`'s dose rules rather than a copy.
- `loads` values are `"avoid"` or `"caution"`; an unknown area or level is
  a parse error naming the path, with the "did you mean" hint.
- Every stand-in and session exercise is an ordinary `exercises` entry
  with cues and `"evidence": "coaching practice"`, so History, charts and
  the CSV export need no special cases.
- "Left out" isn't written into the log. It's worked out from the injury
  dates, so it survives an export and import. Logged sets still lock a
  row, as with the no-equipment ticks: a set logged under the original
  keeps it as written, whatever the flag.
- Wire and internal types are separate, with mapping functions, for each
  new program field and storage key (CLAUDE.md section 6).
- Per CLAUDE.md section 10, a lower-cost subagent implements each step,
  I review and commit it, and a new higher-reasoning subagent challenges
  each PR before it opens.

**Worked examples** (start 2 Nov, max pull-ups 12, max dips 15, right
shoulder flagged from 22 Nov):

| Date | Week / day | Today shows |
| --- | --- | --- |
| 23 Nov | W4 D1 (deload) | Pallof press 2 rounds × 12–15, pain-free only (warm-ups aren't halved); dead bug, legs only, 8 per side instead of YTWI; slams, pull-up EMOM, dip mini-dose and boxing left out; bodyweight back extension 2 × 12–15; lying leg raise 2 × 10–15; side plank uninjured side 1 × 30s |
| 24 Nov | W4 D2 | Suitcase Bulgarian split squat 2 × 12–15 per leg; single-leg RDL mini-dose, uninjured hand, 1 × easy |
| 25 Nov | W4 D3 | Shoulder-free session, core sets halved for the deload |
| 26 Nov | W4 D4 | Broad jumps, 4-min EMOM × 5 (8 min halved) |
| 23 Nov, "Add it back" on the pull-up EMOM | W4 D1 | Pull-up EMOM, 3 min (the deload's 5, halved and rounded up) × 6 reps (week 3's), pain-free only |

**Alternatives considered.**
- *A whole "injured" program* swapped in for the real one: simpler, but
  the lower-body days barely change for a shoulder, and it would split
  History.
- *Pre-skipping sets in the log:* would make "left out" survive a change
  to the tags, but writes data Ed didn't enter and gets wrong if the flag's
  dates are corrected. Deriving it from the dates avoids both.
- *A week at half sets after clearing:* Ed found it too cautious.

**Milestones.**

- **Injury 1 — Shoulder tags and stand-ins in the file** *(behavior
  change)*: `loads`, `injury` and `injurySessions` in the wire types,
  parser and model; the shoulder data above in `public/program.json`;
  data tests; the exercise sheet's "Your shoulder" section only. Every
  session is unchanged. README documents the fields.
  1. [x] File format: `loads`, `injury` (validated by the same function
     as `noEquipment`) and `injurySessions` in the wire types, parser and
     model, with unit tests (`src/program/injuryFormat.test.ts`) and README.
  2. [x] The shoulder data and stand-in exercises in `public/program.json`,
     with data tests over the shipped file (`src/program/injuryData.test.ts`,
     including every unflagged session matching the program without the
     injury fields). The parser takes one number for `durationSec`, so the
     session's hollow hold is 30s, not 20–30s. (Step 4 lets a stand-in set
     `perSide`, so the Day 1 side plank stand-in no longer shows "per side".)
  3. [x] The exercise sheet's "Your shoulder" section, with E2E
     (`e2e/injurySheet.spec.ts`). Stand-in views are built by a new
     `applyStandIn` shared with `applyNoEquipmentSwap`; the EMOM dose reads
     "5 / min, 8 min" (the sheet's usual wording), not "8-min EMOM × 5".
  4. [x] Fixes from the challenger review: on a row ticked "No equipment"
     the sheet's "Your shoulder" now describes the original item (level and
     stand-in; `applyNoEquipmentChoices` carries the `injury` views); the
     section lists the stand-in's cues; a stand-in may set `perSide` (side
     plank: `false`, note "Uninjured side only"); data: floor cue for the
     bodyweight back extension, "uninjured hand" loads on the calf-raise
     stand-ins, a dead bug stand-in for YTWI raises (Days 1 and 5 keep a
     warm-up); README corrected; tests for the 23 Nov stand-ins and the
     no-level branch; one e2e title fixed.
  - Merge point: the doses can be checked on a phone, nothing else moves.
- **Injury 2 — Flag the shoulder and train around it** *(behavior
  change)*: the injuries storage key, Settings, the banner and "When to
  get it checked", left-out, stand-in and caution rows, "Add it back",
  the shoulder-free session, the log screen and timers. E2E on Day 1,
  Day 3 and Day 4. Notes carried over from the Injury 1 review:
  (a) while the shoulder is flagged, also hide a row's No-equipment tick
  when the swap exercise itself is tagged avoid (Pallof press → plank
  shoulder taps); (b) rotated-in warm-ups (Reverse fly, Ab raises,
  Kickbacks) follow the level of the item they replace, so check the
  wording on rotated weeks; (c) consider showing "Your shoulder" on the
  sheet only while the shoulder is flagged; (d) an injury session with
  `blocks: []` parses but would show empty, so refuse it at parse time or
  handle it.
  Steps:
  1. [x] Storage: `<programId>.injuries` and `<programId>.injury-choices`
     (`src/injury/`: wire types, mappings, tolerant loading, re-read before
     save, 14-day pruning of choices, `activeInjuriesOn`, `flagInjury`,
     `clearInjury`), with unit tests. The wire for choices holds a kind per
     item, so Injury 3 adds "Half sets today" as a second kind.
  2. [x] Session logic: `applyInjuries` (`src/program/injury.ts`), chained into
     `buildSwappedSession` / `buildSwappedCombinedSession` (new optional
     `injuries` and `injuryChoices` parameters) BEFORE the no-equipment swaps,
     so an injury wins (note a is done there). Left-out items are marked, not
     removed, and skipped by `isSessionInProgress`. Note (d): the parser
     refuses an injury session with `blocks: []`. Note (b) holds and is tested
     (week 5). Unit tests cover the worked examples.
  3a. [x] UI, the flag: Settings "Injury" section (flag, clear with a plain
     confirmation, past injuries as lines), Today's "I'm injured" link and
     banner, and the "When to get it checked" sheet. E2E in `e2e/injury.spec.ts`.
  3b. [x] UI, the rows: left-out / stand-in / caution rows, "Add it back", the
     shoulder-free session heading, log screen and timers (including the
     left-out item's part in the log screen's progress), note (c), and E2E on
     Day 1, Day 3 and Day 4.
     Differences: the "Pain-free only" line sits under the name/details, not
     under the dose; the blocks count in "~N min · M blocks" skips blocks whose
     items are all left out; a stand-in's sheet says "Instead of <original>"
     and has no "Your shoulder" section; an added-back row's sheet still uses the
     "left out" wording; a combined day shows ordinary blocks, with no
     area-free heading. Injuries are re-read on each render.
  4. [x] Fixes from the challenger review:
     1. A combined session reads the flag from the host (training) date for
        both days; each day's own date only sets its week, deload and blocks.
     2. Clearing the flag no longer rewrites a session already trained: sets
        logged under a stand-in's id keep the stand-in, and an area-free
        session with logged sets stays the area-free session, flagged or not.
     3. The header's minutes are re-estimated from what is left whenever
        anything is left out or added back (an added-back row at its halved
        dose), with the same estimator as the shoulder-free session
        (`estimatedSessionMinutes`): 23 Nov flagged is about 9 min, not 50.
     4. "Last time", Progress and the History wording recognise an item's
        injury stand-in ids, and an area-free session's items through the
        area session's own blocks (`findLoggedBlockAndItem`).
     5. A stood-in rotated warm-up says "Instead of <rotated name>" (week 5:
        "Instead of Reverse fly").
     6. "Add it back" focuses the first added-back row when several keys come
        back (boxing has one item, so it already worked; the e2e covers it).
     Known and deferred:
     - (i) Clearing ships here, but "First time back" and "Half sets today"
       come in Injury 3 (stacked next).
     - (ii) The storage readers drop unknown areas and kinds, so an older app
       copy would drop a newer choice on save. Acceptable for one user on one
       phone; revisit if a second area or choice kind is added.
     - (iii) A Day 3 started before the flag (sets logged under the original
       day) stays the original day with only what is not left out, so logged
       sets are not orphaned. By design.
     - (iv) Decided (Ed, 23 Nov): the rotated-in "Ab raises" (instead of the
       Pallof press) are hanging raises, so they are left out while the
       shoulder is flagged. Done in Injury 3b below. "Kickbacks" (instead of
       the hip thrust) keep inheriting "caution".
  - Merge point: Ed can flag the shoulder and train every day of the week.
- **Injury 3 — Clear the flag, check-in, retest, History and export**
  *(behavior change)*: "My shoulder feels OK", "First time back" and "Half
  sets today", the check-in and week 8 changes, History marks, export and
  import of injuries. E2E.
  Steps:
  1. [x] "First time back" and "Half sets today" after the flag is cleared:
     `applyReturnToTraining` (`src/program/injury.ts`) after `applyInjuries` in
     both builders; the "halfSets" choice kind; the row line and button on Today
     (the log screen and timers read the same builders). Window choice: only an
     injury cleared in the last 14 days marks rows (the clearing date and the 13
     days after it, `RETURN_TO_TRAINING_WINDOW_DAYS`), so an old clear never
     keeps marking. "First time back" ends when any set under the original's id
     is logged on a date from the clearing date up to (not including) the shown
     date; sets under a stand-in's id don't count; today's own sets keep the
     mark but hide the button. A ticked No-equipment swap replaces the marked row.
  2. [x] Weekly check-in, week 8 retest, History marks, export and import of
     injuries. Decisions: the check-in drops the pull-up field (and saves no
     pull-up value) while the shoulder is flagged on the shown date, and a
     pull-up drop adds "expected after time off" when a shoulder injury was
     active or cleared in the 28 days before the check's date (card and Today
     banner); the retest holds back exercises a flagged area tags "avoid"
     (pull-ups, dips) behind one line, the jump stays, and the card's done
     condition is the jump or "Skip jump"; History derives the tag and the
     left-out/stand-in lists from the injury dates with `buildSwappedSession`
     (nothing stored; a combined day shows the tag only); the JSON export adds
     an optional `injuries` field to version 2 (no bump, like `optionalBlockChoices`),
     an older file without it leaves the stored injuries alone (a file with the
     section replaces them; changed by step 3 below), Undo
     restores the previous injuries, and injury choices are not exported. The
     broad-jump skip for lower-body areas waits for those areas.
  3. [x] Fixes from the challenger review:
     (1) "Half sets today" is offered, and "Sets halved today" shown, only where
     halving changes the dose (not warm-ups or one-set items);
     (2) the header's minutes are the file's written minutes scaled by the
     share of estimated work left after rows are left out, added back or
     halved (subtracting the removed estimate left a flagged deload Day 1 at 38
     of 50 min), never below the estimator's reading of what remains or 1, for
     both the Injury 2 path and half sets (W5 D1 halved 44, W4 D1 flagged 21,
     W1 D1 flagged 19 and 26 with the pull-up EMOM added back); the
     area-free session keeps its own estimate;
     (3) the week 8 retest keeps holding back max-tested exercises for the 14
     days after a clear (the line now reads "Pull-ups and dips aren't retested
     while your shoulder is flagged or in its first two weeks back.");
     (4) import: a file with no `injuries` section keeps the stored injuries, one
     with the section replaces them (the preview says so and warns about an
     open flag that would go), and an unreadable section is a listed problem
     that keeps the stored ones; this replaces the earlier "an older file
     imports as no injuries" decision;
     (5) History names "Shoulder-free session instead of Day 3 (Upper: push)"
     on an area-free day;
     (6) sets logged under the no-equipment swap id also end "First time back",
     and a swapped row keeps the line (without the Half sets button);
     (7) the check-in sentence is "A drop is common after time off.";
     (8) readability in `noEquipment/session.ts` and the test helper;
     (9) a unit test for "First time back" with "Half sets today" on a combined
     day.
     Deferred / known: an "avoid" item is marked first-time-back even if the flag
     only covered days it didn't appear (e.g. a rest day); caution stand-ins
     aren't marked; a corrupt `to` earlier than `from` keeps the flag open (the
     cautious reading).
  - Merge point: the shoulder feature is complete.
- **Injury 3b — Rotated Ab raises left out** *(behavior change)*: an
  optional `loads` on a `warmupRotation.swaps` entry replaces the original
  exercise's levels while that item is rotated in (`rotatedIn.loads`, read by
  `effectiveLoads` in `applyInjuries` and "First time back"); `program.json`
  gives the Ab raises swap `{ "shoulder": "avoid" }` (Ed, 23 Nov).
  1. [x] Wire/model/parser (reusing `parseExerciseLoads`), rotation, injury
     rules, data, README and tests (unit and e2e: W5 flagged, Ab raises left
     out with "Add it back"; week 4 Pallof press still pain-free only).
  - Known, from its challenger review (low, left as they are): a Pallof
    press set logged after a clear ends "First time back" for the Ab raises
    too (they share the `pallof_press` id); a row with sets already logged on
    a flagged day stays as written with no pain-free cue, as for every avoid
    item; and "First time back" marks the Ab raises even when the flag only
    covered weeks without them (the cautious reading, as for other avoid
    items). A swap's `loads` replaces the original's levels, so `{}` clears
    them (README says so).
  - Merge point: with the shoulder flagged, week 5 has no hanging raises.
- **Then: plan the other areas** *(design)*: done; see "Plan: injury
  management for the other areas" below.

**Open questions for Ed** (with the answer I'm assuming):

None left. Resolved (22 Nov): "shoulder chest" in answer 1 meant shoulder
first; the broad jump EMOM is 5 reps a minute; the shoulder-free session is
the core-only list above.

### Plan: injury management for the other areas *(design)*

The shoulder feature is merged (Injury 1 to 3b). Ed asked to plan the other
areas once it was done, and answered the proposal's questions (23 Nov):

1. **Two passes:** levels and red flags for every area first, then stand-ins
   and area-free sessions one area at a time.
2. **Pass 2 order:** lower back, knee, ankle, elbow and wrist, hip.
3. **Hip** stays one broad area (groin, hip flexor and the joint together).
4. **Elbow and wrist** are one area: the same exercises load both.
5. **The level tables** stay as proposed for now. Ed asked whether they
   should be separate data from the program or stay coupled to it; see
   "Where the levels live" below.

Everything in "Plan: train around an injury" above still holds (no medical
advice, no clearance, the program keeps moving, logged sets lock a row). This
section only adds what a second, third or sixth area needs.

**The areas.** `INJURY_AREAS` becomes, in this order (the order breaks ties,
for example which banner line comes first):

| Key | Label | Sided | In a sentence | With a side |
| --- | --- | --- | --- | --- |
| `shoulder` | Shoulder | yes | your shoulder | Right shoulder / Both shoulders |
| `lower_back` | Lower back | no | your lower back | Lower back |
| `knee` | Knee | yes | your knee | Left knee / Both knees |
| `ankle` | Ankle | yes | your ankle | Right ankle / Both ankles |
| `elbow_wrist` | Elbow and wrist | yes | your elbow and wrist | Right elbow and wrist / Both elbows and wrists |
| `hip` | Hip | yes | your hip | Left hip / Both hips |

The lower back has no side: Settings doesn't ask for one, and the stored
injury leaves `side` out. The `.injuries` wire stays at version 1 with
`side` optional, accepted as absent only for an area that isn't sided (an
older copy of the app skips such an entry, which is the cautious way round
for a backup file). The export carries it the same way.

**Where the levels live** (Ed's question 5). Recommendation: **keep them
coupled**, as `loads` on each exercise in the program file, and move only the
*area* facts out of the UI into one table in code.

- *Per exercise, in the program file (coupled).* How much an exercise loads
  an area depends on how that program writes it: Explosive Endurance's
  Zercher split squat holds a bar in the elbows, and another program's split
  squat may not. The stand-ins and area-free sessions have to sit on the
  program's items and days anyway, so the levels sit next to them. A new
  exercise is added with its tags in the same place, and the parser already
  rejects a misspelt area or level.
- *Per area, in `src/injury/areas.ts` (separate, app-wide).* The label,
  whether it's sided, its sentence forms, its red flags, and which check-in
  and retest fields it holds back. These are the same for every program, so
  they don't belong in `program.json`. Today they are spread as `"shoulder"`
  literals over the check-in, Today, the exercise sheet and the flag text;
  one table replaces them.
- *Alternative considered: a separate levels file* (`injury-levels.json`
  keyed by exercise id). It reads well as a table, but it can drift: an
  exercise added to the program and not to the levels file is silently
  "unchanged" for every area. It would also need its own loader, wire types
  and checks that every id exists. Not chosen.
- To get the "one table" view without the drift, a unit test prints every
  exercise's level for every area as one snapshot table, so a review sees
  any change in one place, and a missing tag shows up as a blank in it.

**Rules a second area needs** (multi-area cases the shoulder never hit):

1. **Strictest level wins** across flagged areas (already true).
2. **A stand-in must suit every flagged area.** Today a stand-in replaces
   the item when every area at the strictest level has one. New: the
   stand-in's own exercise is checked against the other flagged areas. If
   it's "avoid" for any of them, the item is left out, with "Add it back".
   If it's "caution", the stand-in row also says "Pain-free only".
3. **An area-free session is checked too.** When a flag empties a day, the
   first flagged area (table order) with a session in the file still wins,
   but that session's rows then get the other flagged areas' levels, as any
   day's rows do. If every row is left out, the session is shown with its
   rows left out and "Add it back", not replaced by a rest day (Ed's answer
   3 for the shoulder: a day stays a training day).
4. **Stand-ins and swaps are exercises too.** Every exercise in the file is
   tagged on its own merits, including the shoulder stand-ins and the
   no-equipment swaps, so rules 2 and 3 have something to check.
5. **"Uninjured hand" and "uninjured side"** in the shoulder stand-ins
   already read correctly for any area; no wording changes.

**Check-in and retest.**

| Field | Held back while flagged, and for 14 days after a clear |
| --- | --- |
| Check-in: max pull-ups | shoulder, elbow and wrist |
| Check-in: broad jump | knee, ankle, hip |
| Week 8 retest: max pull-ups and dips | shoulder, elbow and wrist |

"A drop is common after time off." (28-day lookback) follows the same
table: it's added to a pull-up drop after a shoulder or elbow and wrist
injury, and to a broad jump drop after a knee, ankle or hip injury.

**Pass 1 levels.** As proposed and agreed (23 Nov). *Avoid* is left out
with "Add it back"; *caution* is kept, pain-free only. An exercise not
listed for an area is unchanged for it. "Its variants" means the
no-equipment swap and the shoulder stand-in of that exercise, tagged the
same unless the pass 1 PR's snapshot table says otherwise (for example the
backpack swing for the kettlebell swing).

| Area | Avoid | Caution |
| --- | --- | --- |
| Lower back | Kettlebell swings, med ball slams, rotational wall throws, back extension (every kind), single-leg RDL, hanging leg raise, crab to base switch and sprawl | Zercher split squat, dumbbell push press, overhead press, split-squat jumps, lateral skater bounds, plyo push-ups, lying leg raise, hollow hold (both kinds), on-the-spot crawl, heavy bag, Cossack squat, single-leg hip thrust, broad jumps |
| Knee | Split-squat jumps, lateral skater bounds, broad jumps, Zercher split squat and its variants, Cossack squat, wall sit, crab to base switch and sprawl | Single-leg RDL, single-leg hip thrust, kettlebell swings, on-the-spot crawl, crab knee-to-elbow, heavy bag |
| Ankle | Split-squat jumps, lateral skater bounds, broad jumps, single-leg calf raise and its variants, single-leg RDL and its variants, on-the-spot crawl | Zercher split squat, Cossack squat, kettlebell swings, crab to base switch and sprawl, heavy bag, wall sit |
| Elbow and wrist | Pull-ups, dips, plyo push-ups, med ball slams, rotational wall throws, plate halo, heavy bag, crab moves, on-the-spot crawl, hanging leg raise, Zercher split squat, and their variants (explosive and table inverted rows, chair dips, pike push-ups); shadow boxing, the heavy bag's swap, is caution | Dumbbell push press, overhead press, kettlebell swings, single-leg RDL, calf raise holding a weight, YTWI raises, lateral raise, Pallof press, side plank (both kinds), back extension with a plate |
| Hip | Cossack squat, lateral skater bounds, split-squat jumps, crab to base switch and sprawl | Zercher split squat, single-leg RDL, single-leg hip thrust, hip abduction / adduction, kettlebell swings, hanging and lying leg raise, on-the-spot crawl |

Broad jumps (the shoulder's Day 4 stand-in) weren't in the proposal's lower
back row; they're added as caution, the same as the other jumps there. That's
the one change, called out for Ed in the pass 1 PR.

**Pass 1 "When to get it checked".** Each area keeps the shoulder sheet's
frame ("This isn't medical advice…", "While it's flagged, train only what's
pain-free…", "The app doesn't decide when you're ready…") with its own
list. Draft wording, for Ed to check in the pass 1 PR:

- **Lower back.** First, on its own line: "**Get urgent medical help
  straight away** if you have numbness around the groin or buttocks, or new
  trouble controlling your bladder or bowels." Then, get it checked soon if:
  pain, numbness or tingling runs down a leg, or a leg feels weak; it
  started with a fall or a hard knock; you feel unwell or feverish, or it
  hurts as much lying still as moving; it isn't getting better after a week
  or two.
- **Knee.** You can't take weight on it, or it gives way; it locks, catches
  or won't straighten; it popped and swelled within a few hours, or you fell
  on it; it's hot, red or very swollen, or the pain keeps you awake; it
  isn't getting better after a week or two.
- **Ankle.** You couldn't walk four steps on it straight after, or still
  can't; it's tender right on the ankle bones or the top of the foot; it
  popped or changed shape, or the back of the heel snapped; it's very
  swollen or bruised, or the foot is numb or tingling; it isn't getting
  better after a week or two.
- **Elbow and wrist.** It happened in a fall onto your hand, or it popped or
  changed shape; you can't grip, or can't bend or straighten it fully; the
  hand or fingers are numb or tingling; it's very swollen or bruised, or the
  pain keeps you awake; it isn't getting better after a week or two.
- **Hip.** You can't take weight on the leg, or it happened in a fall; pain
  in the groin comes with a fever or feeling unwell; numbness, tingling or
  weakness runs down the leg; the pain is there at rest or keeps you awake;
  it isn't getting better after a week or two.

**Pass 2, per area** (proposed; each PR shows its tables for Ed to check
before merge, as the shoulder's did):

- **Lower back:** back extension → bird dog; single-leg RDL → single-leg
  glute bridge; hanging leg raise → dead bug. No day is emptied, so no
  area-free session. Day 5's own lower-back rule (cut back extensions to 2
  sets) stays for days without a flag.
- **Knee:** no stand-ins proposed; Days 2 and 6 are left with little but a
  mini-dose, so a **knee-free session** (about 15 minutes, no knee bending
  under load): glute bridge, side-lying hip raises, straight-leg calf
  raises, dead bug, side plank.
- **Ankle:** single-leg RDL → kickstand RDL (both feet down). No day is
  emptied.
- **Elbow and wrist:** hanging leg raise → lying leg raise; Zercher split
  squat → bodyweight Bulgarian split squat. Days 1, 3 and 5 empty out, so an
  **arm-free session** like the shoulder-free one, with a glute bridge in
  place of the side plank (a side plank loads the elbow).
- **Hip:** the levels are broad on purpose; its PR proposes stand-ins once
  the other four are in and shows them to Ed first.

**Code shape.**

```
 src/injury/areas.ts  (new: label, sided, sentence forms, red flags, held fields)
        │
        ├──▶ injuryFlagText / injuryFlagUi   Settings, banner, "When to get it checked"
        ├──▶ injurySheetText                 "Your knee" section on the exercise sheet
        ├──▶ checkin / retest                which fields are held back
        └──▶ historyInjury                   "Right knee, Lower back"

 program.json loads.<area> ──▶ parse ──▶ applyInjuries (rules 2 and 3 above)
```

**Worked examples** (start 2 Nov, as above; become unit-test fixtures):

- Knee (left) flagged, W1 D2: the Cossack squat, split-squat jumps and the
  Zercher split squat are left out; the single-leg RDL is pain-free only;
  hip abduction / adduction is unchanged.
- Lower back flagged, W1 D5: the back extension and the hanging leg raise
  are left out; the push press, overhead press, hollow hold and heavy bag
  are pain-free only. Day 5 isn't emptied, so no area-free session.
- Shoulder and knee both flagged, W1 D2: the Zercher split squat's shoulder
  stand-in (suitcase Bulgarian split squat) is itself "avoid" for the knee,
  so the item is left out with "Add it back" (rule 2). The single-leg RDL
  is caution for both and the knee has no stand-in, so it stays as written,
  pain-free only.
- Elbow and wrist flagged, W2 check-in: no max pull-ups field; broad jump
  asked as usual. Knee flagged instead: pull-ups asked, broad jump held.

Exact minutes and row lists are pinned in each PR's tests from the data, as
the shoulder's were.

**A break from training** (added 25 Nov; Ed chose to build it). Ed
has a neck injury, and a physio advised a week with no training. Flagging an
area doesn't fit that: it changes sessions but the program keeps moving
(answer 7 for the shoulder). A break stops the clock instead.

- **Start one** from Settings or Today: "Take a break", for a number of
  days (default 7, up to 56) from today, or from tomorrow when today is
  already trained or was folded into yesterday's combined session, with an
  optional note ("Physio: rest the
  neck"). Stored in `<programId>.breaks`, a versioned wire
  (`{ "version": 1, "breaks": [ { "from", "to", "note"? } ] }`) with its own
  internal type and mapping functions, like `.injuries`.
- **The schedule skips it.** A date's week and day count only the days
  outside breaks since the start date, so the day after a week's break is
  the day that would have come next. The start date isn't changed, and
  logged sets keep their own day, so History is untouched.
- **During a break** Today shows "On a break" and "Back on 3 Dec with
  Week 4, Day 4.", the note and "End the break today"; nothing to train.
  History shows one line per break. A coming break can be cancelled.
- **Coming back.** For 14 days after a run of breaks totalling 7 days or
  more, each main-block exercise not yet trained since the first day back
  says "First session back · pain-free only" and offers "Half sets today",
  for that date only, as after a cleared flag. The check-in's
  "A drop is common after time off." also follows a break.
- **Export and import** carry breaks, as they carry injuries.
- A break and a flag can overlap: the flag still applies when the break
  ends, until it's cleared.

**The neck** (added 25 Nov) becomes a seventh area once Ed sends the
physio's list of movements to avoid; its levels come from that list, not
from a guess. Until then a break covers it.

**Milestones.**

- **Areas 0 — this plan** *(design)*.
- **Break 1 — Take a break from training** *(behavior change)*, first,
  so it's ready for the next break: storage, the schedule
  skipping break days, Today and Settings, History, export and import, the
  first-session-back offer, with unit tests and e2e (start a week's break,
  see no session, end it, resume at the next day).
  1. [x] Store breaks: `src/break/` model, wire (`.breaks`, v1, `to` is
     the first day back), operations (`breakOn`, `breakDaysBetween`,
     `startBreak` up to 56 days with no overlap, `endBreak`,
     `lastBreakEndedBefore`) and storage, with unit tests.
  2. [x] The schedule skips break days: `programStatus(..., breaks)` with
     an `onBreak` status, its inverse `dateOfProgramDay` for every
     week/day-to-date site (Day plan, week start and end, retest window,
     held EMOM dates), breaks on the in-memory `TrainingSettings` (filled by
     app.ts, never in the settings wire), no combine offer across a break,
     and a minimal Today card ("Back on 3 Dec with Week 4, Day 4."). Start
     2 Nov with a break 26 Nov to 3 Dec: 3 Dec is W4 D4, 7 Dec W5 D1, and the
     program ends 3 Jan.
  3. [x] Today, Settings and History: a "Break from training" card in
     Settings (take a break for 1 to 56 days with a note, end it today,
     past and coming breaks), a "Take a break" link on Today, the note and
     "End the break today" on Today's break card (not in a `?date=`
     preview), a line per break in History, and History's week grouping
     ignoring break days so a week with a break inside stays one group.
  4. [x] First session back and the check-in sentence: within 14 days
     after a break of 7+ days, each main-block exercise not yet trained
     since the break starts is marked "First session back · pain-free only"
     with "Half sets today" (the injury return's marker, now carrying its
     reason; an injury's wording wins; warm-ups aren't marked). "A drop is
     common after time off." is added to any check-in drop during or up to
     28 days after such a break.
  5. [x] Export, import, README and e2e: an optional `breaks` section in
     the version 2 export; a file without one keeps the stored breaks; the
     preview warns when a stored break would be removed or changed; the
     import backup and undo cover them.
  - Challenger review, all fixed: a cleared injury hid the break's mark;
    sets on a break's first day cancelled it; a break swallowed a day
    already trained or combined (now starts tomorrow); short touching
    breaks never reached 7 days; cool-down and walk rows were marked; the
    Overview lost the current week; "Starts on" ignored a break over the
    start date; a wrong preview hint; overlapping imported breaks; no way
    to cancel a coming break; the cap raised from 28 to 56 days.
  - Known, left as is: `breaks` is optional on `TrainingSettings`, so a
    path that builds settings without `withBreaks` would schedule as if
    there were none (every current path is covered); a break can't be
    extended in place (end it and start another, which counts as one run
    for "First session back").
  - Merge point: a break can be taken and ended, and the schedule resumes
    where it stopped.
- **Areas 1 — One table for the area facts** *(internal refactor)*: add
  `src/injury/areas.ts` with only the shoulder, and read the label, sentence
  forms, red flags and held check-in and retest fields from it instead of
  `"shoulder"` literals. No visible change; the existing unit and e2e tests
  must pass unchanged.
  - Merge point: the shoulder works exactly as before.
- **Areas 2 — Pass 1: the five areas, their levels and red flags**
  *(behavior change)*. Steps, one commit each:
  1. Sideless areas: optional `side` in the injury wire and model, and
     Settings hiding the side for the lower back.
  2. Add the five areas to `INJURY_AREAS` and `areas.ts`, with their red
     flags and held fields (check-in and retest).
  3. Rules 2 and 3 (stand-ins and area-free sessions checked against the
     other flagged areas), with the shoulder-and-knee worked example.
  4. The levels in `program.json`, with the snapshot table test.
  5. README and e2e: flag the lower back (no side asked, back extension left
     out), flag a knee (Day 2 rows, broad jump held at the check-in), and
     shoulder plus knee together.
  - Merge point: any of the six areas can be flagged and trains safely,
    with left-out rows and "pain-free only" but no new stand-ins yet.
- **Areas 3 to 7 — Pass 2, one PR per area** *(behavior change)*, in Ed's
  order: lower back, knee, ankle, elbow and wrist, hip. Each adds the new
  exercises (with their own levels for every area), the stand-ins and, for
  the knee and the elbow and wrist, the area-free session, with tests, e2e
  and a screenshot of a flagged day.
  - Merge point: after each, that area has the full shoulder treatment.

Each PR gets its own challenger review before it opens (CLAUDE.md section
10).

**Open questions for Ed** (with the answer I'm assuming):

1. **Broad jumps as caution for the lower back**, added to the proposal's
   row? *Assumed: yes.*
2. **The physio's list for the neck.** *Waiting on Ed.*

Resolved (25 Nov): Ed chose to build "Take a break" rather than move the
start date by hand.

Resolved (23 Nov): the levels stay coupled to the program, on each
exercise, with the area facts in one code table (Ed: "let's couple them").

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
| 30 Nov | W5 D1 | Power endurance | Heavy bag 4–5 rounds × 25–35s work / 30s rest (timer starts 5 × 35s / 30s); core rest between pairs 30–45s (Rest button 30s) |
| 4 Dec | W5 D5 | Power endurance | Core rest between pairs 30s |
| 21 Dec | W8 D1 | Deload + retest | With pull-up max 12 saved 2 Nov and 14 saved 18 Dec (W7 D5): pull-up EMOM holds 6 (week 7's figure with 12, shown on 14 Dec), not 7 |
| 7 Nov | W1 D6 | Base | Wall sit finisher 5 rounds × 90s work / 60s rest; Day 6 about 42 min |
| 28 Nov | W4 D6 | Deload | Wall sit 5 rounds × 90s / 60s, not halved; skater bounds still halved to 3 × 6 per side |
| 5 Dec | W5 D6 | Power endurance | Wall sit 5 × 90s / 60s, unchanged (no "+5s work" line); W5 D1 heavy bag still 25–35s |
| 26 Dec | W8 D6 | Deload + retest | Skater bounds 3 × 6 per side; wall sit 5 × 90s / 60s (the retest card shows on Today) |
| 4 Nov | W1 D3 | Base | Core superset: crab knee-to-elbow 3 × 10, crab to base switch and sprawl 3 × 6, rest 45–60s between pairs; Day 3 about 40 min |
| 25 Nov | W4 D3 | Deload | Core: 2 × 10 and 2 × 6, rest 45–60s |
| 2 Dec | W5 D3 | Power endurance | Core: 3 × 10 and 3 × 6, rest 30–45s (Rest button 30s) |
| 23 Dec | W8 D3 | Deload + retest | Core: 2 × 10 and 2 × 6, rest 45–60s |
| (no start date) | — | — | Overview: 8 weeks, 6 training days, about 242 min a week (50+30+40+30+50+42 from the shipped `program.json`, after PR 13); phases Base W1–3, Deload W4, Power endurance W5–7, Deload + retest W8; CTA "Start Day 1: Upper: pull" |
| 9 Nov (start 2 Nov) | W2 D1 | Base | Overview CTA "Go to today: Week 2 · Day 1"; week 2 highlighted |
| 8 Nov (start 2 Nov) | W1 D7 | Base | Overview CTA "Go to today: Rest day" |
| Day plan, start 2 Nov, max 12 / 15 | Day 1, W1 → W2 | Base | Pull-up EMOM 4 → 5 / min ("Changed: 4 / min in week 1"); med ball slams 6 × 6 unchanged, so no line |
| Day plan, start 2 Nov, max 12 / 15 | Day 1, W3 → W4 | Deload | Med ball slams 3 × 6 ("Changed: 6 × 6 in week 3"); main strength block "Changed: 9 min in week 3", pull-ups 6 / min held (no item line); dip mini-dose 1 × 7 ("Changed: 2 × 7 in week 3") |
| Day plan, no start date saved | Day 1, W2 | Base | Same doses as a saved start date would give; max-based rows say "Set max" unless maxes are saved; no start date is saved |

**Steady Strength** (PR 16), start date 2 Nov 2026, no maxes:

| Date | Week / day | Phase | Example figures |
| --- | --- | --- | --- |
| 2 Nov | W1 D1 | Settle in | Single-leg stand 4 rounds × 20s / 20s rest; high wall sit 3 × 20s / 40s; sit-to-stand 3 × 8–12, 60s rest; Otago warm-up 1 round; 6 blocks |
| 3 Nov | W1 D2 | Settle in | Balance and walk, about 15 min: two balance holds 4 × 20s, sideways walking 2 × 10 steps, sit-to-stand 1 × 8, walk 10–20 min |
| 4 Nov | W1 D3 | Settle in | Wall push hold 3 × 15s / 30s; grip squeeze 4 × 10s / 15s; band row 3 × 8–12, 60s rest |
| 8 Nov | W1 D7 | Settle in | Rest-day card |
| 16 Nov | W3 D1 | Build | Single-leg stand 4 × 25s; high wall sit 3 × 25s / 40s; sit-to-stand still 3 × 8–12 (nothing halved) |
| 23 Nov | W4 D1 | Build | Same as week 3: no easy week, nothing halved |
| 9 Dec | W6 D3 | Strengthen | Wall push hold 3 × 25s; grip squeeze 4 × 20s; wall side plank 4 × 25s |
| 21 Dec | W8 D1 | Strengthen | Single-leg stand 4 × 30s; high wall sit 3 × 30s; no retest card, check-in or "Set max" anywhere |
| (no start date) | — | — | Overview: 8 weeks, 6 training days, about 135 min a week (30+15+30+15+30+15); phases Settle in W1–2, Build W3–5, Strengthen W6–8; "Before you start" card with the 5 safety notes; CTA "Start Day 1: Legs and core" |
| Switching | — | — | Explosive started 2 Nov with a logged set, then Steady Strength chosen and started 9 Nov: switching back shows Explosive at its 2 Nov start with the set still logged, and Steady Strength still starts 9 Nov |

**No-equipment swaps** (PR 17), Explosive Endurance, start date 2 Nov
2026, max pull-ups 12, max dips 15, with the named item ticked:

| Date | Week / day | Phase | Example figures |
| --- | --- | --- | --- |
| 2 Nov | W1 D1 | Base | Explosive inverted rows 6 × 6, 30–45s rest (no-kit swap for med ball slams); inverted rows 9-min EMOM × 6–8 per minute (no max used); chair dips mini-dose 2 × easy, ~50% effort |
| 2 Nov | W1 D1 | Base | Nothing ticked: the session is exactly as today, pull-up EMOM 9 min × 4 |
| 16 Nov | W3 D1 | Base | Inverted rows 9 min × 8–10 per minute |
| 23 Nov | W4 D1 | Deload | Explosive inverted rows 3 × 6; inverted rows 5 min × 8–10 (week 3's, held); chair dips 1 × easy |
| 30 Nov | W5 D1 | Power endurance | Inverted rows 9 min × 6–8 (block 2 restarts); shadow boxing 4–5 rounds × 25–35s / 30s rest |
| 21 Dec | W8 D1 | Deload + retest | Inverted rows 5 min × 8–10 (week 7's, held), both before and after a retested pull-up max of 15 is saved on 21 Dec |
| 4 Nov | W1 D3 | Base | Chair dips 9-min EMOM × 8–10; water jug halo 8 each direction; plank shoulder taps 12–15 per side |
| 5 Nov | W1 D4 | Base | Backpack swings 8-min EMOM × 12–15; backpack single-leg RDL 3 × 12–15 per leg, 3s lowering, 3s hold at the bottom |
| 26 Nov | W4 D4 | Deload | Backpack swings 4 min × 12–15; backpack single-leg RDL 2 × 12–15 per leg |
| 6 Nov | W1 D5 | Base | Backpack push press 5 × 5, 45s rest; pike push-ups 3 × 15–20, 60s rest, 2s lowering; lying leg raise 4 × 15–20; prone back extension 3 × 25 |
| 7 Nov | W1 D6 | Base | Stair calf raise with a backpack 3 × 20–30 per leg, 2s pause at the bottom |
| 28 Nov | W4 D6 | Deload | Stair calf raise 2 × 20–30 per leg |
| Logging | W1 D4 → W2 D4 | Base | Backpack RDL ticked and one set logged on 5 Nov: the set is stored as `backpack_single_leg_rdl` and the tick is locked. On 12 Nov the ticked row's "Last time (5 Nov)" shows it; the unticked RDL's "Last time" ignores it |

**"Show me" animations** (PR 20), Steady Strength, start date 2 Nov 2026:

| Where | What shows |
| --- | --- |
| 2 Nov, W1 D1, Today | Every row has "▶ Show me" (15 rows); tapping the high wall sit row's name still opens its log screen |
| High wall sit view | Header "High wall sit · 3 × 20s"; cue "Back on the wall, slide down a little and hold."; side view only; loop: Start 1.5s, move 2.5s, Hold 4s, move back 2.5s = 10.5s |
| Sit-to-stand view | Loop: Start (seated) 1.5s, "Stand up" 2.5s, End (standing) 1.5s, "Sit down slowly" 2.5s = 8s; at "Slower", 16s |
| Single-leg stand view | Opens at the three-quarter angle; "Turn" swings round to side, then front, keeping the loop's place |
| No WebGL, high wall sit | The flat outline figure with the same loop, cue and controls |
| Reduced motion, high wall sit | Two stills, "Start" and "Hold", nothing moves; "Next step" swaps which one is large |
| Pause at 3s, high wall sit | The figure stays at the frame shown at 3s (in the move down); Play carries on from there |
| 2 Nov, Explosive Endurance W1 D1 | No "Show me" on any row |
| 4 Nov, W1 D3, before PR 22 | "Show me" on the warm-up, heel-to-toe stand and cool-down rows only (the exercises Day 3 shares with Days 1 and 2); after PR 22 on every row |
| Glute bridge hold view | The bridge on the bed, not the standing buttock squeeze |

A second start date shows the cycle doesn't depend on the weekday: start
4 Nov → 4 Nov is W1 D1 (Upper: pull), 10 Nov is W1 D7 (rest), 11 Nov is
W2 D1, and 3 Nov is "not started".

## 7. Open questions

For PR 17 (no-equipment swaps), each with the answer I'm assuming:

1. **The doses in the swap tables.** Especially the starting figures for
   swapped EMOMs (inverted rows 6–8 and chair dips 8–10 per minute) and
   the calf raise, where the heavy set becomes a third high-rep set. Are
   they right for Ed?
2. **The refinements to the earlier list** ("Changes from the earlier
   list"), above all the Pallof press becoming plank shoulder taps.
3. **Ticks reset every session.** I'm reading "before each session, tick"
   literally. Remembering them would be a small follow-up.

For PR 14 (Steady Strength), each with the answer I'm assuming:

1. **Name.** "Steady Strength", goal "Gentle holds and light strength work
   to keep the core, legs, wrists and shoulders strong and stable". Happy
   with that?
2. **Who uses it.** I'm assuming the person doing the program uses their
   own phone, and Ed may try it on his. Each program keeps its own data, so
   either works.
3. **App name.** The home-screen name and page title still say
   "Explosive Endurance" / "Endurance". I'm leaving them alone; a neutral
   name such as "Workouts" would be a small follow-up if Ed wants it.

Resolved:

- **Day 1 no-kit explosive swap (follow-up to PR 17):** explosive inverted
  rows under a table, 6 × 6, 30–45s rest, replacing "Backpack slams" (Ed,
  16 Nov). Ed chose it over explosive push-ups, because Day 1 is a pull day,
  and accepted two row blocks in one no-kit session. The backpack slam entry is
  removed. Plyo push-ups stay on Day 3.
- **3D, not stick figures (PR 20):** Ed, 12 Nov.
- **Colours (PR 20):** white on black, moving parts in yellow (Ed, 12 Nov).
- **One rep, not the dose (PR 20):** the loop shows one rep or a short
  hold, and the header says the real dose (Ed, 12 Nov).
- **The rest of PR 20 (Ed, 12 Nov, after a preview of the high wall sit
  and sit-to-stand):** a mannequin built in code, not a realistic human
  model; "Show me" on the rows and the log screen, not on the ⓘ sheet;
  exercises with a progression show the most supported stage.

- **Which discs (PR 14):** the lower back (Ed, 11 Nov). The plan already
  keeps the lumbar spine neutral and avoids loaded bending and twisting.
- **Doctor check on Start (PR 14):** not required (Ed, 11 Nov). The safety
  card is shown but never blocks Start.
- **Evidence (PR 14):** gathered during planning, in the Evidence table,
  not left for implementation (Ed, 11 Nov).
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
