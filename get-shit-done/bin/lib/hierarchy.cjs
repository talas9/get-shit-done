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

// ─── State reconcile ──────────────────────────────────────────────────────────

/**
 * Parse a STATE.md file into { frontmatter, body }.
 *
 * The body is split into named sections keyed by the section header string.
 * Sections are stored in order in a Map for deterministic reconstruction.
 */
function parseStateMd(content) {
  // Extract frontmatter (between first two --- lines)
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  const rawFrontmatter = fmMatch ? fmMatch[1] : '';
  const bodyStart = fmMatch ? fmMatch[0].length : 0;
  const bodyContent = content.slice(bodyStart);

  // Parse frontmatter as a simple key:value map (no full YAML)
  const fm = {};
  for (const line of rawFrontmatter.split('\n')) {
    const m = line.match(/^([a-zA-Z0-9_]+):\s*(.*)/);
    if (m) {
      fm[m[1]] = m[2].replace(/^"|"$/g, '').trim();
    }
    // Capture nested progress fields (indented)
    const nested = line.match(/^\s{2}([a-zA-Z0-9_]+):\s*(.*)/);
    if (nested) {
      if (!fm.progress) fm.progress = {};
      if (typeof fm.progress === 'object') {
        fm.progress[nested[1]] = nested[2].trim();
      }
    }
  }
  fm._rawFrontmatter = rawFrontmatter;

  // Split body into sections by ## headers, preserving order
  const sections = new Map();
  const sectionPattern = /^(#{1,3} .+)$/gm;
  let lastHeader = null;
  let lastIndex = 0;

  const matches = [...bodyContent.matchAll(sectionPattern)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (lastHeader !== null) {
      sections.set(lastHeader, bodyContent.slice(lastIndex, m.index));
    }
    lastHeader = m[1];
    lastIndex = m.index + m[1].length;
  }
  if (lastHeader !== null) {
    sections.set(lastHeader, bodyContent.slice(lastIndex));
  }

  return { fm, sections };
}

/**
 * Extract list items (lines starting with "- ") from a section body string.
 * Returns an array of trimmed item strings.
 */
function extractListItems(sectionBody) {
  const items = [];
  for (const line of sectionBody.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      items.push(trimmed.slice(2).trim());
    }
  }
  return items;
}

/**
 * Merge STATE.md changes from all registered worktrees back to main STATE.md.
 *
 * Merge rules:
 * - Frontmatter scalars (status, stopped_at, last_updated, last_activity):
 *   last-write-wins by last_updated ISO timestamp comparison.
 * - progress.completed_plans: take highest value.
 * - ## Performance Metrics: append new rows (deduplicated).
 * - ### Decisions / ### Pending Todos: append new items (deduplicated).
 * - ## Session Continuity: last-write-wins (from STATE.md with most recent last_updated).
 *
 * Usage: state-reconcile
 */
