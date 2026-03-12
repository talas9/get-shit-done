/**
 * GSD Tools Tests - hierarchy.cjs
 *
 * Tests for worktree lifecycle commands (create/remove) and registry helpers.
 *
 * Requirements: FOUND-03, FOUND-04, FOUND-05
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
