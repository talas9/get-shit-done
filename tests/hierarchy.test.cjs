/**
 * GSD Tools Tests - hierarchy.cjs
 *
 * Tests for worktree lifecycle commands (create/remove), registry helpers,
 * and state-reconcile merge logic.
 *
 * Requirements: FOUND-03, FOUND-04, FOUND-05, FOUND-06
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { createTempGitProject, cleanup } = require('./helpers.cjs');

const {
  readRegistry,
  writeRegistry,
  cmdWorktreeCreate,
  cmdWorktreeRemove,
  cmdStateReconcile,
  cmdHierarchyPartition,
} = require('../get-shit-done/bin/lib/hierarchy.cjs');

// ─── readRegistry / writeRegistry ─────────────────────────────────────────────

describe('readRegistry', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-hierarchy-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // FOUND-05a: missing registry file
  test('returns { worktrees: [] } when registry file is missing (FOUND-05a)', () => {
    const result = readRegistry(tmpDir);
    assert.deepStrictEqual(result, { worktrees: [] });
  });

  // FOUND-05b: corrupt registry file
  test('returns { worktrees: [] } when registry file contains corrupt JSON (FOUND-05b)', () => {
    const registryPath = path.join(tmpDir, '.planning', 'worktree-registry.json');
    fs.writeFileSync(registryPath, 'not valid json {{{{', 'utf-8');
    const result = readRegistry(tmpDir);
    assert.deepStrictEqual(result, { worktrees: [] });
  });

  // FOUND-05c: round-trip
  test('round-trips data written by writeRegistry (FOUND-05c)', () => {
    const data = {
      worktrees: [
        { stream: 'backend', branch: 'gsd/hierarchy/2026-03-12T06-00-00-backend', path: '.claude/worktrees/backend', created_at: '2026-03-12T06:00:00Z', status: 'active' },
      ],
    };
    writeRegistry(tmpDir, data);
    const result = readRegistry(tmpDir);
    assert.deepStrictEqual(result, data);
  });
});

describe('writeRegistry', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-hierarchy-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes valid JSON to .planning/worktree-registry.json', () => {
    const data = { worktrees: [] };
    writeRegistry(tmpDir, data);
    const registryPath = path.join(tmpDir, '.planning', 'worktree-registry.json');
    assert.ok(fs.existsSync(registryPath), 'registry file should be created');
    const raw = fs.readFileSync(registryPath, 'utf-8');
    const parsed = JSON.parse(raw);
    assert.deepStrictEqual(parsed, data);
  });

  test('writes with 2-space indentation', () => {
    const data = { worktrees: [] };
    writeRegistry(tmpDir, data);
    const registryPath = path.join(tmpDir, '.planning', 'worktree-registry.json');
    const raw = fs.readFileSync(registryPath, 'utf-8');
    assert.ok(raw.includes('  '), 'should use 2-space indentation');
  });
});

// ─── cmdWorktreeCreate ────────────────────────────────────────────────────────

describe('cmdWorktreeCreate', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject();
  });

  afterEach(() => {
    // Clean up any worktrees before removing the directory
    try {
      const worktreePath = path.join(tmpDir, '.claude', 'worktrees', 'test-stream');
      if (fs.existsSync(worktreePath)) {
        execSync(`git worktree remove --force "${worktreePath}"`, { cwd: tmpDir, stdio: 'pipe' });
      }
    } catch { /* ignore */ }
    cleanup(tmpDir);
  });

  // FOUND-03a: branch name format
  test('generates branch name matching gsd/hierarchy/YYYY-MM-DDTHH-MM-SS-{streamName} pattern (FOUND-03a)', () => {
    // We intercept the output by capturing what gets registered
    const beforeCreate = Date.now();
    cmdWorktreeCreate(tmpDir, 'test-stream', false);

    const registry = readRegistry(tmpDir);
    assert.strictEqual(registry.worktrees.length, 1, 'should have one registry entry');
    const entry = registry.worktrees[0];
    const branchPattern = /^gsd\/hierarchy\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-test-stream$/;
    assert.ok(branchPattern.test(entry.branch), `branch "${entry.branch}" should match pattern`);
  });

  // FOUND-03b: calls git worktree add with -b flag
  test('registers entry with all required fields (FOUND-03b)', () => {
    cmdWorktreeCreate(tmpDir, 'my-stream', false);

    const registry = readRegistry(tmpDir);
    assert.strictEqual(registry.worktrees.length, 1);
    const entry = registry.worktrees[0];
    assert.strictEqual(entry.stream, 'my-stream');
    assert.ok(typeof entry.branch === 'string' && entry.branch.length > 0, 'branch should be a non-empty string');
    assert.ok(typeof entry.path === 'string' && entry.path.length > 0, 'path should be a non-empty string');
    assert.ok(typeof entry.created_at === 'string' && entry.created_at.length > 0, 'created_at should be a non-empty string');
    assert.strictEqual(entry.status, 'active');
  });

  // FOUND-03c: worktree directory is created
  test('creates git worktree on disk (FOUND-03c)', () => {
    cmdWorktreeCreate(tmpDir, 'disk-stream', false);

    const worktreePath = path.join(tmpDir, '.claude', 'worktrees', 'disk-stream');
    assert.ok(fs.existsSync(worktreePath), 'worktree directory should exist on disk');
  });

  // VALID-04: return-value shape
  test('returns { created: true, stream, branch, path } on success (VALID-04)', () => {
    let captured = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (str) => { captured += str; return true; };
    try {
      cmdWorktreeCreate(tmpDir, 'shape-stream', false);
    } catch { /* process.exit(0) throws in test environment */ }
    finally {
      process.stdout.write = origWrite;
    }
    const result = JSON.parse(captured);
    assert.strictEqual(result.created, true, 'created should be true');
    assert.strictEqual(result.stream, 'shape-stream', 'stream should match');
    assert.ok(typeof result.branch === 'string' && result.branch.length > 0, 'branch should be a non-empty string');
    assert.ok(typeof result.path === 'string' && result.path.length > 0, 'path should be a non-empty string');
  });
});

