# Tabbakheen API Worker — project checkpoint

## START HERE — NEXT SESSION

1. Verify `git remote -v`, `git branch --show-current`, `git rev-parse HEAD`, `git status --short`, and the current GitHub branch/PR state. Read `AGENTS.md` before edits. This checkpoint was reconciled on **2026-10-30**; production facts may have changed.
2. Keep the existing dirty V2, Cron, and participant-safety worktrees intact. Do not assume this checkout is the latest implementation: the former review branch is one commit behind its GitHub head, while a separate Draft PR #14 holds later work.
3. **Exact next task:** perform a focused, authorized read-only reconciliation of the *current* deployed `tabbakheen-api` Worker version, effective safety flags, and active `(default)` Firestore Rules with this state file. Do not change production during that task.

## Identity, architecture, and source

- GitHub: `deadevil2002/tabbakheen-api-worker`; paired Mobile source: `deadevil2002/Source-Restore` (separate repository). This repository is the Cloudflare Worker backend and embedded Admin UI for Tabbakheen, not the landing website.
- `worker.js` handles HTTP APIs, Firebase Auth verification, privileged Firestore REST operations, Admin, notifications/outbox, delivery matching, order tracking, and scheduled maintenance. `wrangler.toml` names Worker `tabbakheen-api`, account `0e6461dc8ec69690ffda6c96d8cb0ac4`, `keep_vars = true`, and a once-per-minute Cron. Runtime is Cloudflare Workers JavaScript; offline checks use Node.js and focused tests, with a Firestore emulator for Rules/transaction tests when available.
- Firebase project documented for this app: `tabbakheen-99883`. `FINAL_FIRESTORE_RULES_READY_FOR_MANUAL_DEPLOY.txt` is the candidate Rules source in Git; its presence alone does not prove the live Rules version.
- Important paths: `worker.js`, `wrangler.toml`, `FINAL_FIRESTORE_RULES_READY_FOR_MANUAL_DEPLOY.txt`, `FINAL_RULES_EMULATOR_AND_CUTOVER.md`, `ORDER_TRACKING_BACKEND_HANDOFF.md`, `final-firestore-rules.emulator.test.mjs`, `order-creation-transaction.emulator.cjs`, `delivery-notification-batch.test.js`. Draft PR #14 adds `PARTICIPANT_SAFETY_HANDOFF.md` and other candidate work.

## Git checkpoint and development phase

- GitHub default branch `main`: **`3681e9624285f7c0df6f5dfe626eddf6d5995871`** when checked on 2026-10-30. GitHub PR #13 was **MERGED** on 2026-10-14; its remote head was `ab0cbf735ca7541b15cf3e0167e30731b16dd8f6`.
- The user's starting checkout was `review/delivery-v2-uncapped-admin-20261010` at **`c0c0ff75566946804ca9c41ed2a2fbea6454bcb0`**, clean. Its GitHub branch head was **`ab0cbf735ca7541b15cf3e0167e30731b16dd8f6`**: one later source fix, so do not push from the older checkout without reconciling. The documentation-only checkout was created from current `origin/main` without changing the starting checkout.
- GitHub Draft PR #14 is **OPEN/Draft**, head `3960a5c94619fe0c240f95c63d83fbffb9779e19` on `feat/tabbakheen-participant-safety-20261014` as checked on 2026-10-30. Its participant-safety, cash-funding, complaint, owner-auth, and Admin work is distinct from merged `main`; inspect the exact branch before using any of it. The paired Mobile PR/source state is **UNKNOWN** in this checkpoint.
- Current phase: merged Worker V2 foundation on `main`, later participant-safety/Admin candidate in Draft PR #14, with production release state requiring a fresh read-only reconciliation. Do not infer that GitHub `main`, Draft PR #14, this review checkout, and deployed production are identical.

## Completed work and verified evidence

- Git history verifies PR #13 merged to `main` and the later `ab0cbf7` deletion-fence fix. Source on `main` contains `/orders/create-v2`, order-tracking code, scheduled maintenance, Final Rules candidate, and focused tests. This checkpoint did not re-run application tests or verify runtime behavior.
- Historical local project record in a separate protected integration worktree reports **107/107** Final Rules emulator assertions passed against candidate SHA-256 `d5a306db0f959d40607aecbc2d95bca60416f455000121ce8e3e44ab002e49ac`; this is reused prior evidence, **not** a test executed for this documentation task. Recheck the file hash and harness before a future publication.
- The same historical record reports a 2026-10-17 read-only production check: Final Rules active at that date with the above SHA, Worker version `84abca61-fd3f-46ae-8136-fa91d1fa8a55` at 100%, Admin `owner_only`, mandatory update effective ON at minimum 1.0.7/build `0`, Cash Funding OFF; post-cutover Cron/errors and device behavior were unverified then. **All of these are historical snapshots, not verified current production state.**
- Owner decisions recorded in the project history: only the owner approves production deployment, Rules publication, feature activation, and authentication-mode changes; the external human developer handles native store builds/submissions; 1.0.6 and 1.0.7 were the supported release scope for the later cutover. Verify current release policy before relying on historical decisions. Never expose credentials or customer data.

## Test and deployment status

| Scope | Status | Evidence / limit |
| --- | --- | --- |
| Documentation integrity | PASS | Both root files reviewed for consistency, `git diff --check`; GitHub presence must be confirmed after safe sync. |
| Application tests for this task | NOT TESTED | Documentation-only change; no source files changed. |
| Historical Final Rules emulator | PASS (prior report) | 107/107 on the previously recorded exact candidate; not re-run here. |
| Current Draft PR #14 tests and current device QA | UNKNOWN | No current execution evidence collected in this task. |
| Current production Worker, flags, Cron, queues, and live Rules | UNKNOWN | Last recorded production evidence is dated 2026-10-17; no production access in this task. |

No application code, Firebase project, Worker deployment, Rules, Mobile app, or production setting was changed by this continuity task. A GitHub documentation commit is source control only; it is not evidence of deployment.

## Blockers, constraints, and next action

1. **Priority 1 — current production identity unknown:** verify deployed Worker version/configuration and active Rules read-only before a release or recovery decision. Do not present historical version IDs as current.
2. **Priority 2 — branch/worktree divergence:** the starting review checkout is behind its remote; Draft PR #14 and dirty protected worktrees contain separate work. Preserve them and reconcile changes deliberately.
3. **Priority 3 — runtime evidence:** current Cron/error metrics, supported-client real-device behavior, and any production effect of newer PR #14 code are not established in this checkpoint.

Pending decisions: none required for this documentation task. Future deployments, Rules changes, feature activation, and native releases require their own explicit owner authorization; no standing approval is inferred. Preserve owner-only Admin protections and fail-closed feature gates when planning changes.

**NEXT SINGLE ACTION:** authorized read-only reconciliation of the current production Worker version/effective safety flags and active Final Rules source, then update this file with the evidence. No production mutation.
