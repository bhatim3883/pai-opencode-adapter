/**
 * agent-type-registry.ts — Shared Agent Type Registry
 *
 * Provides two services:
 * 1. Session→AgentType mapping: pai-unified.ts registers subagent sessions
 *    with their agent type; skill-loader.ts reads it to provide adaptation context.
 * 2. PAI→OpenCode agent type mapping: translates upstream PAI skill references
 *    (ClaudeResearcher, GeminiResearcher, etc.) to OpenCode agent types.
 *
 * This module is intentionally dependency-free (no imports from plugin/ or handlers/)
 * to avoid circular dependencies.
 *
 * @module lib/agent-type-registry
 */

// ── Session → Agent Type Mapping ──────────────────────────────────

const sessionAgentTypes = new Map<string, string>();

/**
 * Register a subagent session with its agent type.
 * Called from pai-unified.ts when a subagent session is detected.
 */
export function registerSubagentType(sessionId: string, agentType: string): void {
  sessionAgentTypes.set(sessionId, agentType.toLowerCase());
}

/**
 * Get the agent type for a session, or null if not a known subagent.
 */
export function getSubagentType(sessionId: string): string | null {
  return sessionAgentTypes.get(sessionId) ?? null;
}

/**
 * Check if a session is a known subagent.
 */
export function isRegisteredSubagent(sessionId: string): boolean {
  return sessionAgentTypes.has(sessionId);
}

/**
 * Remove a subagent session from the registry.
 * Called on session.end cleanup.
 */
export function clearSubagentType(sessionId: string): void {
  sessionAgentTypes.delete(sessionId);
}

// ── PAI → OpenCode Agent Type Mapping ─────────────────────────────

/**
 * Maps PAI skill agent type references to their OpenCode equivalents.
 * PAI skills (designed for Claude Code) reference agent types that don't
 * exist in OpenCode. This map translates them.
 *
 * Keys are lowercase for case-insensitive lookup.
 */
export const PAI_TO_OPENCODE_AGENT_MAP: Record<string, string> = {
  // Research-oriented agents
  clauderesearcher: "research",
  geminiresearcher: "research",
  researcher: "research",
  "claude-researcher": "research",
  "gemini-researcher": "research",
  researchagent: "research",

  // Explorer-oriented agents
  codeexplorer: "explorer",
  "code-explorer": "explorer",

  // Engineer-oriented agents
  codeengineer: "engineer",
  "code-engineer": "engineer",
  implementer: "engineer",

  // Thinker-oriented agents
  analyst: "thinker",
  reasoner: "thinker",

  // Architect-oriented agents
  designer: "architect",
  planner: "architect",

  // Direct mappings (identity, for completeness)
  research: "research",
  explorer: "explorer",
  explore: "explorer",
  engineer: "engineer",
  general: "engineer",
  thinker: "thinker",
  architect: "architect",
  intern: "intern",
};

/**
 * Resolve a PAI skill agent type reference to the OpenCode equivalent.
 * Returns the mapped type, or the original lowercased if no mapping exists.
 */
export function resolveAgentType(paiType: string): string {
  const normalized = paiType.toLowerCase().trim();
  return PAI_TO_OPENCODE_AGENT_MAP[normalized] ?? normalized;
}

// ── Agent Permission Profiles ─────────────────────────────────────

/**
 * Describes the tools available to each OpenCode agent type.
 * Used by skill-loader to generate adaptation notes when loading
 * skills for subagents.
 */
export interface AgentPermissionProfile {
  canBash: boolean;
  canCurl: boolean;
  canEdit: boolean;
  canWebfetch: boolean;
  canTask: boolean;
  canSkill: boolean;
  taskTargets: string[]; // Which agent types this agent can spawn
  notes: string[];       // Human-readable notes about limitations
}

