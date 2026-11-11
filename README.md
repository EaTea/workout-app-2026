# Explosive Endurance

A mobile-first web app for following an 8-week "Explosive Endurance" training
program. Today it shows today's session from `public/program.json` (with
deload weeks applied), turns max-based reps into concrete targets from your
tested maxes, shows exercise details (cues, alternative, evidence,
progression) and has a settings screen. The first time you open it (no start
date yet) it shows a program overview instead: the 8 weeks and their phases, a
typical week, the order of every session, and one "Start Day 1: Upper: pull"
button that saves today as Day 1 and opens Today. Later the overview is one tap
away from the "Program overview" link on Today and in Settings. Each training day on the overview
is a link to a read-only day plan (`#/plan/<day>/<week>`): every block and exercise with that week's doses,
a week picker (1 to 8, opening on the current week while the program runs, otherwise week 1), the phase's
changes, and a "Changed: ... in week N" line under whatever differs from the previous week. EMOM rows have a "Start EMOM" button
that opens a full-screen timer with a beep and vibration each minute and a
3-2-1 countdown (the beeps ask Safari 16.4+ to play through an iPhone's
silent switch; older iOS versions may still mute them, and iOS Safari has no
vibration). The heavy bag and Day 6 wall sit rows have a "Start timer"
interval timer and rows with a prescribed rest (and superset blocks) have a
"Rest 30s" button, all with adjustable numbers before Start. The Back button or gesture closes an open timer
(and stays on the same screen). The screen stays awake while a timer is open,
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
sets and tap a set to edit or delete it. History opens with a Progress card:
pick a strength exercise to see its best reps per session over weeks 1–8 (and
the heaviest load, when any was logged), with deload weeks shaded and the same
numbers in a table below. On every week 8 training day Today opens
with a "Retest week" card: steppers (starting at your current maxes) and a
"Save max" button per exercise for pull-ups and dips. Saving stamps the max with
today's real date and switches week 8's EMOM targets to the new max at once; the
card stays until both are saved that week, and "Not today" hides it for that
date only. The card also has an optional "Best broad jump" field (same
stepper, blank and Clear rules as the weekly check-in, with "Best recent") and
its own "Save jump" button. It does not hold the card while a max is still to
do, but once both maxes are saved the card stays with only the jump block until
a jump is saved that week; "Skip jump" there hides it for the rest of the week. In a `?date=` preview of another day both cards show but can't
save. On other training days (weeks 1-7), until the week's check is saved,
Today opens with a "Weekly check-in" card: best broad jump (metres, 0.01 steps
or tap the number to type it) and max pull-ups, either of which may be left
blank (both start blank; the first tap on a stepper starts from "Best
recent", and "Clear" goes back to blank). Each shows "Best recent" (the best of
the previous 3 checks that recorded it) and a percentage pill; a drop of more than 10% shows the
program's `fatigueCheck.rule` text as a warning on the card, and after saving
as a dismissible banner on Today for the rest of that week. "Remind me
tomorrow" hides the card for that date only. Saving the week 8 retest of
pull-ups and/or the broad jump records them as that week's check, whichever is
saved first, the other merging into it later. Checks are stored in
`localStorage` under `<programId>.fatigue` (`explosive-endurance.fatigue` for Explosive Endurance). It is a static site
(Vite + TypeScript, no UI framework).

**Where data is kept.** Every program keeps its own data in `localStorage`
under keys that start with its id from `programs.json`: `<programId>.settings`,
`.max-history`, `.log`, `.fatigue`, `.checkin-snoozed`,
`.fatigue-warning-dismissed`, `.rotation-dismissed`, `.retest-dismissed`,
`.retest-jump-skipped`, plus the backup keys `.log.corrupt-<time>`,
`.fatigue.corrupt-<time>` and `.import-backup-<time>`. For Explosive Endurance
(`explosive-endurance`) these are the keys the app has always used. One key is
app-wide: `workout-app.active-program` (JSON `{"version":1,"programId":"..."}`)
says which program runs; when it is missing or names a program that is not in
`programs.json`, the first program listed is used. The service worker's reload
guard is app-wide too, but it lives in `sessionStorage` (not `localStorage`) and
only lasts for the browser tab. The keys are built in `src/storage/programKeys.ts`.

## Programs

The app can hold more than one program; `public/programs.json` lists them (see
"Editing program.json"). Two are shipped:

- **Explosive Endurance** (`public/program.json`): the 8-week explosive and
  muscular-endurance program described above.
- **Steady Strength** (`public/steady-strength.json`): a gentle 8-week program
  for someone aged 75 or over, including people with a history of lower-back
  disc problems. It favours short isometric holds, balance practice and light
  strength work with a band, body weight or a kitchen counter, to keep the core,
  legs, wrists and shoulders strong and stable. The week is three main
  sessions of about 30 minutes (Day 1 Legs and core, Day 3 Shoulders, wrists and
  core, Day 5 Whole body), balance and walking sessions of about 15 minutes on
  Days 2, 4 and 6, and Day 7 rest: about 2 h 15 min a week. Holds are
  interval items that grow by 5 seconds in weeks 3-5 and 10 seconds in weeks 6-8
  (phases Settle in, Build and Strengthen); there are no easy weeks. Each
  exercise's evidence link is a DOI, and the file's `program.safety` list holds
  the safety notes. **It is general exercise guidance, not medical advice:
  check with your doctor or physiotherapist before starting, especially after
  slipped discs, with osteoporosis, heart or blood pressure problems, or after
  a recent fall or operation.** Until the program picker arrives, the app
  still opens Explosive Endurance.

