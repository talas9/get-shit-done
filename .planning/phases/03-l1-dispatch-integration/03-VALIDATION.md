---
phase: 03
slug: l1-dispatch-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test`) |
| **Config file** | None — invoked via `npm test` → `node scripts/run-tests.cjs` |
| **Quick run command** | `npm test 2>&1 \| grep -E "init\|hierarchy\|FAIL\|pass\|fail"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test 2>&1 | grep -E "FAIL|init"`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | DISP-01 | unit | `npm test 2>&1 \| grep init` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | DISP-01,02,03,04,05,06 | inspection | `grep -E "hierarchy_enabled\|run_in_background\|worktree-create\|state-reconcile\|worktree-remove\|fallback" workflows/execute-phase.md` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/init.test.cjs` — add tests for `hierarchy_enabled` and `hierarchy_max_l2_agents` in `init execute-phase` output (DISP-01)

*Workflow Markdown verification is by inspection after write — no test infrastructure needed beyond existing suite.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Hierarchy dispatch activates with both flags true | DISP-01 | Requires live Claude session with hierarchy config | Phase 4 E2E test |
| L2 spawns and completes in worktree | DISP-02, DISP-03 | Requires live multi-agent execution | Phase 4 E2E test |
| Fallback triggers on hierarchy failure | DISP-06 | Requires simulating a failure in live session | Phase 4 validation |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
