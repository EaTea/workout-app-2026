# AI Guardrails

These are standing instructions for Claude when working in this repository (and
any project this file is copied into). They apply to every task, regardless of
size, unless the user explicitly overrides a specific rule for a specific task.

## 1. Plan before you code

Before writing or editing any code in response to a user request:

1. Draft a plan in plain language — no code, no diffs. The plan should cover:
   - What you understand the request to be.
   - The approach you intend to take, and any alternatives you considered.
   - The files/areas of the codebase you expect to touch.
   - Open questions or assumptions you're making.
2. Present the plan to the user and iterate on it with them until they confirm
   it. Do not start implementation until the user has agreed to the plan.
3. Keep the plan proportional to the task. A one-line typo fix doesn't need a
   multi-section design doc — but it still gets a one- or two-line plan
   ("I'll fix the off-by-one on line 42 and add a regression test") confirmed
   before the edit.

## 2. The plan lives in the repo

- Maintain the current plan in `PLAN.md` at the repository root.
- Commit `PLAN.md` on its own, as a dedicated commit in a dedicated PR,
  *before* any implementation work begins. Don't bundle the plan into the
  first implementation commit — the design should be reviewable (and
  revisable) independently of the code that implements it.
- Once the design PR is merged (or otherwise agreed with the user),
  implementation proceeds against it.
- `PLAN.md` should break the work into discrete steps and call out the
  points at which it makes sense to open and merge a PR — i.e., stopping
  points where the code is in a coherent, working, reviewable state. This is
  what lets a large task land as several small, incremental PRs instead of
  one large PR at the end. See "Ship work in small, reviewable commits"
  below for how this plays out inside each PR.
- Each milestone in `PLAN.md` is usually one of three kinds, and naming
  which kind a milestone is helps size the PR and tells reviewers what risk
  profile to expect:
  1. **Behavior change** — an incremental improvement to what the system
     does (a feature, a fix, a user- or API-visible change).
  2. **External non-functional change** — work driven by something outside
     the codebase that isn't new behavior but has to be addressed anyway
     (a dependency bump for a security patch, adapting to an upstream
     API/contract change, meeting a new compliance requirement).
  3. **Internal refactor** — restructuring how the code is built or
     organized (module boundaries, build tooling, dead code removal)
     without changing observable behavior.
  Don't mix kinds within one milestone/PR where avoidable — a refactor
  bundled with a behavior change is harder to review and harder to revert
  than either would be alone.
- "Committed on its own" above refers to *authoring* the plan: the initial
  design must be reviewable before any code exists. It doesn't mean
  `PLAN.md` can never be touched again outside a dedicated PR. Once
  implementation is under way, `PLAN.md` bookkeeping — ticking off a step,
  noting a follow-up you discovered mid-implementation — belongs in the
  same commit as the implementation work that made it true, not split out
  into a separate PLAN.md-only commit. The rule that stays constant is
  *don't bundle the plan's first draft with code*; day-to-day updates to an
  already-merged plan are expected to travel with the commits that act on
  it.
- After every commit (the design commit included), update `PLAN.md` to
  reflect reality:
  - Mark completed steps as done.
  - Add newly discovered steps or follow-ups.
  - Remove or revise steps that turned out to be wrong.
  - Adjust the planned merge points if the shape of the work changes.
- `PLAN.md` is a living document, not an archive — keep it about the current
  and upcoming work. Use git history if you need to look back at old plans.

## 3. Ship work in small, reviewable commits

- Don't do an entire task as one large commit. Break implementation into a
  sequence of small, logically scoped commits — e.g., one commit to add a
  data model, another for validation logic, another to wire up an endpoint,
  another for tests — rather than landing the whole diff in a single commit.
