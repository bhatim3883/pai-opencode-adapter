# Agents

The PAI-OpenCode adapter ships 8 agents: 2 primary agents (switchable with **Tab**) and 6 subagents (invocable with **@name**).

## Overview

| Agent | Type | Model | Color | Temperature | Purpose |
|-------|------|-------|-------|-------------|---------|
| **Native** | Primary | `claude-sonnet-4.6` | `#06B6D4` cyan | 0.3 | Fast, direct task execution |
| **Algorithm** | Primary | `claude-sonnet-4.6` | `#3B82F6` blue | 0.3 | Structured 7-phase workflow |
| **Architect** | Subagent | `claude-opus-4.6` | `#6366F1` indigo | 0.3 | System design and architecture |
| **Engineer** | Subagent | `claude-sonnet-4.6` | `#F97316` orange | 0.2 | Implementation and bug fixes |
| **Thinker** | Subagent | `claude-sonnet-4.6` | `#EAB308` yellow | 0.1 | Deep reasoning and analysis |
| **Research** | Subagent | `glm-4.7` | `#A855F7` purple | 0.2 | Web research and content extraction |
| **Explorer** | Subagent | `glm-4.7` | `#22C55E` green | 0.1 | Read-only codebase exploration |
| **Intern** | Subagent | `glm-4.7` | `#94A3B8` slate | 0.1 | Simple, well-scoped subtasks |

## Primary Agents

Primary agents are full-context agents that own the conversation. Switch between them with **Tab** in the OpenCode TUI.

### Native

**Model:** `github-copilot/claude-sonnet-4.6` · **Mode:** primary · **Color:** cyan

Fast, direct task execution without Algorithm overhead. Best for single-step tasks, quick code fixes, file searches, and conversational responses.

**When to use:**
- Simple tasks under 2 minutes
- Quick code edits and searches
- Conversational Q&A
- Tasks that don't need structured planning

**Output format:** PAI Native Mode — concise task/change/verify blocks.

**Escalation:** If a task turns out to be multi-step or complex, Native suggests switching to Algorithm.

**Permissions:** Full — edit, bash, webfetch, external directories (`~/.claude/**`, `~/.config/opencode/**`).

---

### Algorithm

**Model:** `github-copilot/claude-sonnet-4.6` · **Mode:** primary · **Color:** blue

Structured 7-phase workflow (Observe → Think → Plan → Build → Execute → Verify → Learn) from PAI Algorithm v3.5.0. Uses verifiable Ideal State Criteria (ISC) and capability invocation.

**When to use:**
- Multi-step tasks with multiple files
- Feature implementation, debugging, design work
- Tasks requiring structured planning and verification
- Any work that benefits from a PRD and criteria tracking

**Key behaviors:**
- Loads `~/.claude/PAI/Algorithm/v3.5.0.md` on every request
- Creates PRDs in `MEMORY/WORK/{slug}/`
- Voice announcements at phase transitions
- ISC Count Gate enforcement per effort tier
- Capability selection and mandatory tool invocation

**Permissions:** Full — edit, bash, webfetch, external directories.

---

## Subagents

Subagents are scoped agents invoked by the primary agent (or directly with **@name**). They have restricted permissions and cannot spawn other agents (`task: deny`). All subagents can load PAI skills (`skill: allow`).

### Architect

**Model:** `github-copilot/claude-opus-4.6` · **Mode:** subagent · **Color:** indigo

System design and architecture agent. Plans technical approaches, reviews designs, evaluates tradeoffs, and creates implementation specs. Does not write production code — produces plans and specs.

**Best for:**
- System design and component architecture
- Technical approach planning before implementation
- API and interface design
- Reviewing existing architecture for issues
- Breaking down complex features into implementable tasks
- Build vs. buy vs. extend decisions

**Output format:** Structured design documents with Context, Proposed Design, Key Decisions table, Implementation Plan, and Risks & Mitigations.

**Permissions:** Read-only + restricted bash (grep, rg, git read commands). No edit, no task spawning, no questions to user. Webfetch allowed.

---

### Engineer

**Model:** `github-copilot/claude-sonnet-4.6` · **Mode:** subagent · **Color:** orange

Workhorse coding agent for implementation tasks. Writes, edits, and refactors code. Full file system and bash access. Ideal for building features, fixing bugs, and applying well-scoped changes.

**Best for:**
- Implementing features from a clear spec
- Fixing bugs with a known root cause
- Refactoring files or functions
- Writing tests for existing code
- Applying mechanical changes across files

**Output format:** Summary of changes made — file paths with descriptions, plus notes on decisions and edge cases.

**Permissions:** Full edit + bash access. No task spawning, no webfetch, no questions to user.

---

### Thinker

**Model:** `github-copilot/claude-sonnet-4.6` · **Mode:** subagent · **Color:** yellow

Deep reasoning agent for analysis, architecture decisions, debugging complex issues, and evaluating tradeoffs. Excels at first-principles thinking and structured problem decomposition.

