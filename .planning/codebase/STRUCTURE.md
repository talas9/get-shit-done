# Codebase Structure

**Analysis Date:** 2026-03-11

## Directory Layout

```
get-shit-done/
├── bin/                           # NPM binary entry point
│   └── install.js                 # CLI installer (~88KB) for global/local setup
│
├── commands/gsd/                  # User-facing CLI commands (32 .md files)
│   ├── plan-phase.md              # Create PLAN.md for a phase
│   ├── execute-phase.md           # Run all plans in a phase
│   ├── execute-plan.md            # Run a single plan
│   ├── debug.md                   # Spawn debugger for troubleshooting
│   └── [27 more commands]         # research-phase, new-project, verify-work, etc.
│
├── agents/                        # Specialized agent personas (12 .md files)
│   ├── gsd-executor.md            # Execute PLAN.md files atomically
│   ├── gsd-planner.md             # Create phase plans with research
│   ├── gsd-debugger.md            # Fix broken code/state
│   ├── gsd-project-researcher.md  # Deep codebase research
│   ├── gsd-phase-researcher.md    # Domain/feature research
│   ├── gsd-verifier.md            # Verify plan execution
│   ├── gsd-roadmapper.md          # Create project roadmaps
│   └── [5 more agents]            # plan-checker, integration-checker, etc.
│
├── get-shit-done/                 # Core library and runtime assets
│   ├── bin/                       # Executable utilities
│   │   ├── gsd-tools.cjs          # Central toolkit (23KB, 100+ commands)
│   │   └── lib/                   # 11 CommonJS modules
│   │       ├── core.cjs           # Path helpers, config loading, model profiles
│   │       ├── commands.cjs       # Utility command implementations
│   │       ├── config.cjs         # Configuration management
│   │       ├── frontmatter.cjs    # YAML frontmatter parsing/validation
│   │       ├── phase.cjs          # Phase CRUD and query operations
│   │       ├── state.cjs          # STATE.md operations and progression
│   │       ├── milestone.cjs      # Milestone lifecycle management
│   │       ├── roadmap.cjs        # ROADMAP.md parsing and updates
│   │       ├── init.cjs           # Workflow initialization (compound commands)
│   │       ├── template.cjs       # Template filling and scaffolding
│   │       └── verify.cjs         # Verification, health checks, consistency
│   │
│   ├── workflows/                 # Multi-step orchestration (34 .md files)
│   │   ├── plan-phase.md          # Research → plan → verify loop
│   │   ├── execute-phase.md       # Discover plans → group waves → spawn executors
│   │   ├── execute-plan.md        # Single plan execution with checkpoints
│   │   ├── new-project.md         # Project initialization workflow
│   │   ├── new-milestone.md       # Milestone creation workflow
│   │   └── [29 more workflows]    # discuss-phase, research-phase, complete-milestone, etc.
│   │
│   ├── references/                # Shared domain knowledge (15 .md files)
│   │   ├── tasks.md               # Task pattern reference
│   │   ├── ui-brand.md            # UI/component naming conventions
│   │   └── [13 more guides]       # patterns, checklists, decision frameworks
│   │
│   └── templates/                 # Scaffold artifacts (28 .md files)
│       ├── plan/                  # PLAN.md templates
│       │   ├── standard.md        # Standard plan template (most common)
│       │   ├── minimal.md         # Lightweight plan variant
│       │   └── complex.md         # Multi-wave, checkpoint-heavy variant
│       ├── summary/               # SUMMARY.md templates
│       │   ├── standard.md        # Standard execution summary
│       │   ├── minimal.md         # Quick summary
│       │   └── complex.md         # Detailed multi-task breakdown
│       ├── codebase/              # New codebase project scaffolds
│       ├── research-project/      # Research-only project scaffolds
│       └── [others]               # state, roadmap, requirements, context, UAT, etc.
│
├── hooks/                         # Git/runtime hooks (pre-built in hooks/dist/)
│   ├── pre-commit.hook.js         # Pre-commit validation for planning docs
│   └── src/                       # Source hooks (compiled to dist/)
│
├── scripts/                       # Development scripts
│   ├── build-hooks.js             # Compile hooks source to dist/
│   └── run-tests.cjs              # Test runner harness
│
├── tests/                         # Test suite (10 .cjs files)
│   ├── core.test.cjs              # Core utilities tests
│   ├── phase.test.cjs             # Phase operations tests
│   ├── frontmatter.test.cjs       # Frontmatter parsing tests
│   ├── verify.test.cjs            # Verification logic tests
│   ├── milestone.test.cjs         # Milestone lifecycle tests
│   └── [5 more test files]        # config, state, verify-health, etc.
│
├── docs/                          # User documentation
│   └── [changelog, guides]
│
├── assets/                        # Media and branding assets
│
└── package.json                   # NPM package configuration (Node 16.7+)
```

