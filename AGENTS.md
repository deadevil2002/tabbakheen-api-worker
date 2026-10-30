# Tabbakheen API Worker instructions

This repository is `deadevil2002/tabbakheen-api-worker`, serving the `tabbakheen-api` Cloudflare Worker for the Tabbakheen application. Confirm the repository root, remote, branch, HEAD, and working-tree status before editing. Preserve unrelated changes and protected worktrees.

## Cross-Session Continuity Protocol

1. Read this `AGENTS.md` and root `PROJECT_STATE.md` before making changes. Verify important claims against current Git, code, tests, and production evidence; the state file is a checkpoint, not a substitute for verification.
2. Check the active branch and remote before work. Do not overwrite newer work with older assumptions, including state recorded in other worktrees. Never repeat completed tasks without evidence that the source changed or the prior result is insufficient.
3. After significant changes and before completing a development session, update only the affected parts of `PROJECT_STATE.md`: latest verified implementation state, actual test PASS/FAIL/NOT TESTED evidence, local versus deployed status, blockers, decisions, and one exact next task. Mark unverified facts `UNKNOWN`.
4. Keep the documentation concise and free of secrets, tokens, customer data, and unsupported claims. Preserve useful history and project-specific decisions; reconcile stale entries instead of appending contradictory reports.
5. Safely stage, commit, and push documentation updates when authorized and when the branch and deployment consequences are known. If GitHub access, branch protection, divergence, or deployment risk prevents synchronization, report the blocker; never force-push, reset, or include unrelated changes to satisfy this protocol.
6. Never deploy, release, publish Rules, activate features, change production systems, or send real notifications without specific owner authorization. Local tests do not establish production health or deployment.

The older `TABBAKHEEN_PROJECT_STATE.md` in a separate V2 integration worktree is historical local context. Do not modify or overwrite that protected worktree as part of routine updates here; reconcile facts into this tracked state file when relevant.