**Best for:**
- First principles decomposition
- Architecture analysis and design review
- Tradeoff evaluation with pros/cons matrices
- Root cause analysis for bugs and issues
- Risk assessment and premortem analysis

**Output format:** Structured analysis with Problem Decomposition, Key Considerations, Recommendation, and Risks.

**Permissions:** Read-only + restricted bash (grep, rg, git read commands). No edit, no task spawning, no questions to user. Webfetch allowed.

---

### Research

**Model:** `zai-coding-plan/glm-4.7` · **Mode:** subagent · **Color:** purple

Fast research agent for investigating topics, gathering information, analyzing codebases, and extracting insights. Uses web search, documentation retrieval, and code analysis.

**Best for:**
- Web research via WebFetch
- Codebase exploration via Read, Grep, Glob
- Git history analysis
- Documentation retrieval and analysis
- Content extraction and summarization

**Output format:** Structured findings with Key Findings (with sources), Details, and Sources list.

**Permissions:** Read-only + restricted bash (grep, rg, git read commands). No edit, no task spawning, no questions to user. Webfetch allowed.

---

### Explorer

**Model:** `zai-coding-plan/glm-4.7` · **Mode:** subagent · **Color:** green · **Max steps:** 30

Fast read-only codebase exploration agent. Finds files, searches patterns, traces code paths, and maps project structure. Cannot modify files.

**Best for:**
- File pattern matching (Glob)
- Content searching (Grep)
- Git history exploration (log, show, diff, blame)
- Project structure mapping
- Quick codebase orientation

**Output format:** Concise file list with paths and line numbers, plus a 1-3 sentence summary.

**Permissions:** Read-only + restricted bash (grep, rg, git read commands, wc). No edit, no webfetch, no task spawning, no questions to user.

---

### Intern

**Model:** `zai-coding-plan/glm-4.7` · **Mode:** subagent · **Color:** slate · **Max steps:** 20

Lightweight intern agent for simple, well-defined subtasks. Fast and cheap. Best for data transformation, templating, and mechanical code generation.

**Best for:**
- Data extraction and transformation
- Templating and scaffolding from a clear spec
- Mechanical code generation (boilerplate, type stubs, simple functions)
- Summarization of short content
- Running simple grep/search tasks

**Output format:** Concise results with optional Notes section for edge cases.

**Permissions:** Read-only + restricted bash (grep, rg, git status/log/diff). No edit, no webfetch, no task spawning, no questions to user.

---

## Subagent Reliability

The adapter includes a 4-layer reliability suite to handle subagent failures gracefully:

1. **Enhanced error detection** — Checks both top-level error fields and stringified Task output body for provider error patterns (rate limits, model not found, connection errors).

2. **Actionable model fallback** — When a subagent fails due to a provider error, the adapter injects a `<system-reminder>` suggesting alternative `subagent_type` values with their models, drawn from the configured fallback chain.

3. **Stall detection** — A 3-minute heartbeat monitor per subagent. If no `message.part.updated` events are received within the window, a warning is injected into the primary agent's next system prompt.

4. **Reasoning loop detection** — Hashes reasoning text chunks in a rolling window of 8. If 3+ identical hashes are detected, the primary agent is warned that the subagent may be stuck in a reasoning loop.

All reliability mechanisms are fail-open — they log warnings and inject guidance but never block execution or crash the host process.

## Model Routing

Agent models are configured in `~/.config/opencode/pai-adapter.json` under `models.agents`. The adapter syncs model assignments from config into agent `.md` files on startup (the `model:` field in YAML frontmatter).

A `<model-routing>` table is injected into every system prompt so the LLM knows which models map to which roles. Fallback chains are configured per-role under `models.fallbacks`.

See [Configuration — Model Routing](configuration.md#model-routing-and-fallback-chains) for full details.

## Invoking Agents

| Method | Example | Notes |
|--------|---------|-------|
| **Tab** (primary switch) | Press Tab | Toggles between Native and Algorithm |
| **@mention** (subagent) | `@architect review this design` | Invokes subagent inline |
| **Task tool** (programmatic) | Algorithm selects capabilities and invokes via Task tool | Used during Algorithm BUILD/EXECUTE phases |

## Agent Definition Files

All agent definitions live in `src/config/agents/*.md` as Markdown files with YAML frontmatter. The frontmatter defines:

| Field | Purpose |
|-------|---------|
| `description` | Agent description shown in OpenCode agent picker |
| `mode` | `primary` or `subagent` |
| `model` | Model identifier (synced from `pai-adapter.json`) |
| `color` | Hex color for TUI display |
| `temperature` | LLM temperature (lower = more deterministic) |
| `steps` | Max tool-use steps (subagents only, optional) |
| `permission` | Tool permissions — `allow`, `deny`, or pattern-based |

---

[← Back to README](../README.md) · [Features](features.md) · [Configuration](configuration.md)