// ─── cmdWorktreeRemove ────────────────────────────────────────────────────────

describe('cmdWorktreeRemove', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // FOUND-04a: removes worktree directory, branch, registry entry
  test('removes worktree directory, branch, and registry entry (FOUND-04a)', () => {
    // First create a worktree
    cmdWorktreeCreate(tmpDir, 'remove-stream', false);

    const registry = readRegistry(tmpDir);
    assert.strictEqual(registry.worktrees.length, 1, 'registry should have entry after create');

    const entry = registry.worktrees[0];
    const worktreePath = path.join(tmpDir, '.claude', 'worktrees', 'remove-stream');
    assert.ok(fs.existsSync(worktreePath), 'worktree should exist before remove');

    // Now remove
    cmdWorktreeRemove(tmpDir, 'remove-stream', false, false);

    const updatedRegistry = readRegistry(tmpDir);
    assert.strictEqual(updatedRegistry.worktrees.length, 0, 'registry should be empty after remove');
    assert.ok(!fs.existsSync(worktreePath), 'worktree directory should be gone after remove');
  });

  // FOUND-04b: --force succeeds even when worktree directory is missing
  test('--force succeeds when worktree directory does not exist on disk (FOUND-04b)', () => {
    // Create a registry entry manually (orphaned — no real worktree)
    const orphanedEntry = {
      stream: 'orphan-stream',
      branch: 'gsd/hierarchy/2026-03-12T06-00-00-orphan-stream',
      path: '.claude/worktrees/orphan-stream',
      created_at: '2026-03-12T06:00:00Z',
      status: 'active',
    };
    writeRegistry(tmpDir, { worktrees: [orphanedEntry] });

    // Directory does not exist
    const orphanPath = path.join(tmpDir, '.claude', 'worktrees', 'orphan-stream');
    assert.ok(!fs.existsSync(orphanPath), 'orphan path should not exist');

    // Should succeed without throwing
    assert.doesNotThrow(() => {
      cmdWorktreeRemove(tmpDir, 'orphan-stream', true, false);
    });

    // Registry entry should be removed
    const updatedRegistry = readRegistry(tmpDir);
    assert.strictEqual(updatedRegistry.worktrees.length, 0, 'registry should be empty after force remove');
  });

  // VALID-04: return-value shape
  test('returns { removed: true, stream } on successful removal (VALID-04)', () => {
    cmdWorktreeCreate(tmpDir, 'remove-shape-stream', false);

    let captured = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (str) => { captured += str; return true; };
    try {
      cmdWorktreeRemove(tmpDir, 'remove-shape-stream', false, false);
    } catch { /* process.exit(0) throws in test environment */ }
    finally {
      process.stdout.write = origWrite;
    }
    const result = JSON.parse(captured);
    assert.strictEqual(result.removed, true, 'removed should be true');
    assert.strictEqual(result.stream, 'remove-shape-stream', 'stream should match');
  });

  // FOUND-04c: removes registry entry even when git operations fail (self-healing)
  test('removes registry entry even for orphaned entries (FOUND-04c)', () => {
    // Write an orphaned registry entry where branch was already deleted
    writeRegistry(tmpDir, {
      worktrees: [
        {
          stream: 'stale-stream',
          branch: 'gsd/hierarchy/2026-01-01T00-00-00-stale-stream',
          path: '.claude/worktrees/stale-stream',
          created_at: '2026-01-01T00:00:00Z',
          status: 'active',
        },
      ],
    });

    // Force remove (directory doesn't exist, branch doesn't exist)
    cmdWorktreeRemove(tmpDir, 'stale-stream', true, false);

    // Registry should be cleaned up regardless of git failures
    const updatedRegistry = readRegistry(tmpDir);
    assert.strictEqual(updatedRegistry.worktrees.length, 0, 'stale entry should be removed from registry');
  });
});

