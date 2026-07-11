# Codex Execution Prompt — Mission Control Mobile Milestone 1

You are the implementation controller for Mission Control's approved Capacitor + responsive React mobile milestone.

## Objective

Execute the complete Milestone 1 implementation plan and leave the branch in a tested, reviewable state with a debug Android APK when the local Android toolchain permits it.

## Authoritative inputs

Read these files in full before editing code:

1. `docs/superpowers/specs/2026-07-11-capacitor-responsive-mobile-design.md`
2. `docs/superpowers/plans/2026-07-11-mission-control-mobile-milestone-1.md`
3. `docs/superpowers/plans/2026-07-11-mission-control-mobile-milestone-1-self-review.md`
4. Any repository-level or directory-level `AGENTS.md` files that apply.

The self-review corrections override the corresponding text in the implementation plan.

## Required workflow

1. Confirm the current workspace is an isolated Git worktree on branch `mobile/capacitor-responsive-design`. Never implement on `main`.
2. Confirm the worktree is clean before starting.
3. Run project setup and baseline verification:
   - `npm install`
   - `npm test`
   - `npm run build`
4. If baseline tests or build fail before your changes, stop and report the exact commands and failures. Do not bury an existing failure under new work.
5. Create `.superpowers/sdd/progress.md` and use it as a durable task ledger. Resume from the first incomplete task if the ledger already exists.
6. Execute Tasks 1 through 13 in the plan in order. Do not skip tests, validation commands, Android sync/build steps, or commits.
7. Use fresh subagents for implementation and review when subagent support is available. For every task:
   - Record the starting commit.
   - Give one implementer only that task's requirements, relevant interfaces, and global constraints.
   - Require the implementer to run the task's tests and commit the work.
   - Review the full task diff for specification compliance and code quality.
   - Fix all Critical and Important review findings, rerun covering tests, and re-review.
   - Mark the task complete in `.superpowers/sdd/progress.md` only after review passes.
8. When subagents are unavailable, follow the same implement-test-review-fix cycle yourself. Do not weaken the review gates.
9. Keep independent reads concurrent where the existing application uses `Promise.all` or `Promise.allSettled`. Do not create data-fetch waterfalls.
10. Do not add unrelated refactors, dependencies, visual redesigns, public port forwarding, Cloudflare work, or Milestone 2 screen rewrites.
11. Preserve desktop behavior as a regression requirement.
12. Commit after every completed task using the commit message specified in the plan. Push only `mobile/capacitor-responsive-design`; never push or merge `main`.
13. Continue through all tasks without asking whether to proceed. Stop only for:
    - a failing pre-existing baseline,
    - a missing credential or physical-device action that genuinely blocks further work,
    - a required system installation that needs human approval,
    - repeated verification failure after a reasoned fix attempt,
    - a real contradiction between the approved spec and plan.

## Android and Pixel 9 requirements

- Use the existing Capacitor Android project.
- Build the frontend before every final `npx cap sync android`.
- Produce the debug APK with the Gradle wrapper when the Android SDK/JDK are available.
- When a Pixel 9 is connected through ADB, install the debug APK and perform the physical checks listed in the plan.
- When no device is connected, still build the APK and provide the exact `adb install -r` command and APK path.
- Do not claim physical-device behavior was verified unless ADB and the device actually confirmed it.

## Networking requirements

- Default Express binding is `127.0.0.1`.
- Tailscale Serve HTTPS is the primary home-and-away path.
- `0.0.0.0` and cleartext HTTP are permitted only for the documented trusted-LAN fallback.
- Do not configure Tailscale Funnel, router port forwarding, or a publicly reachable Express endpoint.
- Never commit a real tailnet name, token, Google credential, API key, or personal secret.

## Final verification

After all tasks:

1. Run the complete frontend/server test suite.
2. Run the production Vite build.
3. Run Capacitor sync.
4. Run the Android debug build.
5. Run the plan's literal-search checks to confirm no raw relative frontend API fetch, EventSource, OAuth, or download URL remains.
6. Inspect `git status`, `git log --oneline main..HEAD`, and `git diff --check main...HEAD`.
7. Conduct a broad whole-branch review against the approved design specification and every acceptance criterion.
8. Fix Critical and Important findings in one final fix pass and rerun affected tests.
9. Push branch `mobile/capacitor-responsive-design` to origin.

## Final report

Report only evidence you actually verified:

- Completed tasks and commit range.
- Tests and build commands with pass/fail results.
- APK path and file size when built.
- Whether ADB detected and installed on the Pixel 9.
- Tailscale Serve and LAN configuration commands added to the runbook.
- Remaining blockers or unverified physical-device checks.
- Final branch and push status.

Do not merge the branch. Leave it ready for review.