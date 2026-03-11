# Technology Stack

**Analysis Date:** 2026-03-11

## Languages

**Primary:**
- JavaScript (Node.js) - Core system, CLI, build tools, tests
- CommonJS (`.cjs`) - All source modules in `get-shit-done/bin/lib/`

**Secondary:**
- Markdown - Documentation, templates, workflows, agent prompts
- YAML - GitHub Actions workflows

## Runtime

**Environment:**
- Node.js >= 16.7.0

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Build/Dev:**
- `esbuild` ^0.24.0 - JavaScript bundler (used in `scripts/build-hooks.js`)
- `c8` ^11.0.0 - Code coverage tool with V8 support

**Testing:**
- Node.js built-in test runner (`--test` flag) - No external test framework
- Cross-platform test runner: `scripts/run-tests.cjs` resolves test globs

## Key Dependencies

**Zero Production Dependencies:**
- Project uses only Node.js built-in modules: `fs`, `path`, `child_process`, `os`

**Development Dependencies:**
- `c8` ^11.0.0 - Coverage reporting
- `esbuild` ^0.24.0 - Hook building and bundling
- Platform-specific esbuild binaries (auto-selected per OS)

## Configuration

**Environment:**
- Project configuration: `.planning/config.json`
- Brave Search API: `BRAVE_API_KEY` env var or `~/.gsd/brave_api_key` file
- User-level defaults: `~/.gsd/defaults.json`

**Build:**
- `package.json` scripts:
  - `build:hooks` - Builds hook bundles via `scripts/build-hooks.js`
  - `test` - Runs all tests via `scripts/run-tests.cjs`
  - `test:coverage` - Runs tests with coverage (min 70% line coverage enforced)

**Key Configuration Files:**
- `package.json` - Project metadata, dependencies, scripts
- `get-shit-done/templates/config.json` - Default config template
- `get-shit-done/bin/gsd-tools.cjs` - Entry point for all CLI commands

## Platform Requirements

**Development:**
- Node.js 16.7.0 or later
- npm (included with Node.js)
- Works on macOS, Windows, Linux

**Distribution:**
- Published to npm registry as `get-shit-done-cc`
- Installed globally via: `npx get-shit-done-cc@latest`
- Binary entry point: `bin/install.js` (executable)

## Module Structure

**Core Library (`get-shit-done/bin/lib/*.cjs`):**
- `core.cjs` - Shared utilities: file I/O, config loading, model profiles, CLI helpers
- `commands.cjs` - Standalone commands: slug generation, timestamp, Brave Search integration
- `config.cjs` - Config CRUD operations and Brave API key detection
- `init.cjs` - Compound initialization for phase execution
- `frontmatter.cjs` - YAML frontmatter extraction and validation
- `phase.cjs` - Phase management utilities
- `template.cjs` - Template rendering and substitution
- `roadmap.cjs` - Roadmap parsing and phase lookup
- `milestone.cjs` - Milestone tracking
- `verify.cjs` - Verification and validation
- `state.cjs` - State management

**CLI Entry Point:**
- `get-shit-done/bin/gsd-tools.cjs` - Command router that dispatches to lib modules

**Hooks:**
- `hooks/` - Optional git hooks (built with esbuild)
- `hooks/dist/` - Compiled hook files

## Model Profiles

Built-in mapping of Claude models by quality tier:

| Agent | Quality | Balanced | Budget |
|-------|---------|----------|--------|
| gsd-planner | opus | opus | sonnet |
| gsd-roadmapper | opus | sonnet | sonnet |
| gsd-executor | opus | sonnet | sonnet |
| gsd-phase-researcher | opus | sonnet | haiku |
| gsd-project-researcher | opus | sonnet | haiku |
| gsd-research-synthesizer | sonnet | sonnet | haiku |
| gsd-debugger | opus | sonnet | sonnet |
| gsd-codebase-mapper | sonnet | haiku | haiku |
| gsd-verifier | sonnet | sonnet | haiku |
| gsd-plan-checker | sonnet | sonnet | haiku |
| gsd-integration-checker | sonnet | sonnet | haiku |
| gsd-nyquist-auditor | sonnet | sonnet | haiku |

---

*Stack analysis: 2026-03-11*