// ─── cmdHierarchyPartition ────────────────────────────────────────────────────

/**
 * Helper: write a PLAN.md file to a temp phase directory with specified frontmatter.
 */
function writePlanFile(phaseDir, planId, frontmatterFields) {
  const fileName = `${planId}-PLAN.md`;
  const fields = Object.entries(frontmatterFields)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        if (v.length === 0) return `${k}: []`;
        return `${k}:\n${v.map(item => `  - ${item}`).join('\n')}`;
      }
      return `${k}: ${v}`;
    })
    .join('\n');
  const content = `---\n${fields}\n---\n\n# Plan ${planId}\n`;
  fs.writeFileSync(path.join(phaseDir, fileName), content, 'utf-8');
}

/** Capture stdout from a function that calls process.stdout.write then process.exit(0). */
function captureOutput(fn) {
  let captured = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (str) => { captured += str; return true; };
  try {
    fn();
  } catch { /* process.exit(0) throws in test environment — ignore */ }
  finally {
    process.stdout.write = origWrite;
  }
  return captured;
}

describe('cmdHierarchyPartition', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-partition-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    // Default config: max_l2_agents = 3
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ hierarchy: { max_l2_agents: 3 } }, null, 2),
      'utf-8'
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Empty directory
  test('returns { streams: [] } for an empty phase directory', () => {
    const phaseDir = path.join(tmpDir, 'empty-phase');
    fs.mkdirSync(phaseDir);
    const raw = captureOutput(() => cmdHierarchyPartition(tmpDir, phaseDir, true));
    const result = JSON.parse(raw);
    assert.deepStrictEqual(result, { streams: [] });
  });

  // FOUND-02a: Wave grouping
  test('groups plans by ascending wave order, all plans present (FOUND-02a)', () => {
    const phaseDir = path.join(tmpDir, 'wave-phase');
    fs.mkdirSync(phaseDir);
    writePlanFile(phaseDir, '01-01', { wave: 1, depends_on: [], files_modified: ['src/a.ts'] });
    writePlanFile(phaseDir, '01-02', { wave: 2, depends_on: [], files_modified: ['src/b.ts'] });
    writePlanFile(phaseDir, '01-03', { wave: 3, depends_on: [], files_modified: ['src/c.ts'] });

    const raw = captureOutput(() => cmdHierarchyPartition(tmpDir, phaseDir, true));
    const result = JSON.parse(raw);
    assert.ok(Array.isArray(result.streams), 'result.streams should be an array');
    const allPlans = result.streams.flatMap(s => s.plans);
    assert.ok(allPlans.includes('01-01'), 'should include plan 01-01');
    assert.ok(allPlans.includes('01-02'), 'should include plan 01-02');
    assert.ok(allPlans.includes('01-03'), 'should include plan 01-03');
    // Plans within each stream must appear in wave order
    const waveOf = { '01-01': 1, '01-02': 2, '01-03': 3 };
    for (const stream of result.streams) {
      const waves = stream.plans.map(p => waveOf[p] || 0);
      for (let i = 1; i < waves.length; i++) {
        assert.ok(waves[i] >= waves[i - 1], 'plans within stream should be in ascending wave order');
      }
    }
  });

  // FOUND-02b: Cross-wave dependency stays sequential in same stream
  test('keeps cross-wave dependent plan sequential in same stream as its dependency (FOUND-02b)', () => {
    const phaseDir = path.join(tmpDir, 'dep-phase');
    fs.mkdirSync(phaseDir);
    writePlanFile(phaseDir, '01-01', { wave: 1, depends_on: [], files_modified: ['src/a.ts'] });
    writePlanFile(phaseDir, '01-02', { wave: 2, depends_on: ['01-01'], files_modified: ['src/b.ts'] });

    const raw = captureOutput(() => cmdHierarchyPartition(tmpDir, phaseDir, true));
    const result = JSON.parse(raw);
    const streamWithBoth = result.streams.find(s => s.plans.includes('01-01') && s.plans.includes('01-02'));
    assert.ok(streamWithBoth, '01-01 and 01-02 should be in the same stream (cross-wave dep)');
    const idx01 = streamWithBoth.plans.indexOf('01-01');
    const idx02 = streamWithBoth.plans.indexOf('01-02');
    assert.ok(idx01 < idx02, '01-01 should appear before 01-02 in the stream');
  });

  // FOUND-02c: Non-overlapping same-wave plans go to separate streams
  test('assigns non-overlapping same-wave plans to separate streams (FOUND-02c)', () => {
    const phaseDir = path.join(tmpDir, 'no-overlap-phase');
    fs.mkdirSync(phaseDir);
    writePlanFile(phaseDir, '01-01', { wave: 1, depends_on: [], files_modified: ['src/a.ts'] });
    writePlanFile(phaseDir, '01-02', { wave: 1, depends_on: [], files_modified: ['src/b.ts'] });

    const raw = captureOutput(() => cmdHierarchyPartition(tmpDir, phaseDir, true));
    const result = JSON.parse(raw);
    const stream01 = result.streams.find(s => s.plans.includes('01-01'));
    const stream02 = result.streams.find(s => s.plans.includes('01-02'));
    assert.ok(stream01, '01-01 should be in a stream');
    assert.ok(stream02, '01-02 should be in a stream');
    assert.notStrictEqual(stream01.name, stream02.name, '01-01 and 01-02 should be in different streams');
  });

  // FOUND-02c-overlap: Overlapping files in same wave go to same stream
  test('assigns same-wave plans sharing a file to the same stream (FOUND-02c-overlap)', () => {
    const phaseDir = path.join(tmpDir, 'overlap-phase');
    fs.mkdirSync(phaseDir);
    writePlanFile(phaseDir, '01-01', { wave: 1, depends_on: [], files_modified: ['src/shared.ts'] });
    writePlanFile(phaseDir, '01-02', { wave: 1, depends_on: [], files_modified: ['src/shared.ts'] });

    const raw = captureOutput(() => cmdHierarchyPartition(tmpDir, phaseDir, true));
    const result = JSON.parse(raw);
    const streamWithBoth = result.streams.find(s => s.plans.includes('01-01') && s.plans.includes('01-02'));
    assert.ok(streamWithBoth, 'Plans sharing a file should be in the same stream');
  });

  // FOUND-02d: Stream count capped at max_l2_agents
  test('caps total streams at max_l2_agents when there are more non-overlapping plans (FOUND-02d)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ hierarchy: { max_l2_agents: 2 } }, null, 2),
      'utf-8'
    );
    const phaseDir = path.join(tmpDir, 'cap-phase');
    fs.mkdirSync(phaseDir);
    for (let i = 1; i <= 5; i++) {
      writePlanFile(phaseDir, `01-0${i}`, { wave: 1, depends_on: [], files_modified: [`src/file${i}.ts`] });
    }

    const raw = captureOutput(() => cmdHierarchyPartition(tmpDir, phaseDir, true));
    const result = JSON.parse(raw);
    assert.ok(result.streams.length <= 2, `stream count ${result.streams.length} should be <= 2`);
    const allPlans = result.streams.flatMap(s => s.plans);
    assert.strictEqual(allPlans.length, 5, 'all 5 plans should be present across capped streams');
  });

  // Single plan
  test('single plan returns exactly one stream with that plan', () => {
    const phaseDir = path.join(tmpDir, 'single-phase');
    fs.mkdirSync(phaseDir);
    writePlanFile(phaseDir, '01-01', { wave: 1, depends_on: [], files_modified: ['src/a.ts'] });

    const raw = captureOutput(() => cmdHierarchyPartition(tmpDir, phaseDir, true));
    const result = JSON.parse(raw);
    assert.strictEqual(result.streams.length, 1);
    assert.deepStrictEqual(result.streams[0].plans, ['01-01']);
    assert.strictEqual(result.streams[0].worktree_branch, null);
  });

  // Plan with no files_modified: no overlap
  test('plan with empty files_modified does not cause file overlap with other plans', () => {
    const phaseDir = path.join(tmpDir, 'nofiles-phase');
    fs.mkdirSync(phaseDir);
    writePlanFile(phaseDir, '01-01', { wave: 1, depends_on: [], files_modified: ['src/a.ts'] });
    writePlanFile(phaseDir, '01-02', { wave: 1, depends_on: [], files_modified: [] });

    const raw = captureOutput(() => cmdHierarchyPartition(tmpDir, phaseDir, true));
    const result = JSON.parse(raw);
    const allPlans = result.streams.flatMap(s => s.plans);
    assert.ok(allPlans.includes('01-01'), 'should include 01-01');
    assert.ok(allPlans.includes('01-02'), 'should include 01-02');
    // Streams should have correct shape
    for (const stream of result.streams) {
      assert.ok(typeof stream.name === 'string', 'stream.name should be a string');
      assert.ok(Array.isArray(stream.plans), 'stream.plans should be an array');
      assert.strictEqual(stream.worktree_branch, null, 'worktree_branch should be null');
    }
  });

  // Output shape validation
  test('stream objects have name, plans, and worktree_branch: null', () => {
    const phaseDir = path.join(tmpDir, 'shape-phase');
    fs.mkdirSync(phaseDir);
    writePlanFile(phaseDir, '01-01', { wave: 1, depends_on: [], files_modified: ['src/a.ts'] });

    const raw = captureOutput(() => cmdHierarchyPartition(tmpDir, phaseDir, true));
    const result = JSON.parse(raw);
    assert.ok(result.streams.length > 0, 'should have at least one stream');
    const stream = result.streams[0];
    assert.ok(typeof stream.name === 'string', 'stream.name should be a string');
    assert.ok(Array.isArray(stream.plans), 'stream.plans should be an array');
    assert.strictEqual(stream.worktree_branch, null, 'worktree_branch should be null');
  });
});

