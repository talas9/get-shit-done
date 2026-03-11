# Testing Patterns

**Analysis Date:** 2026-03-11

## Test Framework

**Runner:**
- Node.js built-in `node:test` module (no external test framework)
- Version: Node 16.7.0+ (ships with node:test)
- Config: See `package.json` scripts section

**Assertion Library:**
- Node.js built-in `node:assert` module
- Uses `assert.strictEqual()`, `assert.deepStrictEqual()`, `assert.ok()` exclusively

**Run Commands:**
```bash
npm test                    # Run all tests
npm run test:coverage       # Run with c8 coverage reporter (70% line threshold)
node scripts/run-tests.cjs  # Direct invocation (cross-platform glob resolution)
```

**Coverage Tool:**
- `c8` (version ^11.0.0)
- Configuration: `--check-coverage --lines 70` enforces 70% line coverage minimum
- Includes: `get-shit-done/bin/lib/*.cjs` only (main library code)
- Excludes: `tests/**` directory itself

See `package.json` for exact configuration.

## Test File Organization

**Location:** `/Users/talas9/Projects/get-shit-done/tests/` (separate from source)

**Naming Convention:** `<module>.test.cjs` (e.g., `core.test.cjs`, `state.test.cjs`)

**Test files present:**
- `core.test.cjs` — Core utilities (config, models, path helpers)
- `state.test.cjs` — State management and snapshots
- `phase.test.cjs` — Phase operations and listing
- `commands.test.cjs` — Command handlers
- `frontmatter.test.cjs` — YAML parsing and serialization
- `config.test.cjs` — Configuration management
- `roadmap.test.cjs` — Roadmap parsing
- `milestone.test.cjs` — Milestone operations
- `verify.test.cjs` — Verification logic
- And others covering dispatcher, initialization, CLI frontmatter validation

**Total:** 16 test files with ~10,658 lines of test code

## Test Structure

**Suite Organization:**

```javascript
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { /* imports */ } = require('../get-shit-done/bin/lib/...');

describe('Feature or function group', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-test-'));
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('specific behavior', () => {
    // Test implementation
  });
});
```

**Patterns:**
- `describe()` groups related tests (one per logical feature)
- `beforeEach()` sets up test isolation (temp directories, state)
- `afterEach()` cleans up resources
- `test()` defines individual test cases with descriptive names
- Each test is independent and can run in any order

**Test isolation:**
Critical for this project since tests manipulate the file system:
- Each test gets a fresh temporary directory via `fs.mkdtempSync()`
- Original working directory is preserved/restored per test
- Cleanup happens in `afterEach()` using `fs.rmSync(tmpDir, { recursive: true, force: true })`

See `tests/core.test.cjs` lines 34-46 for example pattern.

## Test Data & Fixtures

**Fixture approach:**
Tests write files directly instead of using fixture files. This keeps fixtures in-code and automatically cleaned up.

**Helper function:**
`createTempProject()` in `tests/helpers.cjs` initializes test workspace:
- Creates `.planning/phases/` directory structure
- Returns temporary directory path
- Caller populates with test data as needed

```javascript
function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-'));
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
  return tmpDir;
}
```

**Git-enabled fixture:**
`createTempGitProject()` for tests requiring git:
- Initializes git repo with default config
- Creates initial commit (required by some commands)
- Used in phase operations and state tests

See `tests/helpers.cjs` lines 52-69.

