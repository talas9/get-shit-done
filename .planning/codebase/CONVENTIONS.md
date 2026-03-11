# Coding Conventions

**Analysis Date:** 2026-03-11

## Language & Runtime

**Primary:** JavaScript (CommonJS) via Node.js 16.7.0+
**File Extensions:** `.cjs` for CommonJS modules, `.js` for scripts

## Naming Patterns

**Files:**
- Module files: lowercase with hyphens for readability (`core.cjs`, `frontmatter.cjs`, `state.cjs`)
- Test files: `<module>.test.cjs` (e.g., `core.test.cjs`)
- Scripts: lowercase with hyphens (`run-tests.cjs`, `build-hooks.js`)

**Functions:**
- Private helpers: camelCase with no prefix (e.g., `escapeRegex()`, `toPosixPath()`)
- Command handlers: `cmd<Action>` pattern (e.g., `cmdStateLoad()`, `cmdGenerateSlug()`, `cmdHistoryDigest()`)
  - This pattern makes it clear which functions are CLI entry points vs internal utilities
- Underscore suffix for internal/non-exported functions: `SomethingInternal()` (e.g., `resolveModelInternal()`, `pathExistsInternal()`, `findPhaseInternal()`)
- Nested helper functions allowed within parent scope without special prefix

**Variables:**
- camelCase for all variable declarations (`tmpDir`, `configPath`, `frontmatter`, `phaseNum`)
- UPPERCASE for constants (`MODEL_PROFILES`, `TOOLS_PATH`, `FRONTMATTER_SCHEMAS`)
- Descriptive names preferred over abbreviations: `phaseDirectory` rather than `phaseDir` (though `tmpDir` is conventional)

**Classes/Objects:**
- Not heavily used in this codebase; data structures are plain objects with camelCase keys
- Constants containing data tables use UPPERCASE (`MODEL_PROFILES`)

## Code Style

**Formatting:**
- No automated formatter configured (no `.prettierrc` or ESLint)
- Indentation: 2 spaces (inferred from code review)
- Line length: No enforced limit observed
- Semicolons: Consistently used at statement ends

**Conventions:**
- Single quotes for strings in code, double quotes in JSON/YAML output
- Ternary operators preferred for simple conditionals
- Early returns to reduce nesting in functions
- Comments placed above code they describe, not inline

## File Header Pattern

All modules start with a JSDoc-style comment block describing the module's purpose:

```javascript
/**
 * [Module Name] — [brief description of responsibility]
 */
```

Example from `core.cjs`:
```javascript
/**
 * Core — Shared utilities, constants, and internal helpers
 */
```

## Organization Within Files

Files use horizontal divider comments using en-dashes to visually section related functions:

```javascript
// ─── [Section Name] ────────────────────────────────────────────────────────
```

Sections group related functionality:
- `core.cjs`: Path helpers, Model Profile Table, Output helpers, File & Config utilities, Git utilities, Phase utilities, Roadmap & model utilities, Misc utilities
- `frontmatter.cjs`: Parsing engine, Frontmatter CRUD commands
- `state.cjs`: State Progression Engine, State Frontmatter Sync

See `get-shit-done/bin/lib/core.cjs` for example structure.

## Import Organization

**Order:**
1. Node.js built-ins first (`fs`, `path`, `child_process`)
2. Local imports from same project
3. Destructuring used liberally for selective imports

**Example from `core.cjs`:**
```javascript
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
```

**Path style:**
- Relative paths using `require('../relative/path')`
- No path aliases or import mappings used

## Error Handling

**Pattern: Try-catch with defaults**

Functions use bare catch blocks returning null, empty values, or continuing execution:

```javascript
try {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return parsed;
} catch {
  return defaults;
}
```

Rationale: Most functions handle missing files/invalid configs gracefully rather than throwing.

**CLI Error reporting:**

Two error functions for different contexts:
- `output(result, raw, rawValue)` — Success path, returns JSON or raw value via stdout
- `error(message)` — CLI failures, logs to stderr and exits with code 1

Example:
```javascript
function error(message) {
  process.stderr.write('Error: ' + message + '\n');
  process.exit(1);
}
```

Validation errors that should fail the command use `error()`:
```javascript
if (!field || value === undefined) {
  error('field and value required for state update');
}
```

## Comments

**When to comment:**
- Section dividers before logical groupings
- Explaining WHY a choice was made, not WHAT the code does
- Complex regex patterns
- Known limitations or bugs (documented as REG-XX regression markers)

**Example (from `core.cjs`):**
```javascript
// --no-index checks .gitignore rules regardless of whether the file is tracked.
// Without it, git check-ignore returns "not ignored" for tracked files even when
// .gitignore explicitly lists them — a common source of confusion when .planning/
// was committed before being added to .gitignore.
```

**JSDoc style:**
Used for function exports and public APIs:

```javascript
/**
 * Run gsd-tools command.
 *
 * @param {string|string[]} args - Command string (shell-interpreted) or array
 *   of arguments (shell-bypassed via execFileSync, safe for JSON and dollar signs).
 * @param {string} cwd - Working directory.
 */
function runGsdTools(args, cwd = process.cwd()) {
```

See `tests/helpers.cjs` for full example.

## Known Limitations (Documented as Regressions)

Bugs and limitations are tracked with `REG-XX` markers in comments and tests:

- **REG-01**: `loadConfig()` previously omitted `model_overrides` from return value (fixed, tested in `core.test.cjs`)
- **REG-02**: `getRoadmapPhaseInternal` export was missing (documented in tests)
- **REG-04**: Frontmatter parser does NOT respect quotes in inline arrays (known limitation: `key: ["a, b", c]` splits on commas inside quotes) — see `frontmatter.test.cjs` line 57

These are documented in test comments so future developers understand the limitations.

## Module Exports

All modules use CommonJS `module.exports`:

```javascript
module.exports = {
  functionOne,
  functionTwo,
  CONSTANT,
};
```

Only functions and constants needed by other modules are exported; helpers are private.

Example from `core.cjs` exports:
- Public: `loadConfig`, `resolveModelInternal`, `output`, `error`, `safeReadFile`, etc.
- Private: Nested helpers like `const get = (key, nested) => {...}` within `loadConfig()`

## Async/Await

**Patterns:** `execSync` and synchronous file operations only (no async/await)

All I/O is synchronous using:
- `fs.readFileSync()`, `fs.writeFileSync()`, `fs.readdirSync()`
- `execSync()` for shell commands

No Promise or async/await patterns used in the codebase.

## Configuration & State Patterns

**Config loading:**
- Defaults defined at function start
- Top-level config keys take precedence over nested section keys
- Missing files return defaults without throwing

**State file format:**
- YAML frontmatter (between `---` markers) for structured data
- Markdown sections for human-readable content
- Both **bold field:** and plain field: formats supported for field extraction

See `get-shit-done/bin/lib/config.cjs` and `state.cjs` for implementation.

## Cross-Cutting Concerns

**Logging:** Uses `console.log()` for user feedback (no logging framework)

**Validation:** Happens early in functions, uses `error()` to fail fast for CLI commands

**Path handling:**
- Absolute paths preferred for clarity
- `path.isAbsolute()` checks before joining with `path.join()`
- `toPosixPath()` converts Windows paths to forward slashes for consistency

**Git operations:**
- Wrapped by `execGit()` function in `core.cjs`
- Returns object with `{ exitCode, stdout, stderr }` for uniform handling
- All git commands use escaped arguments to handle special characters safely

---

*Convention analysis: 2026-03-11*