// ─── cmdStateReconcile ────────────────────────────────────────────────────────

// Helper to build a STATE.md string with given parameters
function buildStateContent({
  lastUpdated = '2026-01-01T00:00:00Z',
  status = 'planning',
  stoppedAt = 'Completed plan',
  completedPlans = 0,
  decisions = [],
  todos = [],
  sessionInfo = 'Last session: 2026-01-01\nStopped at: Some plan',
} = {}) {
  return `---
gsd_state_version: 1.0
milestone: v1.0
status: ${status}
stopped_at: ${stoppedAt}
last_updated: "${lastUpdated}"
progress:
  completed_plans: ${completedPlans}
  total_plans: 10
---

# Project State

## Current Position

Status: ${status}

## Performance Metrics

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

## Accumulated Context

### Decisions

${decisions.length > 0 ? decisions.map(d => `- ${d}`).join('\n') : 'None yet.'}

### Pending Todos

${todos.length > 0 ? todos.map(t => `- ${t}`).join('\n') : 'None yet.'}

### Blockers/Concerns

None.

## Session Continuity

${sessionInfo}
`;
}

describe('cmdStateReconcile', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-reconcile-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // FOUND-06a: reads STATE.md from each registered worktree path
  test('reads STATE.md from each worktree path on disk (FOUND-06a)', () => {
    const wt1Dir = path.join(tmpDir, '.claude', 'worktrees', 'backend');
    const wt2Dir = path.join(tmpDir, '.claude', 'worktrees', 'frontend');
    fs.mkdirSync(path.join(wt1Dir, '.planning'), { recursive: true });
    fs.mkdirSync(path.join(wt2Dir, '.planning'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      buildStateContent({ lastUpdated: '2026-01-01T00:00:00Z', decisions: ['Decision from main'] }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(wt1Dir, '.planning', 'STATE.md'),
      buildStateContent({ lastUpdated: '2026-02-01T00:00:00Z', decisions: ['Decision from backend'] }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(wt2Dir, '.planning', 'STATE.md'),
      buildStateContent({ lastUpdated: '2026-03-01T00:00:00Z', decisions: ['Decision from frontend'] }),
      'utf-8'
    );

    writeRegistry(tmpDir, {
      worktrees: [
        { stream: 'backend', branch: 'gsd/hierarchy/2026-01-01T00-00-00-backend', path: '.claude/worktrees/backend', created_at: '2026-01-01T00:00:00Z', status: 'active' },
        { stream: 'frontend', branch: 'gsd/hierarchy/2026-01-01T00-00-00-frontend', path: '.claude/worktrees/frontend', created_at: '2026-01-01T00:00:00Z', status: 'active' },
      ],
    });

    assert.doesNotThrow(() => {
      cmdStateReconcile(tmpDir, false);
    });

    const merged = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(merged.includes('Decision from main'), 'merged STATE.md should contain decision from main');
    assert.ok(merged.includes('Decision from backend'), 'merged STATE.md should contain decision from backend');
    assert.ok(merged.includes('Decision from frontend'), 'merged STATE.md should contain decision from frontend');
  });

  // FOUND-06b: appends records without duplicates
  test('appends decisions from worktrees without duplicates (FOUND-06b)', () => {
    const wt1Dir = path.join(tmpDir, '.claude', 'worktrees', 'wt1');
    fs.mkdirSync(path.join(wt1Dir, '.planning'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      buildStateContent({ lastUpdated: '2026-01-01T00:00:00Z', decisions: ['Shared decision'] }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(wt1Dir, '.planning', 'STATE.md'),
      buildStateContent({ lastUpdated: '2026-02-01T00:00:00Z', decisions: ['Shared decision', 'Extra decision 1', 'Extra decision 2'] }),
      'utf-8'
    );

    writeRegistry(tmpDir, {
      worktrees: [
        { stream: 'wt1', branch: 'gsd/hierarchy/wt1', path: '.claude/worktrees/wt1', created_at: '2026-01-01T00:00:00Z', status: 'active' },
      ],
    });

    cmdStateReconcile(tmpDir, false);

    const merged = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    const sharedCount = (merged.match(/- Shared decision/g) || []).length;
    assert.strictEqual(sharedCount, 1, 'duplicate decisions should be deduplicated');
    assert.ok(merged.includes('Extra decision 1'), 'Extra decision 1 should be present');
    assert.ok(merged.includes('Extra decision 2'), 'Extra decision 2 should be present');
  });

  // FOUND-06c: last-write-wins by timestamp for scalar frontmatter fields
  test('uses last-write-wins by timestamp for scalar frontmatter fields (FOUND-06c)', () => {
    const wt1Dir = path.join(tmpDir, '.claude', 'worktrees', 'wt1');
    fs.mkdirSync(path.join(wt1Dir, '.planning'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      buildStateContent({ lastUpdated: '2026-01-01T00:00:00Z', status: 'planning', stoppedAt: 'Old plan' }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(wt1Dir, '.planning', 'STATE.md'),
      buildStateContent({ lastUpdated: '2026-03-12T00:00:00Z', status: 'executing', stoppedAt: 'Newer plan' }),
      'utf-8'
    );

    writeRegistry(tmpDir, {
      worktrees: [
        { stream: 'wt1', branch: 'gsd/hierarchy/wt1', path: '.claude/worktrees/wt1', created_at: '2026-01-01T00:00:00Z', status: 'active' },
      ],
    });

    cmdStateReconcile(tmpDir, false);

    const merged = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(merged.includes('2026-03-12T00:00:00Z'), 'newer last_updated should win');
    const hasNewerValue = merged.includes('Newer plan') || merged.includes('executing');
    assert.ok(hasNewerValue, 'newer scalar values from worktree should win');
  });

  // FOUND-06d: exactly one YAML frontmatter block
  test('output has exactly one YAML frontmatter block (FOUND-06d)', () => {
    const wt1Dir = path.join(tmpDir, '.claude', 'worktrees', 'wt1');
    fs.mkdirSync(path.join(wt1Dir, '.planning'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      buildStateContent({ lastUpdated: '2026-01-01T00:00:00Z' }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(wt1Dir, '.planning', 'STATE.md'),
      buildStateContent({ lastUpdated: '2026-03-12T00:00:00Z' }),
      'utf-8'
    );

    writeRegistry(tmpDir, {
      worktrees: [
        { stream: 'wt1', branch: 'gsd/hierarchy/wt1', path: '.claude/worktrees/wt1', created_at: '2026-01-01T00:00:00Z', status: 'active' },
      ],
    });

    cmdStateReconcile(tmpDir, false);

    const merged = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    const dashCount = (merged.match(/^---$/gm) || []).length;
    assert.strictEqual(dashCount, 2, `should have exactly 2 --- markers, found ${dashCount}`);
    const metricsCount = (merged.match(/^## Performance Metrics/gm) || []).length;
    assert.strictEqual(metricsCount, 1, 'should have exactly one Performance Metrics section');
    const decisionsCount = (merged.match(/^### Decisions/gm) || []).length;
    assert.strictEqual(decisionsCount, 1, 'should have exactly one Decisions section');
  });

  // Edge case: missing worktree STATE.md is skipped gracefully
  test('skips worktrees with missing STATE.md gracefully', () => {
    const wt1Dir = path.join(tmpDir, '.claude', 'worktrees', 'missing-wt');
    fs.mkdirSync(wt1Dir, { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      buildStateContent({ lastUpdated: '2026-01-01T00:00:00Z', decisions: ['Main decision'] }),
      'utf-8'
    );

    writeRegistry(tmpDir, {
      worktrees: [
        { stream: 'missing-wt', branch: 'gsd/hierarchy/missing-wt', path: '.claude/worktrees/missing-wt', created_at: '2026-01-01T00:00:00Z', status: 'active' },
      ],
    });

    assert.doesNotThrow(() => {
      cmdStateReconcile(tmpDir, false);
    });

    const result = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(result.includes('Main decision'), 'main decisions should still be present');
  });

  // VALID-04: return-value shape
  test('returns { merged: true, worktrees_merged: N } on successful reconcile (VALID-04)', () => {
    const wt1Dir = path.join(tmpDir, '.claude', 'worktrees', 'reconcile-shape-wt');
    fs.mkdirSync(path.join(wt1Dir, '.planning'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      buildStateContent({ lastUpdated: '2026-01-01T00:00:00Z', decisions: ['Main decision'] }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(wt1Dir, '.planning', 'STATE.md'),
      buildStateContent({ lastUpdated: '2026-03-01T00:00:00Z', decisions: ['WT decision'] }),
      'utf-8'
    );

    writeRegistry(tmpDir, {
      worktrees: [
        { stream: 'reconcile-shape-wt', branch: 'gsd/hierarchy/wt', path: '.claude/worktrees/reconcile-shape-wt', created_at: '2026-01-01T00:00:00Z', status: 'active' },
      ],
    });

    let captured = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (str) => { captured += str; return true; };
    try {
      cmdStateReconcile(tmpDir, false);
    } catch { /* process.exit(0) throws in test environment */ }
    finally {
      process.stdout.write = origWrite;
    }
    const result = JSON.parse(captured);
    assert.strictEqual(result.merged, true, 'merged should be true');
    assert.strictEqual(typeof result.worktrees_merged, 'number', 'worktrees_merged should be a number');
    assert.strictEqual(result.worktrees_merged, 1, 'worktrees_merged should be 1');
  });

  // Edge case: empty registry produces no changes
  test('empty registry produces no changes to main STATE.md', () => {
    const originalContent = buildStateContent({
      lastUpdated: '2026-01-01T00:00:00Z',
      decisions: ['Keep this decision'],
    });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), originalContent, 'utf-8');
    writeRegistry(tmpDir, { worktrees: [] });

    cmdStateReconcile(tmpDir, false);

    const result = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(result.includes('Keep this decision'), 'decisions should be preserved when no worktrees registered');
  });
});
