# Codebase Concerns

**Analysis Date:** 2026-03-11

## Tech Debt

**Large monolithic files with multiple responsibilities:**
- Issue: Core library files exceed 700-900 lines, blending multiple concerns
  - `get-shit-done/bin/lib/phase.cjs` (901 lines) — Phase CRUD, lifecycle, queries, comparisons
  - `get-shit-done/bin/lib/verify.cjs` (820 lines) — Verification logic, health checks, consistency validation
  - `get-shit-done/bin/lib/state.cjs` (721 lines) — State operations, field extraction, progression
  - `get-shit-done/bin/lib/init.cjs` (710 lines) — Compound initialization, tech stack detection, config bootstrap
- Impact:
  - Hard to test individual concerns independently
  - Changes in one area (e.g., phase parsing) risk side effects in another (e.g., phase lifecycle)
  - Line-by-line review becomes expensive
- Fix approach: Extract cohesive concerns into separate modules — parsing logic, validation logic, data transformation logic should live in distinct files with focused responsibilities

**Synchronous file I/O blocking throughout codebase:**
- Issue: 88 instances of synchronous file operations (`fs.readFileSync`, `fs.writeFileSync`) across all lib files
- Files: `get-shit-done/bin/lib/phase.cjs`, `get-shit-done/bin/lib/verify.cjs`, `get-shit-done/bin/lib/state.cjs`, `get-shit-done/bin/lib/init.cjs`, `get-shit-done/bin/lib/config.cjs`, `get-shit-done/bin/lib/core.cjs`
- Impact:
  - CLI commands hang on slow filesystems (network drives, WSL2 on Windows)
  - Batch operations that read/write multiple files become sequential bottlenecks
  - No opportunity for parallelism within a single command