function cmdStateReconcile(cwd, raw) {
  const mainStatePath = path.join(cwd, '.planning', 'STATE.md');

  if (!fs.existsSync(mainStatePath)) {
    error('STATE.md not found in .planning/');
  }

  const registry = readRegistry(cwd);
  if (registry.worktrees.length === 0) {
    const msg = 'nothing to reconcile: no worktrees registered';
    process.stdout.write(msg + '\n');
    process.exit(0);
  }

  // Parse main STATE.md
  const mainContent = fs.readFileSync(mainStatePath, 'utf-8');
  const mainParsed = parseStateMd(mainContent);

  // Parse each active worktree's STATE.md
  const allParsed = [{ parsed: mainParsed, source: 'main' }];
  let skipped = 0;

  for (const entry of registry.worktrees) {
    const wtStatePath = path.join(
      path.isAbsolute(entry.path) ? entry.path : path.join(cwd, entry.path),
      '.planning',
      'STATE.md'
    );

    if (!fs.existsSync(wtStatePath)) {
      process.stderr.write(`Warning: missing STATE.md for worktree ${entry.stream} (${wtStatePath})\n`);
      skipped++;
      continue;
    }

    const wtContent = fs.readFileSync(wtStatePath, 'utf-8');
    const wtParsed = parseStateMd(wtContent);
    allParsed.push({ parsed: wtParsed, source: entry.stream });
  }

  // ─── Merge frontmatter (last-write-wins by last_updated timestamp) ─────────

  // Find the most recent STATE.md by last_updated
  let newestFm = mainParsed.fm;
  let newestTimestamp = mainParsed.fm.last_updated || '';

  for (const { parsed } of allParsed) {
    const ts = parsed.fm.last_updated || '';
    if (ts > newestTimestamp) {
      newestTimestamp = ts;
      newestFm = parsed.fm;
    }
  }

  // For progress.completed_plans, take the highest value
  let maxCompletedPlans = 0;
  for (const { parsed } of allParsed) {
    const fm = parsed.fm;
    if (fm.progress && typeof fm.progress === 'object') {
      const val = parseInt(fm.progress.completed_plans, 10) || 0;
      if (val > maxCompletedPlans) maxCompletedPlans = val;
    }
  }

  // Build merged frontmatter YAML using raw frontmatter from the newest STATE.md
  // but updating completed_plans if we found a higher value
  let mergedFrontmatter = newestFm._rawFrontmatter;
  if (maxCompletedPlans > 0) {
    // Update completed_plans in the raw frontmatter string
    mergedFrontmatter = mergedFrontmatter.replace(
      /(completed_plans:\s*)\d+/,
      `$1${maxCompletedPlans}`
    );
  }

  // ─── Merge body sections ───────────────────────────────────────────────────

  // Start with main's sections as the base
  const mergedSections = new Map(mainParsed.sections);

  // Merge Performance Metrics table rows (lines starting with |)
  const metricsHeader = [...mergedSections.keys()].find(k => k.includes('Performance Metrics'));
  if (metricsHeader) {
    const mainMetricsBody = mergedSections.get(metricsHeader) || '';
    const mainRows = new Set(
      mainMetricsBody.split('\n').filter(l => l.trim().startsWith('|')).map(l => l.trim())
    );

    for (const { parsed } of allParsed.slice(1)) {
      const wtMetricsHeader = [...parsed.sections.keys()].find(k => k.includes('Performance Metrics'));
      if (!wtMetricsHeader) continue;
      const wtMetricsBody = parsed.sections.get(wtMetricsHeader) || '';
      for (const row of wtMetricsBody.split('\n')) {
        const trimmed = row.trim();
        if (trimmed.startsWith('|') && !trimmed.startsWith('|----') && trimmed !== '| - | - | - | - |') {
          // Check if this row is a data row (not header or separator)
          const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
          if (cells.length > 0 && cells[0] !== 'Phase' && cells[0] !== '-') {
            if (!mainRows.has(trimmed)) {
              mainRows.add(trimmed);
            }
          }
        }
      }
    }

    // Reconstruct metrics section preserving header and separator rows
    const lines = mainMetricsBody.split('\n');
    const headerLines = [];
    const dataRows = [];
    let pastHeader = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('|')) {
        if (!pastHeader) {
          headerLines.push(line);
          if (trimmed.startsWith('|----')) pastHeader = true;
        } else if (trimmed !== '| - | - | - | - |') {
          dataRows.push(line);
        }
      } else {
        if (!pastHeader) headerLines.push(line);
        else dataRows.push(line);
      }
    }

    // Add new rows from worktrees (not already present)
    const existingDataSet = new Set(dataRows.map(r => r.trim()));
    for (const { parsed } of allParsed.slice(1)) {
      const wtMetricsHeader = [...parsed.sections.keys()].find(k => k.includes('Performance Metrics'));
      if (!wtMetricsHeader) continue;
      const wtMetricsBody = parsed.sections.get(wtMetricsHeader) || '';
      for (const row of wtMetricsBody.split('\n')) {
        const trimmed = row.trim();
        if (trimmed.startsWith('|') && !trimmed.startsWith('|----') &&
            trimmed !== '| - | - | - | - |' && trimmed !== '| Phase | Plans | Total | Avg/Plan |') {
          const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
          if (cells.length > 0 && cells[0] !== 'Phase' && cells[0] !== '-') {
            if (!existingDataSet.has(trimmed)) {
              dataRows.push(row);
              existingDataSet.add(trimmed);
            }
          }
        }
      }
    }

    const newMetricsBody = [...headerLines, ...dataRows].join('\n');
    mergedSections.set(metricsHeader, newMetricsBody);
  }

  // Merge ### Decisions and ### Pending Todos (append, deduplicate)
  for (const subSection of ['### Decisions', '### Pending Todos']) {
    const sectionKey = [...mergedSections.keys()].find(k => k === subSection);
    if (!sectionKey) continue;

    const mainBody = mergedSections.get(sectionKey) || '';
    const seenItems = new Set(extractListItems(mainBody).map(i => i.toLowerCase()));
    const allItems = [...extractListItems(mainBody)];

    for (const { parsed } of allParsed.slice(1)) {
      const wtKey = [...parsed.sections.keys()].find(k => k === subSection);
      if (!wtKey) continue;
      const wtBody = parsed.sections.get(wtKey) || '';
      for (const item of extractListItems(wtBody)) {
        const normalized = item.toLowerCase();
        if (!seenItems.has(normalized)) {
          seenItems.add(normalized);
          allItems.push(item);
        }
      }
    }

    // Reconstruct: preserve existing non-list content, then list items
    const lines = mainBody.split('\n');
    const nonListLines = [];
    let firstListSeen = false;
    for (const line of lines) {
      if (line.trim().startsWith('- ')) {
        firstListSeen = true;
      } else if (!firstListSeen) {
        nonListLines.push(line);
      }
    }

    const newBody = nonListLines.join('\n') + '\n' + allItems.map(i => `- ${i}`).join('\n') + '\n';
    mergedSections.set(sectionKey, newBody);
  }

  // ## Session Continuity: last-write-wins (take from the newest STATE.md)
  const sessionHeader = [...mergedSections.keys()].find(k => k.includes('Session Continuity'));
  if (sessionHeader) {
    // Find the section body from the newest parsed STATE.md
    let newestSessionBody = mergedSections.get(sessionHeader);
    for (const { parsed } of allParsed.slice(1)) {
      const ts = parsed.fm.last_updated || '';
      const wtSessionHeader = [...parsed.sections.keys()].find(k => k.includes('Session Continuity'));
      if (wtSessionHeader && ts === newestTimestamp) {
        newestSessionBody = parsed.sections.get(wtSessionHeader);
        break;
      }
    }
    if (newestSessionBody !== undefined) {
      mergedSections.set(sessionHeader, newestSessionBody);
    }
  }

  // ─── Reconstruct STATE.md ──────────────────────────────────────────────────

  let result = `---\n${mergedFrontmatter}\n---\n`;
  for (const [header, body] of mergedSections) {
    result += header + body;
  }

  fs.writeFileSync(mainStatePath, result, 'utf-8');

  const mergedCount = allParsed.length - 1;
  const summary = {
    merged: true,
    worktrees_merged: mergedCount,
    worktrees_skipped: skipped,
  };

  output(summary, raw, `reconciled ${mergedCount} worktree(s) into main STATE.md`);
}

module.exports = {
  readRegistry,
  writeRegistry,
  cmdWorktreeCreate,
  cmdWorktreeRemove,
  cmdHierarchyPartition,
  cmdStateReconcile,
};
