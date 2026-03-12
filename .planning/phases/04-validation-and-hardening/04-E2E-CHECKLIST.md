# Phase 04 E2E Validation Checklist

**Status:** PENDING — Awaiting human execution of hierarchy run (see protocol below)

**Baseline:** `npm test` — 554 pass, 0 fail (confirmed pre-run)

---

## Protocol: How to Run the E2E Validation

### Pre-flight

1. Confirm `npm test` passes (baseline green)
2. Note current `hierarchy.enabled` value in `.planning/config.json` — currently **absent** (no hierarchy key), which means `false` by default
3. Add `"hierarchy": { "enabled": true }` to `.planning/config.json`

### Hierarchy Run

4. Run `/gsd:execute-phase 04-e2e-fixture` in a new Claude Code session
5. Observe partitioner output: must split 2 plans into 2 streams (04e-01 and 04e-02)
6. Observe L2 spawn: both L2s launched with `run_in_background`
7. Observe L3 spawn: each L2 calls `Agent()` to spawn an L3 executor (VALID-01)
8. Wait for completion of both L2s

### Post-run Verification

9. Run `git worktree list` — must show only main worktree (VALID-03)
10. Check `.planning/worktree-registry.json` — must show `{ "worktrees": [] }` or be absent (VALID-03)
11. Check `.planning/phases/04-e2e-fixture/04e-01-SUMMARY.md` exists (VALID-02 structural)
12. Check `.planning/phases/04-e2e-fixture/04e-02-SUMMARY.md` exists (VALID-02 structural)
13. Check `.planning/phases/04-e2e-fixture/scratch-a.txt` contains "Plan A complete"
14. Check `.planning/phases/04-e2e-fixture/scratch-b.txt` contains "Plan B complete"

### Flat-mode Comparison (VALID-02)

15. Set `hierarchy.enabled: false` in `.planning/config.json` (or remove the key)
16. Re-run `/gsd:execute-phase 04-e2e-fixture` in flat mode
17. Verify same structural output: same SUMMARY sections (Performance, Accomplishments, Task Commits, Files Created/Modified, Deviations, Self-Check), same files created, same tasks completed

### Cleanup

18. Restore `.planning/config.json` to original state (remove the hierarchy key or set `enabled: false`)
19. Delete scratch files and SUMMARY files from `04-e2e-fixture/` to leave fixture clean for re-runs:
    - `.planning/phases/04-e2e-fixture/scratch-a.txt`
    - `.planning/phases/04-e2e-fixture/scratch-b.txt`
    - `.planning/phases/04-e2e-fixture/04e-01-SUMMARY.md`
    - `.planning/phases/04-e2e-fixture/04e-02-SUMMARY.md`

---

## Results Table

| Check | Step | Requirement | Result | Notes |
|-------|------|-------------|--------|-------|
| Baseline npm test passes | Pre-flight | — | PASS | 554 pass, 0 fail |
| Partitioner splits 2 plans into 2 streams | 5 | VALID-01, VALID-02 | PENDING | |
| Both L2s launched with run_in_background | 6 | VALID-01 | PENDING | |
| Each L2 spawns L3 via Agent() | 7 | VALID-01 | PENDING | L2->L3 chain confirmed working |
| Both L2/L3 pairs complete successfully | 8 | VALID-02 | PENDING | |
| git worktree list shows main worktree only | 9 | VALID-03 | PENDING | |
| worktree-registry.json is empty or absent | 10 | VALID-03 | PENDING | |
| 04e-01-SUMMARY.md exists after hierarchy run | 11 | VALID-02 | PENDING | |
| 04e-02-SUMMARY.md exists after hierarchy run | 12 | VALID-02 | PENDING | |
| scratch-a.txt contains "Plan A complete" | 13 | VALID-02 | PENDING | |
| scratch-b.txt contains "Plan B complete" | 14 | VALID-02 | PENDING | |
| Flat-mode run produces same SUMMARY structure | 15-17 | VALID-02 | PENDING | Check section headers, task status, files |
| Config restored to hierarchy.enabled: false | 18 | — | PENDING | |
| Fixture artifacts cleaned up | 19 | — | PENDING | |

---

## Requirement Summary

| Requirement | Description | Checks | Overall |
|-------------|-------------|--------|---------|
| VALID-01 | L2 standalone subagent successfully spawns L3 via Agent() | 6, 7 | PENDING |
| VALID-02 | Hierarchy run produces structurally equivalent output to flat run | 5, 8, 11, 12, 13, 14, 15-17 | PENDING |
| VALID-03 | No orphaned worktrees after completion; registry empty | 9, 10 | PENDING |

---

## Notes

- `hierarchy.enabled` key is currently absent from `.planning/config.json` (defaults to false) — no change needed to restore after test
- `git worktree list` currently shows: `/Users/talas9/Projects/get-shit-done  87d5de2 [main]` (main only — clean start)
- `.planning/worktree-registry.json` does not exist (clean start)
- Both fixture plans exist: `04e-01-PLAN.md` and `04e-02-PLAN.md` with non-overlapping `files_modified`
