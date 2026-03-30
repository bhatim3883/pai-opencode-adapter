# Gap Analysis: PAI-OpenCode Adapter Evaluation (2026-03-29)

## Background

An external review by a native Claude Code PAI user identified 7 gaps in the PAI-OpenCode adapter, rating 2 as Critical, 2 as High, and 3 as Medium. This analysis evaluates each concern against OpenCode's actual native capabilities.

## Key Finding

**3 of the 7 reported gaps are INVALID.** The reviewer evaluated the adapter in isolation without understanding what OpenCode provides natively. They assumed that if the adapter doesn't implement something, it doesn't exist. OpenCode has native `Skill`, `Task`, and MCP support built into the runtime — the adapter doesn't need to provide these.

---

## Gap-by-Gap Verdict

### Gap 1: Skill Tool Absent (CRITICAL → INVALID)

**Report claim:** "The Skill tool does not exist in the adapter, so PAI skills cannot be invoked."

**Verdict: INVALID**

**Evidence:** OpenCode has a native `SkillTool` implementation at `packages/opencode/src/tool/skill.ts` that:
- Discovers skills from `~/.claude/skills/`, `~/.agents/skills/`, and `.opencode/skill/` directories
- Presents them as a callable `skill(name)` tool to the model
- Loads `SKILL.md` content and injects it as `<skill_content>` blocks
- This is a built-in OpenCode feature, NOT an adapter responsibility

**Action:** None required. Added invocation logging to the adapter to prove skills ARE being called.

---

### Gap 2: Agent Teams Are Stubs (CRITICAL → PARTIALLY VALID)

**Report claim:** "Agent team dispatch/status/collect tools are dead stubs that don't actually spawn agents."

**Verdict: PARTIALLY VALID**

**Evidence:** The adapter's `agent_team_dispatch`, `agent_team_status`, and `agent_team_collect` custom tools do indeed only track dispatch metadata in memory — they don't actually spawn sub-agent sessions. HOWEVER, OpenCode's native `TaskTool` (`packages/opencode/src/tool/task.ts`) provides real sub-agent spawning via `Session.create()` with `parentID` and `SessionPrompt.prompt()`. The model uses `Task` for actual agent work.

**Action:** Documented agent_team tools as an optional tracking/coordination layer. The real agent spawning happens via OpenCode's native Task tool.

---

### Gap 3: EnterPlanMode Missing (HIGH → PARTIALLY VALID)

**Report claim:** "The model cannot programmatically enter plan mode."

**Verdict: PARTIALLY VALID**

**Evidence:** Plan mode in Claude Code is a CC-specific feature (`EnterPlanMode` tool). OpenCode does not expose a plan/edit mode toggle to plugins. The adapter implements plan mode via text-trigger detection (`/plan`, `/build` commands) and tool blocking — which works but is a degraded experience. This is a known limitation documented in the Workaround Registry.

**Action:** No new work needed. Already documented as a known limitation.

---

### Gap 4: Task Tool Absent (HIGH → INVALID)

**Report claim:** "The Task tool does not exist, so sub-agents cannot be spawned."

**Verdict: INVALID**

**Evidence:** OpenCode has a native `TaskTool` implementation at `packages/opencode/src/tool/task.ts` that:
- Spawns real sub-agent sessions via `Session.create()` with `parentID`
- Runs real model prompts via `SessionPrompt.prompt()`
- Accepts `subagent_type`, `prompt`, `description`, `task_id` parameters
- Returns actual results from the sub-agent
- Custom agents at `~/.config/opencode/agents/` are available as sub-agent types

**Action:** None required. Added invocation logging to prove tasks ARE being spawned.

---

### Gap 5: AskUserQuestion Missing (MEDIUM → PARTIALLY VALID)

**Report claim:** "The model cannot invoke AskUserQuestion to prompt the user."

**Verdict: PARTIALLY VALID**

**Evidence:** `AskUserQuestion` is a Claude Code-specific tool. OpenCode does not have an equivalent. However, this is a low-priority gap because the model can simply ask questions directly in its output text, and the user will respond naturally.

**Action:** No action needed. Low-impact limitation.

---

### Gap 6: MCP Not Addressed (MEDIUM → INVALID)

**Report claim:** "MCP server support is not handled by the adapter."

**Verdict: INVALID**

**Evidence:** MCP is natively supported by OpenCode, configured in `opencode.json` under the `"mcp"` key. The user has 4 MCP servers configured (zai-vision, zai-web-search, zai-web-reader, zread). MCP tools appear directly in the model's tool list. No adapter involvement is needed.

**Action:** None required.

---

### Gap 7: Experimental API Fragility (MEDIUM → VALID)

**Report claim:** "The adapter relies on experimental OpenCode APIs that could change."

**Verdict: VALID**

**Evidence:** The adapter uses `experimental.chat.system.transform` for context injection and `experimental.session.compacting` for compaction handling. These APIs are prefixed with `experimental` and could change without notice. This is a genuine risk.

**Action:** This is already tracked in the adapter's architecture. The self-updater monitors for API changes. Mitigation: the adapter uses `safeHandler` wrapping on all hook calls, so if an experimental API changes shape, the adapter degrades gracefully (logs error, continues operation) rather than crashing.

---

## Summary

| Gap | Severity (Reported) | Verdict | Severity (Actual) |
|-----|---------------------|---------|-------------------|
| 1. Skill tool absent | Critical | **INVALID** | None |
| 2. Agent teams stubs | Critical | Partially valid | Low (native Task tool handles it) |
| 3. EnterPlanMode missing | High | Partially valid | Medium (known limitation) |
| 4. Task tool absent | High | **INVALID** | None |
| 5. AskUserQuestion missing | Medium | Partially valid | Low |
| 6. MCP not addressed | Medium | **INVALID** | None |
| 7. Experimental API fragility | Medium | **VALID** | Medium |

**Root cause of report errors:** The reviewer evaluated the adapter in isolation, treating it as the sole bridge between PAI and OpenCode. In reality, OpenCode provides native Skill, Task, and MCP support — the adapter only needs to handle what OpenCode doesn't provide natively (context injection, security validation, learning capture, voice notifications, etc.).

## Proof of Invocation

The adapter now logs all `skill` and `task` tool invocations in the debug log at `/tmp/pai-opencode-debug.log`. Search for `[skill-tracker]` entries to see:
- `BEFORE skill invocation: name="SkillName"` — before the skill is loaded
- `AFTER skill invocation: name="SkillName"` — after the skill content is injected
- `BEFORE task invocation: subagent_type="type"` — before a sub-agent is spawned
- `AFTER task invocation: subagent_type="type"` — after the sub-agent returns

This provides definitive evidence that skills and tasks are being invoked through OpenCode's native tools, observable from the adapter's hook layer.