**Test data written inline:**
```javascript
fs.writeFileSync(
  path.join(tmpDir, '.planning', 'STATE.md'),
  `# Project State\n\n**Current Phase:** 03\n...`
);
```

This pattern embeds test data directly in test code, making expectations visible.

## Mocking & Isolation

**Approach:** Minimal mocking; uses real file system and process execution

**What's mocked:**
- Nothing is explicitly mocked using a mocking library
- Tests use real `execSync()` to invoke CLI commands

**What's isolated:**
- Temporary directories (no cross-contamination between tests)
- `process.cwd()` is restored after each test
- Each test manipulates isolated file system paths

**Testing command output:**
Commands are tested end-to-end using `runGsdTools()` helper:

```javascript
function runGsdTools(args, cwd = process.cwd()) {
  try {
    let result;
    if (Array.isArray(args)) {
      result = execFileSync(process.execPath, [TOOLS_PATH, ...args], {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      result = execSync(`node "${TOOLS_PATH}" ${args}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    return { success: true, output: result.trim() };
  } catch (err) {
    return {
      success: false,
      output: err.stdout?.toString().trim() || '',
      error: err.stderr?.toString().trim() || err.message,
    };
  }
}
```

This invokes the actual CLI tool in an isolated temp directory, testing the real integration.

## Assertion Patterns

**Common patterns from actual tests:**

```javascript
// Simple equality
assert.strictEqual(config.model_profile, 'balanced');

// Boolean checks
assert.ok(result.success, `Command failed: ${result.error}`);

// Deep object equality
assert.deepStrictEqual(digest.phases, {}, 'phases should be empty object');

// Array/object membership
assert.deepStrictEqual(output.directories, ['01-foundation', '02-api', '10-final'], 'should be sorted numerically');

// JSON parsing results
const digest = JSON.parse(result.output);
assert.deepStrictEqual(digest.tech_stack.sort(), ['jose', 'prisma']);

// Existence checks
assert.strictEqual(output.count, 3, 'should have 3 directories');
```

**Naming convention:**
Assert messages (second parameter) use plain English, describing the expected behavior:
- `'should be sorted numerically'`
- `'phases should be empty object'`
- `'field not found in STATE.md'`

## Error & Edge Case Testing

**REG-XX (Regression) tests:**
Codebase documents known bugs and limitations as regression markers:

**REG-01** (`core.test.cjs` lines 85-89):
```javascript
// Bug: loadConfig previously omitted model_overrides from return value
test('returns model_overrides when present (REG-01)', () => {
  writeConfig({ model_overrides: { 'gsd-executor': 'opus' } });
  const config = loadConfig(tmpDir);
  assert.deepStrictEqual(config.model_overrides, { 'gsd-executor': 'opus' });
});
```

**REG-04** (`frontmatter.test.cjs` lines 57-72):
```javascript
test('handles quoted commas in inline arrays — REG-04 known limitation', () => {
  // REG-04: The split(',') on line 53 does NOT respect quotes.
  // This test documents the CURRENT (buggy) behavior.
  const content = '---\nkey: ["a, b", c]\n---\n';
  const result = extractFrontmatter(content);
  // Current behavior: splits on ALL commas, producing 3 items instead of 2
  assert.ok(result.key.length > 2, 'REG-04: split produces more items than intended due to quoted comma bug');
});
```

These tests prevent regressions from being silently reintroduced.

**Edge cases tested:**
- Missing files (invalid JSON, missing directories)
- Empty inputs
- Out-of-order data requiring sorting
- Decimal phase numbers (02.1, 02.2)
- Special characters in paths and names
- Unicode/emoji in values

Example from `phase.test.cjs`:
```javascript
test('handles decimal phases in sort order', () => {
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02.1-hotfix'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02.2-patch'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-ui'), { recursive: true });

  const result = runGsdTools('phases list', tmpDir);
  assert.ok(result.success);
  const output = JSON.parse(result.output);
  assert.deepStrictEqual(output.directories, ['02-api', '02.1-hotfix', '02.2-patch', '03-ui']);
});
```

## Test Types

**Unit Tests (most tests):**
- Scope: Single function or command
- Approach: Pass in test data, verify output
- Example: `core.test.cjs` tests `loadConfig()`, `escapeRegex()`, etc. directly

**Integration Tests (via `runGsdTools()`):**
- Scope: Full CLI command execution
- Approach: Invoke tool with temp directory, verify output structure and exit code
- Example: `commands.test.cjs` tests `history-digest`, `phase list`, etc. as complete commands

**No E2E tests** — Not applicable; this is a CLI utility library, not a web service

## Coverage & Gaps

**Coverage enforcement:**
- Minimum 70% line coverage required via c8
- Only `get-shit-done/bin/lib/*.cjs` included (test files and scripts excluded from coverage calculations)

**Key modules tested:**
- `core.cjs` — Core utilities with regression tests
- `frontmatter.cjs` — YAML parser with edge cases
- `state.cjs` — State machine operations
- `phase.cjs` — Phase operations
- `commands.cjs` — All command handlers

**Coverage strategy:**
Tests focus on:
1. Happy path (normal usage)
2. Error cases (missing files, invalid input)
3. Edge cases (empty data, special characters, decimal numbers)
4. Regressions (known bugs documented as REG-XX)

## Running Tests Locally

**Full test suite:**
```bash
cd /Users/talas9/Projects/get-shit-done
npm test
```

**With coverage report:**
```bash
npm run test:coverage
```

Output shows line coverage %; must meet 70% threshold to pass.

**Single test file (direct invocation):**
```bash
node --test tests/core.test.cjs
```

## Notes on Test Maintainability

**Strengths:**
- Tests are self-contained and isolated (temp directories cleaned up)
- No external mocking library = easier to understand test intent
- Regression tests (REG-XX) prevent known bugs from reoccurring
- Integration tests via `runGsdTools()` catch CLI integration issues

**Known limitations:**
- No test runner CLI options (can't run subset of tests easily)
- Coverage threshold is enforced but not broken down by module
- Inline test data makes tests longer but more explicit

---

*Testing analysis: 2026-03-11*
