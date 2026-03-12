---
phase: 02
slug: agent-definitions
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test`) |
| **Config file** | None — invoked via `npm test` → `node scripts/run-tests.cjs` |
| **Quick run command** | `npm test 2>&1 \| grep -E "agent-frontmatter\|FAIL\|pass\|fail"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test 2>&1 | grep -E "agent-frontmatter|FAIL|pass|fail"`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-05 | unit | `npm test 2>&1 \| grep agent-frontmatter` | ✅ existing auto-scan | ⬜ pending |
| 02-01-02 | 01 | 1 | PART-01, PART-02, PART-03, PART-04 | unit | `npm test 2>&1 \| grep agent-frontmatter` | ✅ existing auto-scan | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/agent-frontmatter.test.cjs` — add assertion that `gsd-sub-orchestrator` has `mcpServers: []` in frontmatter (AGNT-02)

*Existing agent-frontmatter.test.cjs auto-scans all `agents/gsd-*.md` files for required fields. New files will be picked up automatically.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| L2 spawns L3 via Agent() tool | AGNT-05 | Requires live Claude session with hierarchy enabled | Verify during Phase 4 validation |
| Partitioner returns valid JSON from hierarchy-partition CLI | PART-03 | Partitioner is an agent prompt, not code — behavior tested at integration level | Verify during Phase 4 E2E test |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