`program.safety` is an optional list of non-empty strings in the `program`
object; a program without it (Explosive Endurance) has no safety notes.

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
screen and also sets the start date when you tap Start Day 1 on the overview, but never changes
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
CI runs the same suite; see "Deployment" below.

## Editing program.json

`public/program.json` is the Explosive Endurance program. If you break
something that would make a session wrong (wrong type, missing field, unknown
exercise id, a week with no progression phase) the app shows an error card
naming the file and the path; a field the app doesn't recognise is only a
warning: the field is ignored, the session still loads, and an amber banner on
Today lists each one. A misspelt field name (say `weeklyIncreese`) is ignored
too, so that part of the session is missing; the banner suggests the fix ("did
you mean "weeklyIncrease"?") and opens its list straight away when it spots a
likely typo.

`public/programs.json` is the catalogue of programs: a list of
`{ "id": "explosive-endurance", "file": "program.json" }` entries (ids use
lowercase letters, digits and hyphens; `file` is a plain `.json` file name in
`public/`). The app loads the catalogue first, then the program file of the
chosen entry. A bad catalogue shows the same error card, naming the file and
the path (e.g. `./programs.json: programs[0].id`).

**Warning: never change an existing program's `id`.** The id names that
program's storage keys (`<id>.log` and so on), so renaming it strands the
program's data under the old keys, and backups made under the old id would be
refused. Also, the first entry is what opens when no program has been chosen
(or the chosen one is no longer listed), so reordering the entries can switch a
phone to another program. Add new programs at the end.

A program file may leave out `fatigueCheck`, `warmupRotation` and
`coreProgressions`. Without `fatigueCheck` there is no weekly check-in, drop
banner or retest broad jump; without `warmupRotation` warm-ups never rotate and
there is no rotation card. When a section is present it is checked as before.

`days[].day` and `restDay` are whole numbers from 1 to 7: Day 1 is the session
on your start date, and Day 7 is the rest day in the shipped program (not
weekday names). A progression phase can set `"retest": true`; EMOMs in that
week hold the previous week's reps until you save a new max for that exercise
during the week (Today shows a retest card for it in week 8; Settings works
too); then they use that max with no weekly increase. The held reps use the
max that was in effect on the last week 7 day with that EMOM (every saved max is kept as a
dated history in its own `localStorage` key, `<programId>.max-history`,
separate from `<programId>.settings` so an older copy of the app can't
wipe it; clearing a max keeps its history), so a max raised later in week 7
doesn't change them.

A progression phase can also set `"timerAdjustments"`, whole seconds (negative
allowed, either key optional): `"intervalWorkSec"` is added to every interval
item's `workSec` range (heavy bag) and `"coreRestBetweenPairsSec"` to every
core block's `restSecBetweenPairs`, never going below the timer's 5 second
floor. The shipped program sets `{"intervalWorkSec": 5,
"coreRestBetweenPairsSec": -15}` on weeks 5-7 (Power endurance), so Today
shows the adjusted numbers with a "Power endurance: +5s work" / "−15s rest"
line and the timers start from them. Explosive rest is not adjusted. The
adjustment applies to every week of the phase it is set on, including a
deload week if you put it on one.

An item can opt out of all the week-by-week changes with `"sameEveryWeek": true`
(optional, true or false, default false): it gets no timer adjustment and no
deload halving of its sets, minutes or rounds, so it is the same in all 8 weeks
(and Today shows no "Power endurance" line for it; in deload and power
endurance weeks its row says "Same every week" instead). The shipped program
uses it for the Day 6 wall sit (a finisher after the Zercher split squat: 5
rounds of 90s with 60s rest, Day 6 is ~42 min). Anything but true or false is
an error, and so is combining it with `weeklyIncrease` or putting it in a block
with its own `rounds` or `minutes` (both would still change from week to week).

## Warm-up rotation

Every `warmupRotation.everyWeeks` weeks the warm-ups alternate between the
exercises as written and the swaps in `program.json` (with the shipped
program, weeks 5–8 use the swaps). A rotated-in warm-up shows its new name
with "Rotated in for <original>" and has no details sheet; its sets are
still logged under the original exercise. Every training day of a rotated
block shows a "Warm-up rotation" card listing the swaps until you tap "Got
it" (remembered per block; disabled when previewing another date with
`?date=`). History shows the name the warm-up was performed as.

## Exporting your log

