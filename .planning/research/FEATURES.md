# Feature Landscape

**Domain:** Multi-agent hierarchy orchestration (3-tier L1/L2/L3 within an existing GSD system)
**Researched:** 2026-03-11

## Context

GSD currently runs a 2-level architecture: orchestrator spawns subagents via Task(), subagents execute and return summaries, orchestrator blocks waiting. This milestone adds a 3-tier hierarchy where L1 (main orchestrator) spawns L2 (sub-orchestrators) non-blocking, L2s each own a git worktree and spawn L3 (leaf agents) to do actual work, and communication flows up the tree via SendMessage.

The feature analysis below maps what must exist for this to function vs. what would be valuable but not blocking.

---

## Table Stakes

Features that must exist or the hierarchy system breaks entirely. These are non-negotiable for any working multi-agent orchestration system.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Team creation and teardown | Without a team namespace, SendMessage has no routing; agents can't communicate across hierarchy levels | Low | TeamCreate/TeamDelete primitives already exist in Claude Code; GSD needs to invoke them and track team name in STATE.md |
| Non-blocking L2 spawn (run_in_background) | If L1 blocks waiting for each L2, parallelism is lost entirely — one of the core value propositions collapses | Low | Already a flag on the Task/Agent tool; the pattern must be enforced in the L1 workflow |
| L2 sub-orchestrator agent definition | L2s need role instructions that enforce the "no direct work" constraint — without this, L2s drift into doing work themselves and pollute their context window | Medium | Requires a new agent file (gsd-sub-orchestrator.md) with restricted tools (Agent, SendMessage, Read only) |
| SendMessage-based result reporting (L3 → L2 → L1) | Without a structured report-up path, L1 has no way to know when L2s are done or what they found | Medium | Requires L2 and L3 agents to understand the message protocol; must be codified in agent instructions |
| Worktree lifecycle management (create/teardown) | Without filesystem isolation, parallel L2 streams produce file conflicts; git operations from two L2s on the same working tree will corrupt state | Medium | `git worktree add` / `git worktree remove --force`; teardown must be guaranteed even on failure |
| Feature flag with graceful fallback | The entire existing GSD user base must not be affected; if `hierarchy.enabled = false`, GSD runs exactly as today | Low | One config.json check at the entry point of execute-phase; false branch = existing code path, no changes |
| MCP isolation (L3 only) | If L2 or L1 calls MCP tools directly, their context fills with tool responses instead of coordination signals — the core insight behind the hierarchy | Low | Enforced via agent frontmatter `tools:` allowlist; no runtime enforcement possible, only definition-time |
| Structured result schema from L3 → L2 | Without typed, predictable output from L3, L2 can't synthesize results and L1 gets noise instead of signal | Medium | A defined JSON or structured markdown format that every L3 uses to close its task; matches the GitHub engineering finding that "typed schemas are table stakes" |
| L1 parallel L2 spawning | L1 must spawn multiple L2s concurrently for independent work streams — sequential spawn eliminates the benefit | Low | run_in_background on each Task() call in L1; requires all L2 tasks to be identified before any are spawned |

---

## Differentiators

Features that increase value but are not required for the system to function. The hierarchy works without these; they make it meaningfully better.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-toggle feature flags (mcp_isolation, worktree_isolation, team_communication) | Lets users adopt hierarchy incrementally — e.g., use team communication without worktree isolation on a single-file project | Low | Three booleans under `hierarchy` key in config.json; each gate individually checked |
| Worktree naming convention tied to L2 identity | Makes it easy to diagnose which L2 owns which worktree; prevents accidental teardown of the wrong one | Low | `.claude/worktrees/<phase>-<stream-name>` naming; documented convention, not enforced by code |
| L2 context budget enforcement (15% cap) | L2s that accumulate work context eventually become L1-level bottlenecks; the budget forces L2 to stay lean and delegate | High | Cannot be enforced programmatically — must be a strong instruction in L2 system prompt and a design constraint. Monitoring is not feasible in v1. |
| Shutdown acknowledgment protocol | Guarantees worktrees are cleaned up before L1 considers the run complete; prevents orphaned worktrees accumulating across runs | Medium | SendMessage "shutdown_request" → L2 ack pattern; already described in user's CLAUDE.md as the teardown pattern |
| STATE.md tracking of active hierarchy | If a session dies mid-run, STATE.md showing active L2s and their worktrees enables manual recovery | Medium | Add `hierarchy.active_l2s` field to STATE.md with worktree paths; gsd-tools reads/writes this |
| Wave-aware L2 assignment | Assigning L2s to match existing wave groups (from wave-based dependency analysis) means minimal coordination overhead — L2 boundaries follow natural dependency boundaries | Medium | Requires the existing wave grouper output to inform which streams are created; no new logic, just threading the wave result into L2 spawn |
| L2 work stream specialization hints | Passing a stream description (e.g., "backend API tasks") to L2 improves L3 spawning decisions even though L2 is generic | Low | Part of the Task() prompt to L2; low engineering cost, meaningful result quality improvement |

---

## Anti-Features

