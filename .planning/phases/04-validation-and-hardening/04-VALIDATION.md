---
phase: 04
slug: validation-and-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test`) |
| **Config file** | None — invoked via `npm test` → `node scripts/run-tests.cjs` |
| **Quick run command** | `npm test 2>&1 \| grep -E "hierarchy\|FAIL\|pass\|fail"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test 2>&1 | grep -E "FAIL|hierarchy"`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | VALID-01, VALID-04 | unit | `npm test 2>&1 \| grep hierarchy` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | VALID-01, VALID-02, VALID-03 | manual/E2E | Checklist-based verification | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/hierarchy.test.cjs` — add return-value shape assertions for `cmdWorktreeCreate`, `cmdWorktreeRemove`, `cmdStateReconcile`

*Existing test suite covers flat-mode regression (VALID-04) via 554+ tests.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| L2 spawns L3 via Agent() tool | VALID-01 | Requires live Claude Code session | Run hierarchy-enabled execution on fixture phase |
| Full L1→L2→L3 flow with worktrees | VALID-02 | Requires live multi-agent execution | Run `/gsd:execute-phase` with hierarchy on fixture |
| No orphaned worktrees after run | VALID-03 | Requires checking `git worktree list` post-execution | Verify after hierarchy run completes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
