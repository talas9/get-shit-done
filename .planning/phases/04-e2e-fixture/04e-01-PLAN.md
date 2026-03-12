---
phase: 04-e2e-fixture
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/phases/04-e2e-fixture/scratch-a.txt
autonomous: true
must_haves:
  truths:
    - "scratch-a.txt exists and contains 'Plan A complete'"
  artifacts:
    - path: ".planning/phases/04-e2e-fixture/scratch-a.txt"
      provides: "Fixture A output"
      contains: "Plan A complete"
---

<objective>
E2E fixture plan A — writes a marker string to scratch-a.txt to prove execution completed.
This plan is part of the 04-e2e-fixture test fixture used by Phase 4 Plan 02 to validate
the hierarchy dispatch path end-to-end. It is sandboxed: it touches only
.planning/phases/04-e2e-fixture/scratch-a.txt and has no effect on the real project.
</objective>

<execution_context>
@/Users/talas9/.claude/get-shit-done/workflows/execute-plan.md
@/Users/talas9/.claude/get-shit-done/templates/summary.md
</execution_context>

<tasks>

<task type="auto">
  <name>Task 1: Write Plan A marker to scratch-a.txt</name>
  <files>.planning/phases/04-e2e-fixture/scratch-a.txt</files>
  <action>
    Write the string "Plan A complete" to the file
    `.planning/phases/04-e2e-fixture/scratch-a.txt`.
    Create the file if it does not exist. This is the only file this plan modifies.
  </action>
  <verify>
    <automated>node -e "const fs=require('fs'); const c=fs.readFileSync('.planning/phases/04-e2e-fixture/scratch-a.txt','utf8'); console.log('OK:', c.includes('Plan A complete'));"</automated>
  </verify>
  <done>scratch-a.txt exists and contains the string "Plan A complete".</done>
</task>

</tasks>

<verification>
- `.planning/phases/04-e2e-fixture/scratch-a.txt` exists
- File contains "Plan A complete"
- No files outside `.planning/phases/04-e2e-fixture/` were modified
</verification>

<success_criteria>
- scratch-a.txt created with "Plan A complete" content
- SUMMARY.md produced in .planning/phases/04-e2e-fixture/
</success_criteria>

<output>
After completion, create `.planning/phases/04-e2e-fixture/04e-01-SUMMARY.md`
</output>