In Settings, "Export log as CSV" gives one row per logged set (date, week,
day, block, block type, exercise id, exercise name, performed as, set, reps,
kg, note) for any spreadsheet; `exercise_name` is the program's name and
`performed_as` the rotated-in warm-up name, if any. The file starts with a
UTF-8 byte order mark so Excel reads it correctly. The export reads what is
stored at the moment you tap the button.
"Export everything as JSON" gives the log, the weekly checks, your
settings and the max history (every max you saved, under `maxHistory`) in a
versioned file (`"format": "explosive-endurance-export"`, `"version": 2`, and
`"programId"`, the catalogue id of the program the data belongs to),
plus `corruptLogBackups` if the app ever had to set aside unreadable log text,
and `importBackups` if an import ever replaced data (see below). Files are
named `<programId>-YYYY-MM-DD.csv` or `.json` (for example
`explosive-endurance-2026-11-09.json`); they download, or on
iPhone open the share sheet so you can save them to Files. Nothing is sent
anywhere.

### Importing a JSON export

Settings also has "Import from JSON", for a new phone or a cleared browser.
Choose a file made by "Export everything as JSON" and the app shows what it
holds (sessions, sets, weekly checks, the dates logged and the start date)
before changing anything. "Replace my data" then asks once more ("Yes,
replace my data"); "Cancel" leaves everything as it was.

- A file that is not an export, is not valid JSON, is a version other than 1
  or 2, has a version 2 `programId` that is not a valid program id, or has no
  readable log, check-ins or settings section is refused with a message.
  Version 1 files (from before programs had ids) are read as belonging to
  `explosive-endurance`.
- A backup that belongs to another program than the one you are using is
  refused before anything is shown or changed: "This backup is for
  "steady-strength", but you're using "explosive-endurance". Switch program
  first, then import it." The preview also shows when the file was exported and how many
  sessions you have now. A file with a few unreadable sets or checks is accepted the way the
  stored data is: the readable ones are kept and the preview lists what was
  left out. Files exported before the max history was added (no `maxHistory`)
  and files with older settings versions still import.
- Importing replaces the log, weekly checks, settings and max history. Before
  anything is written, the current data is saved as a backup in the browser
  (key `<programId>.import-backup-<time>`), itself a complete export
  file (written compactly, with the exact stored text of each key inside). The
  next "Export everything as JSON" carries these under `importBackups`.
- **Undo:** while a backup exists, the Import card has "Undo last import". It
  puts back the newest backup (after the same two-step confirm) and keeps the
  data it replaces as a new backup first, so an undo can be undone. Only the
  3 newest backups are kept; older ones are deleted after a successful import
  or undo. (To restore from an older export instead, import its file.)
- If saving the imported data fails (for example storage is full), the app
  puts the previous data back and says so, so you never end up with half old
  and half new data. When everything was put back, that attempt's backup is
  removed again, so failed attempts do not fill the storage.
- A file with an unknown settings or max history version, or over 10 MB, is
  refused with "Nothing was changed".
- After an import or undo the in-progress check-in and retest entries are
  cleared and the app goes to Today. Known limit: if the app is open in
  another browser tab, saving Settings there can overwrite the imported
  settings; reload other tabs after an import.
- Import is turned off while previewing another date with `?date=`.

## Install on a phone and use offline

The production build includes a web manifest and a service worker
(`sw.js`, generated at build time by a small plugin in `vite.config.ts`).
Open the deployed site once while online, then add it to the home screen
(iPhone Safari: Share, then Add to Home Screen; Android Chrome: menu, then
Install app). After that first visit the app opens with no signal.

The app shell and its files come from the cache that the installed worker
version precached; page loads never overwrite it, so a patchy connection
can't leave a half-updated app behind. `program.json` is fetched
network-first, so an edited program shows up whenever you are online. A
new deploy is downloaded in the background and applied the next time the
app is opened (with one quick reload), never in the middle of a session.
The worker is only registered in production builds (`npm run build` then
`npm run preview`), not by `npm run dev`. The E2E suite blocks service
workers except in `e2e/offline.spec.ts`, which tests them.

## Deployment (GitHub Pages)

`.github/workflows/pages.yml` ("CI and Pages deploy") runs `npm ci`, the unit
tests and the build on every pull request to `main` and on every push to
`main`. Only pushes to `main` (and manual runs on `main`) go on to deploy
`dist/` to https://eatea.github.io/workout-app-2026/.

A separate `e2e` job runs in parallel with `build` on the same triggers. It
installs the pinned Playwright's Chromium (cached by Playwright version) and
runs `npm run test:e2e -- --trace retain-on-failure` with no retries. The
`deploy` job needs both `build` and `e2e`, so a failing E2E run blocks
publishing. When `e2e` fails, open the run's summary page, download the
`playwright-report` artifact (kept 7 days) and unzip it. It contains two
folders, `playwright-report/` and `test-results/`. Run
`npx playwright show-report <unzipped folder>/playwright-report` to see the
HTML report; the traces of failed tests open from that report.

One-time repository setup: **Settings -> Pages -> Source: GitHub Actions**.

## More

- [PLAN.md](PLAN.md): the implementation plan and current progress.
- [docs/mockups](docs/mockups): visual design reference (`mockups.html` and PNGs).
