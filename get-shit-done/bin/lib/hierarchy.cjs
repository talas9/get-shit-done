/**
 * Hierarchy — Multi-agent worktree lifecycle and registry management
 *
 * Provides worktree create/remove commands and low-level registry helpers
 * used by all hierarchy-related operations.
 */

const fs = require('fs');
const path = require('path');
const { output, error, execGit, toPosixPath, loadConfig } = require('./core.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');

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

// ─── Hierarchy partition ───────────────────────────────────────────────────────

/**
 * Partition PLAN.md files in a phase directory into non-conflicting parallel streams.
 *
 * Algorithm:
 *  1. Read all *-PLAN.md files in phaseDir.
 *  2. Parse wave, depends_on, files_modified from each file's frontmatter.
 *  3. Group plans by wave (ascending).
 *  4. Within each wave, use union-find to merge plans that share any file in files_modified.
 *  5. For cross-wave deps, assign dependent plan to the same stream as its dependency.
 *  6. For plans with no overlap and no cross-wave dep, assign to the least-loaded stream.
 *  7. Cap total streams at max_l2_agents from config (default 3).
 *     When over cap, merge smallest streams together.
 *  8. Emit JSON: { streams: [{ name, plans, worktree_branch: null }] }
 *
 * Usage: hierarchy-partition <phase-dir>
 */
function cmdHierarchyPartition(cwd, phaseDir, raw) {
  if (!phaseDir) {
    error('phase directory path required');
  }

  // Resolve phase directory
  const resolvedPhaseDir = path.isAbsolute(phaseDir) ? phaseDir : path.join(cwd, phaseDir);

  // Read max_l2_agents from config
  const config = loadConfig(cwd);
  const maxStreams = (config.hierarchy && config.hierarchy.max_l2_agents) || 3;

  // Gather all *-PLAN.md files
  let planFiles = [];
  try {
    planFiles = fs.readdirSync(resolvedPhaseDir).filter(f => f.endsWith('-PLAN.md'));
  } catch {
    // Directory doesn't exist or can't be read — return empty
    output({ streams: [] }, raw, JSON.stringify({ streams: [] }));
    return;
  }

  if (planFiles.length === 0) {
    output({ streams: [] }, raw, JSON.stringify({ streams: [] }));
    return;
  }

  // Parse each plan file
  const plans = planFiles.map(fileName => {
    const filePath = path.join(resolvedPhaseDir, fileName);
    const content = fs.readFileSync(filePath, 'utf-8');
    const fm = extractFrontmatter(content);

    // Parse plan ID from filename: "01-02-PLAN.md" -> "01-02"
    const planId = fileName.replace(/-PLAN\.md$/, '');

    const wave = parseInt(fm.wave, 10) || 1;
    const depends_on = Array.isArray(fm.depends_on) ? fm.depends_on : [];
    const files_modified = Array.isArray(fm.files_modified) ? fm.files_modified : [];

    return { planId, wave, depends_on, files_modified };
  });

  // Sort by wave ascending, then by planId for stability
  plans.sort((a, b) => {
    if (a.wave !== b.wave) return a.wave - b.wave;
    return a.planId.localeCompare(b.planId);
  });

  // ─── Union-Find implementation ────────────────────────────────────────────

  const parent = {};
  function find(id) {
    if (parent[id] === undefined) parent[id] = id;
    if (parent[id] !== id) parent[id] = find(parent[id]);
    return parent[id];
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // ─── Phase 1: merge plans in the same wave that share files ──────────────

  // Process wave by wave
  const waveGroups = {};
  for (const plan of plans) {
    if (!waveGroups[plan.wave]) waveGroups[plan.wave] = [];
    waveGroups[plan.wave].push(plan);
  }

  for (const wavePlans of Object.values(waveGroups)) {
    // Build file -> planId map for this wave
    const fileToPlans = {};
    for (const plan of wavePlans) {
      for (const file of plan.files_modified) {
        if (!fileToPlans[file]) fileToPlans[file] = [];
        fileToPlans[file].push(plan.planId);
      }
    }
    // Union plans that share a file
    for (const sharingPlans of Object.values(fileToPlans)) {
      for (let i = 1; i < sharingPlans.length; i++) {
        union(sharingPlans[0], sharingPlans[i]);
      }
    }
  }

  // ─── Phase 2: merge cross-wave dependencies into the same group ───────────

  for (const plan of plans) {
    for (const dep of plan.depends_on) {
      // If the dependency plan exists in our list, union them
      if (plans.find(p => p.planId === dep)) {
        union(plan.planId, dep);
      }
    }
  }

  // ─── Phase 3: assign each union-find group to a stream ───────────────────

  // Collect all root -> [planIds] groups (preserving sorted order)
  const groupMap = {};
  for (const plan of plans) {
    const root = find(plan.planId);
    if (!groupMap[root]) groupMap[root] = [];
    groupMap[root].push(plan.planId);
  }

  // Streams start as one stream per group
  let streams = Object.values(groupMap);

  // ─── Phase 4: cap streams at maxStreams by merging smallest ──────────────

  while (streams.length > maxStreams) {
    // Sort by size ascending to merge the two smallest
    streams.sort((a, b) => a.length - b.length);
    // Merge the two smallest streams
    const merged = streams[0].concat(streams[1]);
    streams = [merged, ...streams.slice(2)];
  }

  // ─── Phase 5: sort plans within each stream by wave order ─────────────────

  const waveOf = {};
  for (const plan of plans) {
    waveOf[plan.planId] = plan.wave;
  }

  for (const stream of streams) {
    stream.sort((a, b) => {
      const wa = waveOf[a] || 0;
      const wb = waveOf[b] || 0;
      if (wa !== wb) return wa - wb;
      return a.localeCompare(b);
    });
  }

  // Sort streams by their first plan's wave for deterministic ordering
  streams.sort((a, b) => {
    const wa = waveOf[a[0]] || 0;
    const wb = waveOf[b[0]] || 0;
    if (wa !== wb) return wa - wb;
    return a[0].localeCompare(b[0]);
  });

  // ─── Phase 6: generate stream names and output ────────────────────────────

  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const result = {
    streams: streams.map((planIds, i) => ({
      name: `stream-${alphabet[i] || String(i)}`,
      plans: planIds,
      worktree_branch: null,
    })),
  };

  // Human-readable output when not --raw
  if (!raw) {
    const lines = [`Partition: ${result.streams.length} stream(s)\n`];
    for (const stream of result.streams) {
      lines.push(`${stream.name}:`);
      for (const planId of stream.plans) {
        lines.push(`  - ${planId}`);
      }
    }
    process.stdout.write(lines.join('\n') + '\n');
    process.exit(0);
  }

  output(result, raw, JSON.stringify(result));
}

module.exports = {
  readRegistry,
  writeRegistry,
  cmdWorktreeCreate,
  cmdWorktreeRemove,
  cmdHierarchyPartition,
};
