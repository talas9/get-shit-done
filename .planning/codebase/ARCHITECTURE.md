# Architecture

**Analysis Date:** 2026-03-11

## Pattern Overview

**Overall:** Multi-tier orchestrated agent system with specialized CLI command dispatch, decentralized state management, and frontmatter-driven planning documents.

**Key Characteristics:**
- **Command-driven entry points** - 32 user-facing CLI commands in `/commands/gsd/` dispatch to specialized agents
- **Stateful workflow engine** - Phases, milestones, and plans tracked in `.planning/` directory with STATE.md, ROADMAP.md, REQUIREMENTS.md
- **Agent specialization** - 12 agent personas (gsd-executor, gsd-planner, gsd-debugger, etc.) with role-specific prompts in `/agents/`
- **Tool-centralized utilities** - `gsd-tools.cjs` (23KB) provides 100+ atomic commands replacing scattered bash patterns
- **Frontmatter metadata** - YAML frontmatter in .md files (PLAN.md, SUMMARY.md, VERIFICATION.md) drives execution logic and validation

## Layers

**CLI Command Layer:**
- Location: `commands/gsd/` (32 .md files)
- Purpose: User-facing command definitions - each maps to one agent spawn
- Contains: Command metadata (agent name, description, allowed-tools), execution context, argument parsing
- Depends on: Agents (by agent field), workflows (by @-references), state files
- Used by: Installation system (`bin/install.js`), user invocations

**Orchestration Layer:**
- Location: `get-shit-done/workflows/` (34 .md files)
- Purpose: Multi-step workflows that coordinate agents, manage checkpoints, handle branching logic
- Contains: Step-by-step procedures, JSON parsing, git operations, phase/milestone management
- Depends on: gsd-tools.cjs for atomic operations, agent prompts for spawning subagents
- Used by: Commands (via @-references), other workflows

**Agent Layer:**
- Location: `agents/` (12 .md files)
- Purpose: Specialized agent personas with role-specific execution rules
- Contains: Role definition, execution flow steps, task patterns, deviation rules, checkpoint handling
- Examples: `gsd-executor.md` (executes plans), `gsd-planner.md` (creates plans), `gsd-debugger.md` (fixes issues)
- Depends on: Project context (CLAUDE.md), state files, tool availability
- Used by: Commands and workflows (via agent field or spawn directives)

**Tools & Utilities Layer:**
- Location: `get-shit-done/bin/lib/` (11 .cjs modules)
- Purpose: Centralized library replacing repetitive bash patterns across 50+ command/workflow/agent files
- Contains: Config loading, phase lookup, git operations, frontmatter parsing, state management, validation
- Depends on: Node.js 16.7+, filesystem, git
- Used by: All workflows, all commands that call `gsd-tools.cjs`

**State Management Layer:**
- Location: `.planning/` (project-local)
- Purpose: Persistent record of project progress, requirements, phases, and execution state
- Contains: STATE.md (frontmatter + sections), ROADMAP.md (phases + requirements), config.json, phase directories with PLAN.md/SUMMARY.md
- Depends on: Frontmatter parsing, git for history
- Used by: Tools, agents, workflows for context and decision-making

**Reference Material Layer:**
- Location: `get-shit-done/references/` (task patterns, UI guidelines, etc.)
- Purpose: Shared domain knowledge (not project-specific)
- Contains: Markdown guides, templates, common patterns
- Used by: Agent prompts via @-references

**Template Layer:**
- Location: `get-shit-done/templates/` (28 .md files)
- Purpose: Scaffold new projects or fill structures for common artifacts
- Contains: PLAN.md templates (standard, minimal, complex variants), SUMMARY.md variants, project/research templates
- Used by: Scaffolding commands, project initialization

## Data Flow

**Phase Execution Flow:**

1. User invokes `/gsd:execute-phase <phase-number>`
2. `commands/gsd/execute-phase.md` loads execution context via `gsd-tools.cjs init execute-phase`
3. Orchestrator discovers plans in phase directory, groups by wave, analyzes dependencies
4. For each wave: spawn `gsd-executor` agents (parallel or sequential based on config)
5. Each executor loads PLAN.md, executes tasks, commits per-task, produces SUMMARY.md
6. Orchestrator collects summaries, updates STATE.md, verifies completeness
7. If verification fails or checkpoints triggered, halt and report

**Planning Flow:**

1. User invokes `/gsd:plan-phase [phase-number]`
2. `commands/gsd/plan-phase.md` spawns `gsd-phase-researcher` (if research needed)
3. Researcher loads RESEARCH.md, synthesizes findings into CONTEXT.md
4. Spawn `gsd-planner` with CONTEXT.md
5. Planner generates PLAN.md with tasks, verification criteria, outputs
6. Spawn `gsd-plan-checker` for validation (structure, references, completeness)
7. If verification fails, iterate; else present PLAN.md for user approval

**State Progression:**

1. STATE.md tracks current phase, plan counter, execution metrics
2. After plan creation: increment plan counter, update STATE.md
3. After plan execution: record start/end time, task count, commit hashes in SUMMARY.md
4. After summary: update ROADMAP.md progress table, advance phase counter
5. Milestone completion: archive phases, create MILESTONES.md, reset for next milestone

**State Management:**

- **Persistent:** All phase/milestone data lives in `.planning/phases/` directory on disk
- **Ephemeral:** Execution checkpoints and chain flags in config.json with auto-cleanup
- **Versioning:** Git tracks all .planning/ changes; commands can inspect git history
- **Concurrency:** Single-process locking via temporary files; workflows serialize wave execution

## Key Abstractions