- Fix approach:
  - Assess which operations truly require synchronicity (most don't)
  - Convert high-frequency operations to async where CLI architecture allows
  - Consider Promise.all() for batch operations that currently serialize

**Inconsistent error handling patterns:**
- Issue: Three error-handling strategies visible:
  1. Try-catch blocks followed by `error()` (which immediately exits) — `core.cjs:85-94`, `config.cjs:37-50`, `init.cjs:173+`
  2. Try-catch with silent failures (empty `catch {}` blocks) — `frontmatter.cjs:255`, `core.cjs:94`, `config.cjs:45`
  3. Inline try-parse patterns that catch and fall back — `frontmatter.cjs:255`, `config.cjs:75-79`
- Files affected: All files in `get-shit-done/bin/lib/`
- Impact:
  - Debugging failures is harder because silent catches hide errors
  - Recovery behavior is inconsistent — some errors exit immediately, others silently degrade
  - Error messages lack context (file paths, operation names)
- Fix approach:
  - Establish single error strategy: log with context, then decide exit vs. fallback based on severity
  - Replace silent `catch {}` with at least `catch (e) { logger.debug(e) }` for debugging
  - Add operation context to error messages: `"Failed to list phases in ${phasesDir}: ${e.message}"`

**No structured logging — console output mixed with process state:**
- Issue: All error reporting uses `process.stderr.write('Error: ' + message)`, no logging levels or timestamping
- Files: `get-shit-done/bin/lib/core.cjs` (lines 53-56), called throughout
- Impact:
  - Users can't filter or suppress verbose output
  - No audit trail of command execution
  - Debugging failures requires adding console.logs manually
- Fix approach: Introduce simple logger with levels (debug, info, warn, error) that respects `DEBUG` env var

**Regex parsing fragility with unescaped user input:**
- Issue: Multiple regex constructors built from user input without validation
  - `core.cjs:114` — `new RegExp(normalized + ...)` where `normalized` comes from user phase name
  - `state.cjs:78` — `.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` correctly escapes but pattern is inconsistently applied
  - `phase.cjs:114` — `new RegExp(normalized + '\\.(\\d+)')` same issue
  - `verify.cjs:41-42` — Hardcoded file patterns but could be user-configurable
- Files: `get-shit-done/bin/lib/core.cjs`, `get-shit-done/bin/lib/state.cjs`, `get-shit-done/bin/lib/phase.cjs`
- Impact:
  - Phase names with regex metacharacters (`.`, `+`, `*`, etc.) will cause regex syntax errors or unexpected matches
  - Silent failures or incorrect phase identification in edge cases
- Fix approach:
  - Extract `escapeRegex()` utility (exists in core.cjs) and use consistently before all RegExp constructors
  - Add tests for phase names containing `.+*?^${}()|[]\\`
  - Create `escapeRegexLiteral()` helper that appears in state.cjs (line 13) for one-off uses

## Known Bugs

**Phase decimal calculation doesn't handle edge case where base phase doesn't exist:**
- Symptoms: `cmdPhaseNextDecimal()` returns next decimal even if base phase (e.g., "2") doesn't exist on disk
- Files: `get-shit-done/bin/lib/phase.cjs` (lines 87-150)
- Trigger: Call `/gsd:phase next-decimal 5` when phase 5 directory hasn't been created yet — returns `5.1` as if ready to create
- Impact: User may try to run `create 5.1` before `create 5`, violating phase ordering assumptions
- Workaround: Call `/gsd:phase list` first to verify base phase exists
- Fix approach: Verify `baseExists` (already computed on line 111) is true before returning next decimal; return error or warning if base doesn't exist

**State extraction with regex fails when field values contain special characters:**
- Symptoms: `stateExtractField()` uses case-insensitive regex which can match wrong fields if naming is similar
- Files: `get-shit-done/bin/lib/state.cjs` (lines 12-20)
- Trigger: Field named "Phase" and "phase" in same STATE.md, or field values containing YAML-like content
- Impact: Wrong field value returned, config becomes corrupted
- Workaround: Keep field names distinct and case-consistent
- Fix approach:
  - Use exact case matching by default (`/i` flag only when necessary)
  - Test field extraction with markdown containing special chars: code blocks, quotes, URLs

**JSON parsing errors in config files silently fall back to defaults:**
- Symptoms: Corrupted `config.json` or `defaults.json` causes silent default loading with no warning
- Files: `get-shit-done/bin/lib/config.cjs` (lines 37-50, 75-79), `core.cjs` (lines 85-94)
- Trigger: Manual editing of `~/.gsd/defaults.json` with invalid JSON, or partially written file during concurrent updates
- Impact: User's custom config is silently lost; they may not realize until behavior changes unexpectedly
- Workaround: Validate JSON files manually before use
- Fix approach:
  - Log warning when falling back to defaults: `logger.warn('Invalid JSON in defaults.json, using hardcoded defaults')`
  - Add pre-write validation: write to temp file, validate parse, then atomically rename

## Security Considerations

**Arbitrary command execution via git operations:**
- Risk: `execGit()` joins user-supplied phase names and paths into git commands via shell string concatenation
- Files: `get-shit-done/bin/lib/core.cjs` (lines 159-180), `get-shit-done/bin/lib/commands.cjs` (lines in commit path-building)
- Current mitigation: Only phase names and relative paths are user-controlled; git commands are git-specific and don't enable shell expansion
- Current protection: `execSync('git ' + escaped.join(' '))` manually escapes arguments (line 172)
- Recommendations:
  - Add allowlist validation for phase names: only allow alphanumeric, hyphens, dots — reject spaces and special chars
  - Use git library (like `simple-git`) instead of shell execution to avoid injection entirely
  - Add test cases with phase names like `"; rm -rf ."` and `$(whoami)`

**Path traversal via file operations:**
- Risk: File paths constructed from user input could escape cwd with `../` sequences
- Files: `get-shit-done/bin/lib/init.cjs` (lines 308-330 tech stack detection), anywhere `path.join(cwd, userInput)` is used
- Current mitigation: `path.join()` normalizes paths but doesn't restrict traversal; `fs.existsSync(path.join(cwd, file))` in `verify.cjs:58` could check files outside cwd
- Recommendations:
  - After `path.join(cwd, userInput)`, verify result starts with `cwd` (check normalized real paths)
  - Add validation: reject paths containing `..` explicitly
  - Test with filenames like `../../../etc/passwd`

**Secrets in config files not validated:**
- Risk: Config validation doesn't detect leaked API keys or credentials in config.json
- Files: `get-shit-done/bin/lib/config.cjs` (entire file)
- Current mitigation: Config schema is well-defined and only contains toggle booleans, strings without user data
- Recommendations:
  - Add warning if config values look like secrets (sk-*, api_*, password)
  - Document that config.json should not contain credentials; use env vars instead
  - Scan and validate env var names in workflows but never echo their values

**Process stdin/stdout/stderr handling:**
- Risk: Large JSON payloads written directly to stdout without encoding checks
- Files: `get-shit-done/bin/lib/core.cjs` (lines 35-50), `state.cjs` (lines 44-62)
- Current mitigation: Payloads >50KB are written to temp files with `@file:` prefix; stdout remains valid
- Recommendations:
  - Document `@file:` protocol in CLI help so callers know to check for it
  - Add integrity check (CRC or size header) to temp files
  - Set temp files to 0600 permissions to prevent other users from reading

## Performance Bottlenecks

**Phase list operations are O(n) directory reads:**
- Problem: Listing phases reads entire directory multiple times per operation
  - `cmdPhasesList()` reads directory, then reads each phase directory again to filter by type
  - `cmdPhaseNextDecimal()` reads full directory to find existing decimals for one base phase
- Files: `get-shit-done/bin/lib/phase.cjs` (lines 11-85, 87-150)
- Cause: No caching; every query is a fresh disk read
- Improvement path:
  - Cache phase directory listing in memory during single command execution
  - For large projects with 100+ phases, O(n) becomes noticeable
  - Consider indexing if phase count grows past 50

**Tech stack detection via shell globbing in init:**
- Problem: `find . -maxdepth 3 | grep -v node_modules | head -5` runs on every init execute-phase
- Files: `get-shit-done/bin/lib/init.cjs` (lines 287-330)
- Cause: Discovers tech stack by scanning filesystem; re-runs even if already known
- Improvement path:
  - Cache tech stack detection in config.json if already determined
  - Only re-detect if package.json or similar markers have changed
  - Current head-5 limit is good; prevents massive repos from hanging

**Regex compilation in tight loops:**
- Problem: Phase comparison function compiles regex for every phase pair comparison during sort
- Files: `get-shit-done/bin/lib/core.cjs` (lines 201-230, `comparePhaseNum()`)
- Cause: Pattern `const [, ...] = name.match(/(\d+)(?:\.(\d+))?(?:-(\D+))?/)` runs per comparison; sort calls this O(n log n) times
- Improvement path:
  - Pre-parse phase numbers into comparable tuples before sort
  - Store as `{major, minor, suffix}` once, then compare tuples directly
  - Only noticeable for 200+ phases

## Fragile Areas

**Phase removal with cross-phase references:**
- Files: `get-shit-done/bin/lib/phase.cjs` (lines 271-330, `cmdPhaseRemove()`)
- Why fragile:
  - Removes decimal subphases when base is removed
  - Updates ROADMAP.md to remove phase section
  - But doesn't validate that nothing else references removed phase
  - If STATE.md or other files still mention removed phase, they become stale
- Safe modification:
  - Before removing, search entire codebase for references to phase number
  - Document: "removing a phase doesn't clean up references in STATE.md or phase CONTEXT.md files"
  - Add optional `--force` flag that requires confirmation
- Test coverage:
  - Only remove is tested in phase.test.cjs
  - No test for removing phase that's referenced in STATE.md

**Milestone version parsing with flexible formats:**
- Files: `get-shit-done/bin/lib/milestone.cjs` (lines 66-100, `getMilestoneVersionInternal()`)
- Why fragile:
  - Regex matches `## Milestone v1.2.3` or `## [1.2.3]` or `## Unreleased` with loose parsing
  - Assumes first match is current; if CHANGELOG has out-of-order versions, wrong one is selected
  - Returns plaintext version that may contain spaces or special chars
- Safe modification:
  - Validate version format strictly: `^\d+\.\d+\.\d+$` for semver
  - Reject malformed versions with clear error
  - Add fallback: if no valid version found, scan for "Unreleased" section explicitly
- Test coverage:
  - Tests exist in milestone.test.cjs but only cover simple cases
  - Add tests for: "## [v1.2.3]", "## v1.2.3-beta", "## Version 1.2.3", malformed versions

**Frontmatter field extraction with nested structures:**
- Files: `get-shit-done/bin/lib/frontmatter.cjs` (lines 1-130, `parseFrontmatter()`)
- Why fragile:
  - Parses YAML-like frontmatter but doesn't use real YAML parser
  - Handles lists with `value.slice(1, -1).split(',')` (line 83) — breaks if item contains comma or brackets
  - Field order matters; overwrites earlier fields with same name
- Safe modification:
  - Use real YAML parser if frontmatter becomes more complex
  - Document restrictions: "List items cannot contain commas; no nested objects"
  - Add escaping rules: how to represent comma in list item
- Test coverage:
  - Tests in frontmatter.test.cjs are basic
  - Add tests for: lists with commas, special characters in values, duplicate field names

**Config migration from "depth" to "granularity":**
- Files: `get-shit-done/bin/lib/config.cjs` (lines 40-46), `core.cjs` (lines 89-95)
- Why fragile:
  - Migration happens silently when config is loaded
  - Mapping is hardcoded: `{ quick: 'coarse', standard: 'standard', comprehensive: 'fine' }`
  - If user had custom "depth" value not in mapping, it's passed through as-is and may cause errors downstream
- Safe modification:
  - Validate migrated value against known granularity levels
  - Log migration: `logger.info('Migrated config depth=${oldDepth} to granularity=${newGranularity}')`
  - Refuse to load config if unknown depth value can't be mapped
- Test coverage:
  - config.test.cjs tests migration but only for known values
  - Add test for custom depth value like `"depth": "extra-comprehensive"` — should error clearly

## Scaling Limits

**Phase counting with flat file structure:**
- Current capacity: Works well up to 200 phases with modern filesystem (tested implicitly via directoryReadSync)
- Limit: Where it breaks:
  - Phase list operations slow down O(n) around 500+ phases
  - Regex sorting becomes noticeably slower at 1000+ phases
  - Dashboard/visualization tools may fail to render 2000+ items
- Scaling path:
  - Introduce phase index file (JSON with phase metadata) to avoid directory reads
  - Group phases by milestone instead of flat structure: `.planning/milestones/v1.0/phases/1/`, etc.
  - Lazy-load phase metadata instead of full directory scans

**Roadmap file size growth:**
- Current capacity: Works fine up to 5000 lines (typical with 100 phases)
- Limit: Where it breaks:
  - Regex parsing of entire roadmap content (lines 294-330 in core.cjs) gets slow at 50,000 lines
  - Keeping full CHANGELOG appended to ROADMAP would exceed this quickly
- Scaling path:
  - Archive old milestones to separate CHANGELOG-{version}.md files
  - Only keep active/recent milestones in main ROADMAP.md
  - Pre-compile phase list as separate metadata file for fast lookup

**Concurrent command execution:**
- Current capacity: Single-threaded execution only; each command blocks until complete
- Limit: Where it breaks:
  - User can't run `/gsd:plan-phase` in one IDE split while `/gsd:execute-phase` runs in another
  - If planning takes 5 minutes, execution can't start until planning finishes
- Scaling path:
  - Currently not a issue for CLI model; each command is atomic
  - For future IDE integration: add file locks to prevent conflicting operations on same phase
  - Document: "Run different phases in different IDE instances; don't run same phase concurrently"

## Dependencies at Risk

**Zero external npm dependencies (intentional):**
- Risk: All parsing/validation implemented from scratch (YAML-like frontmatter, regex-based phase numbers, custom file operations)
- Impact:
  - Zero supply-chain attack surface (good)
  - But custom implementations are less battle-tested than established libraries
  - Bugs in parsing or file handling have to be fixed in-house
- Migration plan:
  - If complexity grows, introduce: `yaml` for real frontmatter parsing, `semver` for version comparison
  - Keep critical path dependency-free: core CRUD operations must work offline
  - Use libraries only for nice-to-have features (formatting, advanced validation)

**Node.js built-in modules used directly:**
- Risk: `fs`, `path`, `child_process` are Node.js core; breaking changes are rare but possible
- Current: Code assumes Node >=16.7.0 (from package.json engines field)
- Recommendations:
  - Test against LTS releases (18, 20) periodically
  - Document: "GSD requires Node 16.7.0+; use `nvm` or similar for version management"
  - Watch for Node.js deprecation warnings during development

## Missing Critical Features

**No rollback mechanism for config changes:**
- Problem: User can run `/gsd:config set model_profile budget` and immediately lock themselves into a low-quality model with no undo
- Blocks: Users can't safely experiment with config changes
- Impact: Accidental misconfiguration can silently reduce plan/code quality
- Fix approach:
  - Add `config backup` command to save current state
  - Add `config restore` command with interactive history
  - Or: version config.json like CHANGELOG, keep old versions in `.planning/config.history.json`

**No validation that ROADMAP structure matches phase directories:**
- Problem: User can manually delete phase directory but ROADMAP still lists it; subsequent commands get confused
- Blocks: ROADMAP and filesystem can become out-of-sync with no detection
- Impact: "phantom phases" in ROADMAP that don't exist on disk cause errors
- Fix approach:
  - Add `verify consistency` subcommand that checks ROADMAP references match `.planning/phases/` directories
  - Run as pre-flight check before major operations
  - Auto-repair flag: `verify consistency --fix` removes stale ROADMAP entries

**No way to pin LLM model versions in workflow:**
- Problem: Config says model_profile="balanced", but "balanced" might map to Sonnet 4 today and Haiku 4.6 tomorrow after Claude version bump
- Blocks: Plan quality is non-deterministic across GSD version upgrades
- Impact: Same spec produces different quality/cost tradeoff on next update
- Fix approach:
  - Allow config to specify exact model names: `"model_profile": "claude-3-5-sonnet-20241022"`
  - Maintain backward compatibility: profile names still work, but resolve to specific version at config load time
  - Document: "Upgrade GSD and re-plan if you want latest model behavior"

## Test Coverage Gaps

**No test for Windows path separators in actual execution:**
- Untested: Cross-platform path handling when commands actually run (not just path.join parsing)
- Files: All files in `get-shit-done/bin/lib/` use `toPosixPath()` for output, but actual filesystem operations use `path.sep`
- Risk: Phase CONTEXT.md files may have incorrect paths on Windows (`\` instead of `/`)
- Priority: Medium — Windows users reported fixes in v1.22.4 for `@file:` protocol, but general path handling still needs integration test

**No test for very large file reads (>50MB):**
- Untested: `safeReadFile()` and `fs.readFileSync()` behavior with large files
- Files: `get-shit-done/bin/lib/core.cjs` (lines 60-66), `state.cjs` (lines 27-29), `verify.cjs` (lines 35)
- Risk: Reading entire git history or large CHANGELOG could exceed memory or timeout
- Priority: Low — GSD's files are typically small (<1MB), but in pathological cases could hang

**No test for shell metacharacters in phase/file names:**
- Untested: Phase names containing `$`, backticks, semicolons, pipes
- Files: `get-shit-done/bin/lib/phase.cjs`, `commands.cjs`, `core.cjs` (execSync calls)
- Risk: Phase named `test; echo pwned` could execute arbitrary commands
- Priority: High — Security issue if phase names aren't strictly validated
- Current protection: Phase names come from directory names created by GSD, not user input to shell

**No test for concurrent .planning directory writes:**
- Untested: Two CLI commands modifying same files simultaneously
- Files: All files that write to `.planning/`
- Risk: File corruption, lost updates, race conditions
- Priority: Low — CLI is single-threaded; only an issue if user runs multiple terminals on same project
- Mitigation: Add file locking when parallel execution is added

**No test for config.json with unknown fields:**
- Untested: Loading config with extra fields added by future GSD versions
- Files: `get-shit-done/bin/lib/config.cjs` (lines 68-130)
- Risk: Older GSD versions silently ignore new config fields, making it hard to debug why settings don't apply
- Priority: Low — Config schema is stable, but good practice for forward compatibility
- Fix: Test `{ model_profile: 'balanced', future_feature: true }` — should load without error, ignore unknown field

---

*Concerns audit: 2026-03-11*
