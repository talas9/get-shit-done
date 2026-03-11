# External Integrations

**Analysis Date:** 2026-03-11

## APIs & External Services

**Brave Search API:**
- Service: Brave Web Search API
- What it's used for: Optional web search capability for research agents (gracefully degrades if unavailable)
- SDK/Client: Fetch API (built-in Node.js)
- Auth: `BRAVE_API_KEY` environment variable
- Implementation: `get-shit-done/bin/lib/commands.cjs` - `cmdWebsearch()` function
- Endpoint: `https://api.search.brave.com/res/v1/web/search`
- Status: Optional — agents fall back to built-in WebSearch when Brave API key is not configured

**GitHub Integration:**
- Service: Git via CLI (execSync)
- What it's used for: Phase/milestone branching, commit creation, git operations
- Implementation: `get-shit-done/bin/lib/core.cjs` - `execGit()` function
- Capabilities: Clone, checkout, branch, commit, push operations
- Status: Core to phase execution workflow

## Data Storage

**Local Filesystem Only:**
- Configuration: `.planning/config.json` in project root
- Phase data: `.planning/phases/` directory (structured per phase)
- Roadmaps: `.planning/ROADMAP.md`
- State: `.planning/STATE.md`
- Todos: `.planning/todos/pending/` directory
- Milestones: `.planning/milestones/` directory

**No External Databases:**
- This is a CLI/file-based system
- All state stored as JSON and Markdown files

## Authentication & Identity

**No Built-in Auth System:**
- Project is a CLI tool (not a web service)
- Uses git commit identity for attribution
- API authentication limited to Brave Search API key

**Auth Configuration:**
- Brave API: Stored as environment variable `BRAVE_API_KEY` or file `~/.gsd/brave_api_key`
- Git: Uses local git config for author identity

## Monitoring & Observability

**Error Tracking:**
- None — errors written to stderr via `process.stderr.write()`

**Logs:**
- Console output via `process.stdout` and `process.stderr`
- No structured logging framework
- Optional debug log: `firebase-debug.log` (present in repo, legacy)

## CI/CD & Deployment

**Hosting:**
- npm registry (npmjs.org)
- Published as package: `get-shit-done-cc`

**CI Pipeline:**
- GitHub Actions (workflows in `.github/`)
- Test workflow: `test.yml` - Runs Node.js test suite
- Coverage enforced: Minimum 70% line coverage

**Distribution:**
- Global npm installation: `npx get-shit-done-cc@latest`
- Entry point: `bin/install.js` (executable script)

## Environment Configuration

**Required env vars (for optional features):**
- `BRAVE_API_KEY` - Optional, enables Brave Search integration (graceful degradation if missing)

**Optional env vars:**
- `NODE_V8_COVERAGE` - Set automatically by test runner for coverage collection

**Configuration Files:**
- `.planning/config.json` - Project-level settings (created on init)
  - `model_profile` - 'quality', 'balanced', or 'budget' (default: 'balanced')
  - `commit_docs` - Boolean for auto-committing documentation (default: true)
  - `search_gitignored` - Whether to search .gitignored files (default: false)
  - `branching_strategy` - Git branching approach (default: 'none')
  - `brave_search` - Enable/disable Brave integration (auto-detected)
  - `workflow.research` - Enable research phase (default: true)
  - `workflow.plan_check` - Enable plan verification (default: true)
  - `workflow.verifier` - Enable verification (default: true)
  - `workflow.nyquist_validation` - Enable Nyquist audit (default: true)

## Secrets Location

- `BRAVE_API_KEY` environment variable OR
- `~/.gsd/brave_api_key` file (read-only, checked by config.cjs)
- User defaults: `~/.gsd/defaults.json`

## Webhooks & Callbacks

**Incoming:**
- None (this is a CLI tool, not a server)

**Outgoing:**
- Git operations: commit creation, branch management (via `execGit()`)
- Optional: Custom post-phase hooks could be implemented via git hooks directory

---

*Integration audit: 2026-03-11*