- When a task starts a new project, service, or component from scratch, make
  the *first* implementation commit a minimal, working skeleton — project
  scaffolding, build/dependency configuration, and a trivial entry point
  that builds and runs (even if it doesn't do anything useful yet) —
  instead of diving straight into full feature logic. Verify the skeleton
  actually builds and runs before moving on. Every commit after that adds
  real behavior on top of something that already works, rather than the
  project only becoming buildable once the whole feature lands.
- Each commit should be coherent on its own: it should have a clear reason
  to exist (see "Commit messages explain why" below) and, where practical,
  should leave the code in a working state rather than a half-finished one.
- This applies within a single PR, not just across PRs — prefer several
  small commits over one large commit even when everything will be reviewed
  and merged together at once.
- Use the merge points identified in `PLAN.md` to decide when a PR is done
  and should be opened/merged versus when to keep adding commits to it.
  Don't let a single PR grow to cover multiple independent milestones if
  `PLAN.md` already identifies an earlier, sensible place to stop.

## 4. Tests are part of the commit, not an afterthought

- Every commit that changes behavior must include unit tests covering that
  behavior (new tests for new behavior, updated tests for changed behavior).
- Before proposing or making a commit, run the full relevant test suite
  locally and confirm it passes. Never propose a commit with failing or
  skipped tests without calling that out explicitly to the user first.
- Maintain at least one end-to-end (E2E) test suite for the project that
  exercises real user-facing flows through the actual interfaces (CLI, API,
  UI, etc.) rather than mocking internals. Add to it when a change affects a
  user-facing flow that isn't already covered.
- If a testing framework doesn't exist yet in the project, set one up as part
  of the first commit that needs it, and note the choice (and why) in the
  commit message.

## 5. Every function is documented

- Every function/method gets a short comment (docstring or equivalent for the
  language) explaining:
  - What it's for (intended usage), not just what it mechanically does.
  - How it connects to the rest of the system — its callers, its role in a
    larger flow, and any non-obvious dependencies or side effects.
- Keep documentation honest and current: if you change what a function does,
  update its doc comment in the same commit.
- Don't pad this with restating the signature in English. If a function is
  truly self-explanatory (e.g. a trivial getter), a one-liner is enough — but
  err on the side of writing it, since the "why/how it connects" framing is
  rarely obvious from the code alone.

## 6. Separate internal types from wire types

- Never reuse the same type/struct/class for both a function's internal
  working representation and the serialized/deserialized form used at
  boundaries (API request/response bodies, DB rows, file formats, message
  payloads, etc.).
- Define explicit wire types (DTOs) for input/output at each boundary, and
  explicit internal types for logic within the function or module.
- Always write explicit transformation/mapping functions between the two
  (e.g. `fromWire`/`toWire`, `parse`/`serialize`, `Decode`/`Encode`). Never let
  a wire-format struct leak into internal logic, and never serialize an
  internal type directly.
- This applies at every boundary: HTTP handlers, DB access layers, message
  queue consumers/producers, config file loaders, etc.

## 7. Commit messages explain why

- Every commit message must explain *why* the commit exists — the motivation
  or problem being solved — not just a restatement of the diff.
- A commit message should let a future reader understand the reasoning
  without having to read the code first. "What changed" belongs in the diff;
  the message is for context the diff can't carry.
- Structure: a short summary line, then a body explaining the reasoning
  (referencing the plan in `PLAN.md` where relevant).
- This applies to every commit in a multi-commit PR, not just the final one
  — each small commit (see "Ship work in small, reviewable commits" above)
  needs its own why, not just a restatement of its slice of the diff.

## 8. Prioritize readability

- Code is read far more often than it's written — optimize for the next
  person (or Claude) who has to understand it, not for brevity or cleverness.
- Use descriptive names for variables, functions, types, and files. Avoid
  abbreviations, single-letter names (outside trivial loop counters), and
  names that only make sense with context the reader doesn't have.
- Use whitespace deliberately: blank lines to separate logical steps within a
  function, consistent indentation, and grouping of related lines. Don't cram
  unrelated logic onto adjacent lines to save space.
- Add comments generously wherever they clarify intent — not only where
  required by the function-documentation rule above. Explain non-obvious
  ordering requirements, tricky conditionals, edge cases, and why a
  particular approach was chosen over a simpler one.
- For complex control flow, data structures, state machines, or multi-part
  interactions (e.g., several services/threads/processes communicating),
  include a simple ASCII diagram — in a code comment or in the relevant
  doc/README — whenever it would help a reader build a mental model faster
  than prose alone. Keep diagrams small and update them if the structure
  changes.
- Readability takes priority over micro-optimizations and terse "clever"
  code, unless there's a measured performance requirement that demands
  otherwise — and if so, comment why the less-readable form was necessary.

## 9. Document how to run and build the project

- Maintain a `README.md` (or equivalent) at the repository root that
  documents, at minimum: how to install dependencies, how to build the
  project, how to run it, and how to run its tests.
- The skeleton commit described in "Ship work in small, reviewable commits"
  above should introduce this README alongside the initial scaffolding —
  don't leave run/build documentation for later, since the whole point of a
  working skeleton is that someone else can build and run it immediately.
- Keep the instructions accurate and runnable: if a command in the README
  stops working, that's a bug — fix the README (or the underlying tooling)
  in the same commit that caused the drift, not as a follow-up.
- This applies to every project this file is copied into, regardless of
  language or ecosystem. The specific commands will differ, but the
  presence of working, up-to-date instructions must not.

## Commit checklist

Before proposing any commit, confirm all of the following:

- [ ] The plan was drafted and confirmed with the user before implementation.
- [ ] `PLAN.md` was committed as its own commit in its own PR, ahead of the
      implementation, and identifies sensible points to open/merge PRs.
- [ ] `PLAN.md` is updated to reflect this commit and is included in it.
- [ ] This commit is one small, logically scoped step, not the entire task
      bundled together — check whether it should be split further.
- [ ] If this is the first commit of a new project/service/component, it's a
      minimal skeleton that actually builds and runs.
- [ ] New/changed behavior has unit tests, and they pass.
- [ ] At least one E2E test suite exists and still passes (add to it if this
      change touches a user-facing flow).
- [ ] Every new/changed function has an intent-and-connection comment.
- [ ] Internal types and wire types are separate, with explicit
      transformation functions between them.
- [ ] The commit message explains why, not just what.
- [ ] Code favors readability: descriptive names, deliberate whitespace,
      generous comments, and ASCII diagrams where they'd help a reader.
- [ ] `README.md` has accurate, current install/build/run/test instructions.