## Directory Purposes

**bin/**
- Purpose: NPM binary entry point
- Contains: `install.js` (CLI installer for runtimes)
- Key files: `install.js` (88KB) handles global/local setup for Claude, OpenCode, Gemini, Codex

**commands/gsd/**
- Purpose: User-facing command specifications
- Contains: 32 Markdown files defining CLI commands
- Key files: `plan-phase.md`, `execute-phase.md`, `execute-plan.md`, `debug.md`, `new-project.md`
- Pattern: Each file has frontmatter (name, description, agent, allowed-tools) + <objective> + <process>

**agents/**
- Purpose: Specialized Claude agent personas
- Contains: 12 Markdown files with role definitions and execution flows
- Key files: `gsd-executor.md` (execute), `gsd-planner.md` (plan), `gsd-debugger.md` (debug), `gsd-verifier.md` (verify)
- Codex support: Agent sandbox permissions defined in `bin/install.js` (CODEX_AGENT_SANDBOX)

**get-shit-done/bin/lib/**
- Purpose: Centralized library replacing 50+ scattered bash patterns
- Contains: 11 CommonJS modules totaling ~180KB of reusable logic
- Key files:
  - `core.cjs` - Model profiles, path helpers, config loading, phase/milestone lookups
  - `frontmatter.cjs` - YAML extraction, validation schemas, must-have block parsing
  - `state.cjs` - STATE.md read/write, field extraction, progression tracking
  - `phase.cjs` - Phase listing, creation, deletion, numbering logic
  - `verify.cjs` - Consistency checks, health validation, reference resolution

**get-shit-done/workflows/**
- Purpose: Multi-step orchestration procedures
- Contains: 34 Markdown files defining workflows
- Key files: `plan-phase.md`, `execute-phase.md`, `execute-plan.md`, `new-project.md`, `new-milestone.md`
- Pattern: <step> blocks with numbered execution, JSON parsing for tool outputs, agent spawning directives

**get-shit-done/references/**
- Purpose: Shared knowledge, patterns, guidelines (not project-specific)
- Contains: 15 Markdown files with task patterns, UI conventions, decision frameworks
- Key files: `tasks.md` (task type reference), `ui-brand.md` (component naming)

**get-shit-done/templates/**
- Purpose: Scaffold new artifacts and projects
- Contains: 28 Markdown templates organized by type
- Subdirs:
  - `codebase/` - Project scaffolds for code-driven projects
  - `research-project/` - Project scaffolds for research-only projects
- Key files: `PLAN.md` variants (standard, minimal, complex), `SUMMARY.md` variants, `STATE.md`, `ROADMAP.md`

**hooks/**
- Purpose: Git/runtime integration hooks
- Contains: Pre-commit validation for .planning/ consistency
- Key files: `hooks/dist/pre-commit.hook.js` (compiled), `hooks/src/pre-commit.hook.js` (source)
- Build: Compiled via `npm run build:hooks` using esbuild

**tests/**
- Purpose: Unit and integration test suite
- Contains: 10 CommonJS test files using Node.js native test runner
- Key files:
  - `core.test.cjs` - Model profiles, config loading, path normalization
  - `frontmatter.test.cjs` - Frontmatter extraction and validation
  - `phase.test.cjs` - Phase operations (list, create, delete)
  - `verify.test.cjs` - Verification checks
- Run: `npm test` or `npm run test:coverage`

## Key File Locations

**Entry Points:**
- `bin/install.js` - Global CLI installer (spawned by `get-shit-done-cc` npm bin)
- `get-shit-done/bin/gsd-tools.cjs` - Central toolkit (invoked by all workflows)

**Configuration:**
- `.planning/config.json` - Project config (model_profile, commit_docs, branching_strategy, etc.)
- `.planning/STATE.md` - Project state and progress
- `.planning/ROADMAP.md` - Phase definitions and requirements mapping
- `package.json` - NPM metadata, scripts, version

**Core Logic:**
- `get-shit-done/bin/lib/core.cjs` - Model profiles, config loading, phase discovery
- `get-shit-done/bin/lib/frontmatter.cjs` - Metadata extraction from .md files
- `get-shit-done/bin/lib/phase.cjs` - Phase CRUD, numbering logic
- `get-shit-done/bin/lib/state.cjs` - STATE.md operations and progression

**Workflows:**
- `get-shit-done/workflows/plan-phase.md` - Create phase plans
- `get-shit-done/workflows/execute-phase.md` - Execute all plans in phase
- `get-shit-done/workflows/execute-plan.md` - Execute single plan with checkpoints
- `get-shit-done/workflows/new-project.md` - Initialize new project

**Commands:**
- `commands/gsd/plan-phase.md` - User-facing plan-phase command
- `commands/gsd/execute-phase.md` - User-facing execute-phase command
- `commands/gsd/new-project.md` - User-facing new-project command
- `commands/gsd/debug.md` - User-facing debug command

**Agents:**
- `agents/gsd-executor.md` - Plan execution agent
- `agents/gsd-planner.md` - Plan creation agent
- `agents/gsd-debugger.md` - Issue debugging agent
- `agents/gsd-verifier.md` - Result verification agent

## Naming Conventions

**Files:**
- Commands: `lowercase-hyphenated.md` (e.g., `plan-phase.md`, `execute-phase.md`)
- Agents: `gsd-<role>.md` (e.g., `gsd-executor.md`, `gsd-planner.md`)
- Templates: Type prefix + variant (e.g., `PLAN.md`, `summary-minimal.md`, `verification-report.md`)
- Tests: `<module>.test.cjs` (e.g., `core.test.cjs`, `phase.test.cjs`)
- Workflows: `lowercase-hyphenated.md` (same as commands)

**Directories:**
- Phase dirs: `<phase-number>` (e.g., `1`, `1.1`, `2a`, `1.2.3`)
- Workflow subdirs: No nesting (flat structure in workflows/)
- Library modules: `lowercase.cjs` (e.g., `core.cjs`, `frontmatter.cjs`)
- Template categories: `lowercase-hyphenated/` (e.g., `codebase/`, `research-project/`)

**Code Conventions:**
- Function names: `camelCase` (e.g., `loadConfig`, `extractFrontmatter`, `findPhaseInternal`)
- Internal helpers: Suffix with `Internal` (e.g., `findPhaseInternal`, `resolveModelInternal`)
- Command functions: Prefix with `cmd` (e.g., `cmdPhasesList`, `cmdStateLoad`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `MODEL_PROFILES`, `GSD_CODEX_MARKER`)

## Where to Add New Code

**New Command:**
1. Create `commands/gsd/<command-name>.md`
2. Define frontmatter: name, description, agent, allowed-tools
3. Write <objective>, <execution_context>, <process> sections
4. Reference workflow via @~/.claude/get-shit-done/workflows/
5. Increment command count in this doc

**New Workflow:**
1. Create `get-shit-done/workflows/<workflow-name>.md`
2. Define <process> with <step> blocks (numbered)
3. Use gsd-tools.cjs commands for operations (see reference in core.cjs)
4. Include checkpoint handling for agents if needed
5. Increment workflow count in this doc

**New Agent:**
1. Create `agents/gsd-<role>.md`
2. Define role, skills, tools availability
3. Write <execution_flow> with <step> blocks
4. Include deviation rules (RULE 1-4) if applicable
5. Register in `bin/install.js` (CODEX_AGENT_SANDBOX)
6. Increment agent count in this doc

**New Library Module:**
1. Create `get-shit-done/bin/lib/<module>.cjs`
2. Use CommonJS exports (`module.exports = { ... }`)
3. Require existing modules (core, frontmatter, state)
4. Export atomic operations (cmdXxx functions)
5. Call output() with result and raw flag
6. Add tests in `tests/<module>.test.cjs`

**New Template:**
1. Markdown file in `get-shit-done/templates/` (or subdirectory)
2. Use template variable syntax: `[VARIABLE]`
3. For complex artifacts: use separate dir (e.g., `templates/codebase/`)
4. Reference in template.cjs fill functions

**Utilities & Helpers:**
- Shared helpers: `get-shit-done/bin/lib/core.cjs` (constants, path helpers)
- Validation schemas: `get-shit-done/bin/lib/frontmatter.cjs` (SCHEMA objects)
- Git operations: `get-shit-done/bin/lib/core.cjs` (execGit function)

## Special Directories

**`.planning/`** (Project-local, not committed until user runs command)
- Purpose: Holds all project state, phases, plans, summaries
- Generated: Yes (created by `/gsd:new-project`)
- Committed: Yes (if `commit_docs: true` in config)
- Key subdirs:
  - `phases/` - Phase directories with PLAN.md/SUMMARY.md
  - `codebase/` - STACK.md, ARCHITECTURE.md, CONVENTIONS.md, TESTING.md (output from `/gsd:map-codebase`)
  - `todos/pending/` and `todos/completed/` - Task tracking

**`hooks/dist/`** (Compiled hooks)
- Purpose: Pre-compiled hooks ready for installation
- Generated: Yes (via `npm run build:hooks`)
- Committed: Yes
- Contents: Pre-commit validation hooks

**`scripts/`** (Development utilities)
- Purpose: Build and test infrastructure
- Contents: `build-hooks.js` (esbuild), `run-tests.cjs` (test harness)
- Run: `npm run build:hooks`, `npm test`

**`tests/`** (Test suite)
- Purpose: Unit/integration tests for core modules
- Framework: Node.js native test runner (node:test)
- Coverage: c8 module (configured to check 70% lines coverage)
- Run: `npm test` or `npm run test:coverage`

---

*Structure analysis: 2026-03-11*
