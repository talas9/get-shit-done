/**
 * Hierarchy — Multi-agent worktree lifecycle and registry management
 *
 * Provides worktree create/remove commands and low-level registry helpers
 * used by all hierarchy-related operations.
 */

const fs = require('fs');
const path = require('path');
const { output, error, execGit, toPosixPath } = require('./core.cjs');

// ─── Registry helpers ─────────────────────────────────────────────────────────

const REGISTRY_PATH_RELATIVE = path.join('.planning', 'worktree-registry.json');

/**
 * Read worktree registry from .planning/worktree-registry.json.
 * Returns { worktrees: [] } when the file is missing or contains corrupt JSON.
 */
function readRegistry(cwd) {
  const registryPath = path.join(cwd, REGISTRY_PATH_RELATIVE);
  try {
    const raw = fs.readFileSync(registryPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.worktrees)) {
      return parsed;
    }
    return { worktrees: [] };
  } catch {
    return { worktrees: [] };
  }
}

/**
 * Write worktree registry to .planning/worktree-registry.json.
 */
function writeRegistry(cwd, data) {
  const registryPath = path.join(cwd, REGISTRY_PATH_RELATIVE);
  fs.writeFileSync(registryPath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Worktree lifecycle commands ──────────────────────────────────────────────

/**
 * Create a new git worktree for a hierarchy stream.
 *
 * Generates a timestamped branch name, runs `git worktree add -b`, then
 * registers the entry in worktree-registry.json.
 *
 * Usage: worktree-create <streamName>
 */
function cmdWorktreeCreate(cwd, streamName, raw) {
  if (!streamName) {
    error('Usage: worktree-create <stream-name>');
  }

  // Generate ISO timestamp with colons/dots replaced by dashes (slice to 19 chars = YYYY-MM-DDTHH-MM-SS)
  const isoTimestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const branch = `gsd/hierarchy/${isoTimestamp}-${streamName}`;
  const worktreePath = path.join(cwd, '.claude', 'worktrees', streamName);

  const result = execGit(cwd, ['worktree', 'add', worktreePath, '-b', branch]);
  if (result.exitCode !== 0) {
    error(`Failed to create worktree: ${result.stderr}`);
  }

  // Register entry in registry
  const registry = readRegistry(cwd);
  const relativePath = toPosixPath(path.relative(cwd, worktreePath));
  registry.worktrees.push({
    stream: streamName,
    branch,
    path: relativePath,
    created_at: new Date().toISOString(),
    status: 'active',
  });
  writeRegistry(cwd, registry);

  const outputResult = {
    created: true,
    stream: streamName,
    branch,
    path: relativePath,
  };
  output(outputResult, raw, `worktree created: ${streamName}`);
}

/**
 * Remove a git worktree for a hierarchy stream.
 *
 * Removes the worktree directory, deletes the branch, then removes the
 * registry entry. With --force, succeeds even when the directory is missing.
 *
 * Usage: worktree-remove <streamName> [--force]
 */
function cmdWorktreeRemove(cwd, streamName, force, raw) {
  if (!streamName) {
    error('Usage: worktree-remove <stream-name> [--force]');
  }

  const registry = readRegistry(cwd);
  const entry = registry.worktrees.find(w => w.stream === streamName);

  // Compute absolute path from registry entry or default convention
  let absolutePath;
  if (entry) {
    absolutePath = path.isAbsolute(entry.path)
      ? entry.path
      : path.join(cwd, entry.path);
  } else {
    absolutePath = path.join(cwd, '.claude', 'worktrees', streamName);
  }

  // Remove worktree directory if it exists
  if (fs.existsSync(absolutePath)) {
    const removeResult = execGit(cwd, ['worktree', 'remove', '--force', absolutePath]);
    if (removeResult.exitCode !== 0 && !force) {
      error(`Failed to remove worktree: ${removeResult.stderr}`);
    }
  }

  // Delete the branch (ignore failures — branch may already be gone)
  if (entry && entry.branch) {
    execGit(cwd, ['branch', '-D', entry.branch]);
  }

  // Remove entry from registry
  registry.worktrees = registry.worktrees.filter(w => w.stream !== streamName);
  writeRegistry(cwd, registry);

  const outputResult = { removed: true, stream: streamName };
  output(outputResult, raw, `worktree removed: ${streamName}`);
}

module.exports = {
  readRegistry,
  writeRegistry,
  cmdWorktreeCreate,
  cmdWorktreeRemove,
};