Features to explicitly NOT build in this milestone. Each has a reason it would be harmful or wasteful at this stage.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Dynamic scaling (auto-spawn more L2s mid-run) | Adds distributed systems complexity (quorum, idempotency, retry logic) without evidence it's needed; the current wave-at-start model works for known tasks | Pre-identify all L2 streams before spawning; accept that dynamic tasks go in a later wave |
| Fault recovery / automatic L2 restart on failure | Failure modes for LLM agents are not deterministic; automatic restart can repeat the same bad behavior. Cascading retries are a known failure pattern in multi-agent systems. | Surface failures clearly in STATE.md; let the human decide whether to retry |
| Load balancing across L2s | GSD tasks are not homogeneous — load balancing assumes fungible workers. L2 work streams are defined by task type, not load. | Fixed stream assignment; if streams are uneven, that's a planning concern, not a runtime concern |
| Cross-repo worktree support | Out-of-scope per PROJECT.md; adds complexity around relative path resolution and git remote handling | Keep worktrees within the project repo; multi-repo work requires separate GSD invocations |
| Specialized L2 agent types | Generic L2s keep the system maintainable; specialization at L2 level means maintaining multiple orchestrator personality variants | All specialization happens at L3 (leaf agents already have domain-specific instructions); L2 stays generic coordinator |
| Custom message broker / IPC layer | Claude Code's SendMessage + file-based coordination is sufficient; adding a custom message broker creates an external dependency with its own failure modes | Use SendMessage for signals, files for structured data handoff |
| Docker isolation per worktree | Mentioned in CLAUDE.md but explicitly out-of-scope per PROJECT.md; adds 5-10 minute setup overhead per L2, port conflict management, and container lifecycle complexity | Out of scope for v1; document as a future capability |
| Observable dashboard / metrics | Enterprise orchestration systems add monitoring, but GSD is a single-developer tool; the overhead of instrumentation exceeds its benefit at this scale | STATE.md and per-phase summaries are the observability layer; no separate metrics system |
| Nested teams (teams within teams) | Claude Code's current implementation does not support nested teams (single team per session constraint); working around this creates fragile coupling | Flat team with role differentiation via SendMessage conventions; L1/L2/L3 distinguished by agent instructions, not separate team namespaces |

---

## Feature Dependencies

```
TeamCreate → SendMessage (team must exist before messages can route)
Worktree creation → L2 spawn (L2 gets worktree path injected at spawn time)
L2 agent definition → L3 spawn (L2 must know how to delegate before it can do so)
Feature flag → all hierarchy features (flag gates entire code path)
Non-blocking L2 spawn → parallel execution (blocking spawn = sequential = no benefit)
L3 result schema → L2 synthesis → L1 final result (each level depends on structured output from below)
Shutdown protocol → Worktree teardown (need L2 ack before removing its worktree)
Wave analysis (existing) → L2 stream assignment (differentiator builds on existing capability)
```

---

## MVP Recommendation

The minimum viable hierarchy that delivers value:

1. **Feature flag** (`hierarchy.enabled`) — gate everything, zero risk to existing users
2. **L2 sub-orchestrator agent definition** — new `gsd-sub-orchestrator.md` with tool restrictions
3. **Non-blocking L1 spawn** — `run_in_background: true` on all L2 Task() calls
4. **TeamCreate / SendMessage result reporting** — structured result message from each L2 back to L1
5. **Worktree create/teardown lifecycle** — per-L2 worktree with guaranteed cleanup
6. **MCP isolation via frontmatter** — L2 tools allowlist excludes all MCP tools
7. **Structured L3 result schema** — defined output format all L3 agents use

Defer to a follow-on milestone:
- **Shutdown acknowledgment protocol**: Useful but adds message-passing logic; manual worktree cleanup is an acceptable first-pass fallback
- **STATE.md hierarchy tracking**: Valuable for recovery but not needed for basic function
- **Per-toggle feature flags**: Single `hierarchy.enabled` is sufficient for v1; granular toggles add complexity with low initial value

---

## Sources

- [From Tasks to Swarms: Agent Teams in Claude Code](https://alexop.dev/posts/from-tasks-to-swarms-agent-teams-in-claude-code/) — Claude Code TeamCreate/SendMessage/TaskCreate primitives, lifecycle phases, limitations (MEDIUM confidence, verified against multiple corroborating sources)
- [Multi-Agent Workflows Often Fail — GitHub Blog](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/) — Typed schemas as table stakes, treat agents like code, validate every boundary (HIGH confidence, official GitHub engineering)
- [Developer's Guide to Multi-Agent Patterns in ADK — Google Developers Blog](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/) — Hierarchical decomposition pattern, start simple advice, parallel fan-out/gather (MEDIUM confidence, official Google source)
- [Git Worktrees for Parallel AI Agents — Upsun](https://devcenter.upsun.com/posts/git-worktrees-for-parallel-ai-coding-agents/) — Worktree isolation benefits and limitations (port/database conflicts) (MEDIUM confidence)
- [Why Your Multi-Agent System is Failing — Towards Data Science](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/) — Coordination overhead trade-off, cascading retry failures, context explosion anti-pattern (MEDIUM confidence)
- [Claude Code Sub-agents Docs](https://code.claude.com/docs/en/sub-agents) — Agent frontmatter tool restrictions (HIGH confidence, official docs)
- PROJECT.md — Out-of-scope decisions (Docker isolation, cross-repo, specialized L2s) already validated by project owners (HIGH confidence)