export const AGENT_PERMISSIONS: Record<string, AgentPermissionProfile> = {
  research: {
    canBash: false,
    canCurl: true, // Will be added by this fix
    canEdit: false,
    canWebfetch: true,
    canTask: true,
    canSkill: true,
    taskTargets: ["explorer", "intern", "explore", "general"],
    notes: [
      "Use webfetch for URL fetching (preferred over curl)",
      "Use curl for requests needing custom headers",
      "Cannot edit files — return findings to parent agent",
      "Can spawn explorer/intern agents for focused subtasks",
    ],
  },
  explorer: {
    canBash: false,
    canCurl: false,
    canEdit: false,
    canWebfetch: false,
    canTask: false,
    canSkill: true,
    taskTargets: [],
    notes: [
      "Read-only agent — can only search and read files",
      "Cannot fetch URLs, run bash, or spawn sub-agents",
      "Use Grep and Glob for code search",
    ],
  },
  intern: {
    canBash: false,
    canCurl: false,
    canEdit: false,
    canWebfetch: false,
    canTask: false,
    canSkill: true,
    taskTargets: [],
    notes: [
      "Lightweight agent for simple data transformation",
      "Cannot fetch URLs, run bash, or spawn sub-agents",
    ],
  },
  engineer: {
    canBash: true,
    canCurl: true,
    canEdit: true,
    canWebfetch: false,
    canTask: true,
    canSkill: true,
    taskTargets: ["explorer", "intern", "explore", "general"],
    notes: [
      "Full bash and file edit access",
      "Can execute curl, run tests, build code",
      "Primary workhorse for implementation tasks",
    ],
  },
  thinker: {
    canBash: false,
    canCurl: true, // Will be added by this fix
    canEdit: false,
    canWebfetch: true,
    canTask: true,
    canSkill: true,
    taskTargets: ["explorer", "intern", "explore", "general"],
    notes: [
      "Deep reasoning agent — analysis and architecture",
      "Use webfetch for URL fetching (preferred over curl)",
      "Cannot edit files — return analysis to parent agent",
    ],
  },
  architect: {
    canBash: false,
    canCurl: true, // Will be added by this fix
    canEdit: false,
    canWebfetch: true,
    canTask: true,
    canSkill: true,
    taskTargets: ["explorer", "intern", "explore", "general"],
    notes: [
      "System design agent — plans and specs, no production code",
      "Use webfetch for URL fetching (preferred over curl)",
      "Cannot edit files — return designs to parent agent",
    ],
  },
};

/**
 * Get the permission profile for an agent type.
 * Returns null if the type is unknown.
 */
export function getAgentPermissions(agentType: string): AgentPermissionProfile | null {
  const normalized = agentType.toLowerCase().trim();
  return AGENT_PERMISSIONS[normalized] ?? null;
}

/**
 * Generate a human-readable permission summary for an agent type.
 * Used by skill-loader to append adaptation context to loaded skills.
 */
export function formatPermissionSummary(agentType: string): string | null {
  const profile = getAgentPermissions(agentType);
  if (!profile) return null;

  const lines: string[] = [];
  lines.push(`## OpenCode Adaptation Notes (${agentType} agent)`);
  lines.push("");
  lines.push("You are running as a subagent with the following permissions:");
  lines.push("");
  lines.push("### Available Tools");
  lines.push(`| Tool | Available | Notes |`);
  lines.push(`|------|-----------|-------|`);
  lines.push(`| bash | ${profile.canBash ? "✅" : "❌"} | ${profile.canBash ? "Full access" : "Deny (except grep/rg/git)"} |`);
  lines.push(`| curl | ${profile.canCurl ? "✅" : "❌"} | ${profile.canCurl ? "HTTP requests allowed" : "Not available — use webfetch if available"} |`);
  lines.push(`| edit | ${profile.canEdit ? "✅" : "❌"} | ${profile.canEdit ? "Can modify files" : "Read-only — return results to parent"} |`);
  lines.push(`| webfetch | ${profile.canWebfetch ? "✅" : "❌"} | ${profile.canWebfetch ? "Preferred for URL fetching" : "Not available"} |`);
  lines.push(`| task (spawn) | ${profile.canTask ? "✅" : "❌"} | ${profile.canTask ? `Can spawn: ${profile.taskTargets.join(", ")}` : "Cannot spawn sub-agents"} |`);
  lines.push(`| skill (load) | ${profile.canSkill ? "✅" : "❌"} | Skills always available |`);
  lines.push("");

  if (profile.notes.length > 0) {
    lines.push("### Guidelines");
    for (const note of profile.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  lines.push("### Agent Type Mapping (PAI → OpenCode)");
  lines.push("If skill instructions reference these agent types, use the OpenCode equivalent:");
  lines.push("| PAI Skill Reference | Use This Instead |");
  lines.push("|---------------------|-----------------|");
  lines.push("| ClaudeResearcher | `research` |");
  lines.push("| GeminiResearcher | `research` |");
  lines.push("| researcher | `research` |");
  lines.push("| CodeExplorer | `explorer` |");
  lines.push("| implementer | `engineer` |");
  lines.push("| analyst / reasoner | `thinker` |");
  lines.push("");

  if (!profile.canBash && profile.canWebfetch) {
    lines.push("### Curl → WebFetch Translation");
    lines.push("Skill instructions that say `curl <URL>` should be executed using the `webfetch` tool instead:");
    lines.push("- `curl -s https://example.com` → use `webfetch({ url: 'https://example.com' })`");
    lines.push("- `curl -o /dev/null -w '%{http_code}' URL` → use `webfetch` and check if content is returned");
    lines.push("");
  }

  if (!profile.canTask) {
    lines.push("### No Sub-Agent Spawning");
    lines.push("You cannot spawn sub-agents via the Task tool. If skill instructions tell you to");
    lines.push("delegate to other agents, perform the work yourself directly instead.");
    lines.push("");
  }

  return lines.join("\n");
}

// ── Exports for testing ───────────────────────────────────────────

export const _sessionAgentTypesForTest = sessionAgentTypes;