**Phase Model:**
- Purpose: Represent a logical unit of work (e.g., "1.1 Core MVP setup")
- Examples: `.planning/phases/1/` (integer), `.planning/phases/1.1/` (decimal), `.planning/phases/2a/` (hybrid)
- Pattern: Each phase dir contains PLAN.md files (1+), SUMMARY.md files (0+), supporting docs
- Stored in: Disk (phase directory) + referenced in ROADMAP.md

**Plan Model:**
- Purpose: Executable specification for a piece of work
- Location: `.planning/phases/<phase>/PLAN-<plan-id>.md`
- Metadata (frontmatter): phase, plan, type (execute/tdd), wave, autonomous flag, depends_on
- Content: Objective, context (@-references), tasks (with type, checkpoint markers), success criteria, outputs
- Execution: Tasks parsed by gsd-executor, committed per-task, summarized in SUMMARY.md

**Task Model:**
- Purpose: Atomic unit of work within a plan
- Syntax: `<step name="..." type="auto|checkpoint:*">`
- Types: auto (autonomous), checkpoint (pause for human input), tdd (test-first)
- Execution: Executor runs step, handles deviations (RULE 1-4 auto-fixes), commits, tracks completion

**Frontmatter Metadata:**
- Purpose: Drive execution logic via structured YAML in .md files
- Examples: PLAN.md phase/plan/type fields, SUMMARY.md frontmatter for structured aggregation
- Validation: Schema validation (plan, summary, verification) via `gsd-tools.cjs frontmatter validate`

**Config Model:**
- Location: `.planning/config.json`
- Manages: model_profile (quality/balanced/budget), commit_docs, branching_strategy, parallelization, search options
- Persistence: Survives project lifetime; persisted via `gsd-tools.cjs config-set`

## Entry Points

**CLI Entry Point:**
- Location: `bin/install.js`
- Triggers: `get-shit-done-cc` command (npm bin)
- Responsibilities: Parse runtime flags (--claude, --opencode, --gemini, --codex), install agent prompts to runtime config dirs (~/.claude/, ~/.opencode/, etc.), set up hooks

**Command Entry Points (User-Facing):**
- Location: `commands/gsd/` (e.g., `plan-phase.md`, `execute-phase.md`)
- Triggers: `/gsd:plan-phase`, `/gsd:execute-phase`, etc.
- Responsibilities: Parse user arguments, validate phase existence, spawn agents, coordinate results

**Workflow Entry Points (Internal Orchestration):**
- Location: `get-shit-done/workflows/` (e.g., `plan-phase.md`, `execute-phase.md`)
- Triggers: Referenced by commands via @-references or spawned by agents
- Responsibilities: Multi-step coordination, checkpoint handling, validation loops, state progression

**Tools Entry Point (Atomic Operations):**
- Location: `get-shit-done/bin/gsd-tools.cjs`
- Triggers: `node gsd-tools.cjs <command> [args]`
- Responsibilities: Provide 100+ atomic CLI operations (state load, config set, phase creation, git operations)

**Agent Entry Points (Specialized Execution):**
- Location: `agents/gsd-*.md` (e.g., gsd-executor.md, gsd-planner.md)
- Triggers: Spawned by commands/workflows via `TaskCreate` or `SendMessage`
- Responsibilities: Execute role-specific work (execute plans, create plans, debug issues, verify results)

## Error Handling

**Strategy:** Three-tier: preventive (validation before spawning), automatic (deviation rules during execution), halting (checkpoints for human review).

**Patterns:**

1. **Pre-execution validation:**
   - Phase existence check in commands before spawning agents
   - Plan structure validation via `gsd-tools.cjs verify plan-structure`
   - Frontmatter schema validation via `gsd-tools.cjs frontmatter validate`

2. **Automatic deviation handling (Rules 1-3):**
   - RULE 1: Auto-fix bugs (broken behavior, errors)
   - RULE 2: Auto-add missing critical functionality (error handling, auth, validation)
   - RULE 3: Auto-fix blocking issues (missing deps, broken imports, DB connection)
   - No user permission needed; track as deviations in SUMMARY.md

3. **Architectural change gates (Rule 4):**
   - Trigger: Fix requires structural modification (new DB table, new service layer)
   - Action: Ask user before proceeding; document in deviation section

4. **Checkpoint protocol:**
   - Tasks with `type="checkpoint:*"` pause execution
   - Executor returns structured message with completion context
   - Fresh agent spawned to continue; uses `<completed_tasks>` block to resume

5. **Health validation:**
   - `gsd-tools.cjs validate health [--repair]` checks .planning/ integrity
   - Detects: missing phases, orphaned plans, frontmatter errors, broken references

## Cross-Cutting Concerns

**Logging:** Console output via `node process.stdout.write()` in tools; each agent logs its work to SUMMARY.md; workflows report progress via markdown formatted output.

**Validation:** Frontmatter schema (plan/summary/verification templates), phase numbering consistency, disk/roadmap sync checks, reference resolution (@-file paths).

**Authentication:**
- Brave Search API (optional): configured via `BRAVE_SEARCH_KEY` env var
- Git: uses system git config
- Runtime-specific auth: handled by agent runtime environment (~/.claude/, ~/.opencode/, etc.)

**Git Workflow:**
- Each task committed atomically (commit message includes task name and link)
- Phase completion triggers `git tag` for milestones
- Branching strategies: none (current), phase (gsd/phase-{N}-{slug}), milestone (gsd/{milestone}-{slug})

**State Persistence:**
- All .planning/ changes committed to git (if `commit_docs: true`)
- Ephemeral state (checkpoints, chain flags) in config.json with auto-cleanup
- Milestone milestones archived via `gsd-tools.cjs milestone complete`

---

*Architecture analysis: 2026-03-11*
