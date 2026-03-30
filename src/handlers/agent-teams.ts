/**
 * Agent Teams — SDK client implementation using v1 param structure
 *
 * Provides CC-equivalent agent team orchestration using the OpenCode SDK client
 * passed via PluginInput. The SDK client routes requests through Bun's in-process
 * server (not a real TCP connection), so direct fetch() to localhost will fail —
 * OpenCode's server binds no public TCP port; the serverUrl is a routing prefix
 * used only inside the Bun request handler.
 *
 * The v1 SDK (used by @opencode-ai/plugin) uses different URL templates from v2:
 *   - v1: "/session/{id}/prompt_async"   — path param key is `id`
 *   - v2: "/session/{sessionID}/prompt_async" — path param key is `sessionID`
 *
 * The v1 SDK spreads `...options` directly into the HTTP request config, so we
 * must pass params in the correct slots:
 *   - path: { id: "ses_xxx" }  — substitutes {id} in URL template
 *   - body: { parts, system }  — JSON request body
 *   - query: { limit }         — URL query parameters
 *
 * Operations:
 * - agent_team_create  → POST /session (parent session = team)
 * - agent_team_dispatch → POST /session (child) + POST /session/:id/prompt_async
 * - agent_team_message  → POST /session/:id/prompt_async to existing teammate
 * - agent_team_status   → adapter-managed state
 * - agent_team_collect  → GET /session/:id/message to read completed work
 *
 * All state is per-coordinator-session (keyed on the calling session's ID).
 */

import { fileLog } from "../lib/file-logger.js";

// ── Types ────────────────────────────────────────────────────────

/**
 * Minimal interface for the v1 OpenCode SDK session client.
 * The full client comes from createOpencodeClient() in @opencode-ai/sdk.
 * We only type the surface we use to keep the interface narrow.
 */
export interface SdkSessionClient {
  session: {
    create(options?: Record<string, unknown>): Promise<{
      data?: { id: string; directory?: string; [k: string]: unknown };
      error?: unknown;
    }>;
    promptAsync(options: Record<string, unknown>): Promise<{
      data?: unknown;
      error?: unknown;
      response?: { status: number };
    }>;
    messages(options: Record<string, unknown>): Promise<{
      data?: Array<{
        info: { role: string; [k: string]: unknown };
        parts: Array<{ type: string; text?: string; [k: string]: unknown }>;
      }>;
      error?: unknown;
    }>;
  };
}

/** Client wrapper for agent team operations. Holds the SDK client and directory. */
export interface AgentTeamsClient {
  /** SDK client from PluginInput — routes via in-process Bun server, not real TCP */
  sdkClient: SdkSessionClient;
  /** Project directory for session context */
  directory?: string;
}

export type TeammateStatus = "running" | "idle" | "completed" | "failed" | "collected";

export interface TeammateRecord {
  sessionId: string;
  name: string;
  status: TeammateStatus;
  agent?: string;
  task: string;
  startTime: number;
  endTime?: number;
  collected: boolean;
  directory?: string;
}

export interface TeamState {
  parentSessionId: string;
  directory?: string;
  teammates: Map<string, TeammateRecord>;   // keyed by teammate name
}

export interface TaskEntry {
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
  owner?: string;
}

// ── Default permissions for sub-agent sessions ──────────────────
// Matches the permission ruleset that OpenCode's native Task tool applies.
// Without this, SDK-spawned sub-sessions freeze on tool execution.

const DEFAULT_SUBAGENT_PERMISSIONS = [
  { permission: "todowrite", pattern: "*", action: "deny" },
  { permission: "todoread", pattern: "*", action: "deny" },
  { permission: "task", pattern: "*", action: "deny" },
];

// ── Module-level state (per coordinator session) ─────────────────

/** team name → TeamState, keyed per coordinator session */
const teamRegistry = new Map<string, Map<string, TeamState>>();

/** task board per coordinator session */
const taskBoards = new Map<string, TaskEntry[]>();

// ── Internal helpers ─────────────────────────────────────────────

/** Safely stringify an unknown error value — handles objects, strings, and nulls. */
function stringifyError(err: unknown): string {
  if (err === null || err === undefined) return "unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return "unstringifiable error";
  }
}

/**
 * Create a session via the v1 SDK with correct body structure.
 * v1 SDK spreads options directly, so body params must be in `body:`.
 *
 * The `permission` field is not in the v1 SDK TypeScript types but IS
 * accepted by the HTTP endpoint (confirmed via v2 SDK types and DB evidence).
 * The v1 SDK spreads `...options` into the request, so extra body fields
 * pass through to the server unfiltered.
 */
async function sdkSessionCreate(
  client: AgentTeamsClient,
  params: {
    parentID?: string;
    title?: string;
    directory?: string;
    permission?: Array<{ permission: string; pattern: string; action: string }>;
  },
): Promise<{ data?: { id: string; directory?: string; [k: string]: unknown }; error?: unknown }> {
  fileLog(`[agent-teams] SDK session.create title="${params.title ?? ""}" parentID=${params.parentID ?? "none"} permission=${params.permission ? "yes" : "no"}`);
  try {
    const result = await client.sdkClient.session.create({
      body: {
        parentID: params.parentID,
        title: params.title,
        directory: params.directory,
        ...(params.permission ? { permission: params.permission } : {}),
      },
    });
    if (result.error) {
      fileLog(`[agent-teams] session.create error: ${stringifyError(result.error)}`);
    } else {
      fileLog(`[agent-teams] session.create ok: id=${result.data?.id ?? "?"}`);
    }
    return result;
  } catch (err) {
    return { error: stringifyError(err) };
  }
}

/**
 * Send a prompt asynchronously via the v1 SDK with correct path + body structure.
 * v1 SDK: path param key is `id` (not `sessionID`), body contains parts/system/agent.
 */
async function sdkPromptAsync(
  client: AgentTeamsClient,
  sessionID: string,
  params: {
    directory?: string;
    parts?: Array<{ type: "text"; text: string }>;
    system?: string;
    agent?: string;
  },
): Promise<{ data?: unknown; error?: unknown }> {
  fileLog(`[agent-teams] SDK session.promptAsync path.id=${sessionID}`);
  try {
    const result = await client.sdkClient.session.promptAsync({
      path: { id: sessionID },
      body: {
        ...(params.parts ? { parts: params.parts } : {}),
        ...(params.system ? { system: params.system } : {}),
        ...(params.agent ? { agent: params.agent } : {}),
      },
      ...(params.directory ? { query: { directory: params.directory } } : {}),
    });

    // v1 SDK returns { data, error } — also check for HTTP 204 (no content = success)
    const status = (result as { response?: { status: number } }).response?.status;
    if (result.error && status !== 204) {
      fileLog(`[agent-teams] promptAsync error: ${stringifyError(result.error)}`);
      return { error: result.error };
    }
    fileLog(`[agent-teams] promptAsync ok for session=${sessionID}`);
    return { data: result.data ?? {} };
  } catch (err) {
    return { error: stringifyError(err) };
  }
}

/**
 * Get session messages via the v1 SDK with correct path + query structure.
 * v1 SDK: path param key is `id`, query contains limit.
 */
async function sdkSessionMessages(
  client: AgentTeamsClient,
  sessionID: string,
  params: { directory?: string; limit?: number },
): Promise<{
  data?: Array<{
    info: { role: string; [k: string]: unknown };
    parts: Array<{ type: string; text?: string; [k: string]: unknown }>;
  }>;
  error?: unknown;
}> {
  fileLog(`[agent-teams] SDK session.messages path.id=${sessionID}`);
  try {
    const query: Record<string, unknown> = {};
    if (params.directory) query.directory = params.directory;
    if (params.limit !== undefined) query.limit = params.limit;

    const result = await client.sdkClient.session.messages({
      path: { id: sessionID },
      query,
    });
    if (result.error) {
      fileLog(`[agent-teams] session.messages error: ${stringifyError(result.error)}`);
    }
    return result;
  } catch (err) {
    return { error: stringifyError(err) };
  }
}

function getTeams(coordinatorSessionId: string): Map<string, TeamState> {
  let teams = teamRegistry.get(coordinatorSessionId);
  if (!teams) {
    teams = new Map();
    teamRegistry.set(coordinatorSessionId, teams);
  }
  return teams;
}

function getTaskBoard(coordinatorSessionId: string): TaskEntry[] {
  let board = taskBoards.get(coordinatorSessionId);
  if (!board) {
    board = [];
    taskBoards.set(coordinatorSessionId, board);
  }
  return board;
}

// ── Public API ───────────────────────────────────────────────────

export interface CreateResult {
  success: boolean;
  teamName?: string;
  parentSessionId?: string;
  error?: string;
}

/**
 * Create a new agent team by spawning a parent session.
 * The parent session is linked to the coordinator via parentID to ensure
 * OpenCode recognizes it as a proper sub-session in the hierarchy.
 */
export async function agentTeamCreate(
  client: AgentTeamsClient,
  coordinatorSessionId: string,
  teamName: string,
  directory?: string,
): Promise<CreateResult> {
  try {
    const teams = getTeams(coordinatorSessionId);

    if (teams.has(teamName)) {
      return { success: false, error: `team already exists: ${teamName}` };
    }

    const result = await sdkSessionCreate(client, {
      parentID: coordinatorSessionId,
      title: `[team] ${teamName}`,
      directory,
      permission: DEFAULT_SUBAGENT_PERMISSIONS,
    });

    if (result.error || !result.data) {
      const errMsg = result.error ? stringifyError(result.error) : "no data returned";
      fileLog(`[agent-teams] create team failed: ${errMsg}`);
      return { success: false, error: `failed to create team session: ${errMsg}` };
    }

    const parentSessionId = result.data.id;
    const sessionDir = result.data.directory ?? directory;
    teams.set(teamName, {
      parentSessionId,
      directory: sessionDir,
      teammates: new Map(),
    });

    fileLog(`[agent-teams] team created: ${teamName} parentSession=${parentSessionId}`);
    return { success: true, teamName, parentSessionId };
  } catch (err) {
    fileLog(`[agent-teams] create team error: ${stringifyError(err)}`);
    return { success: false, error: stringifyError(err) };
  }
}

export interface DispatchResult {
  success: boolean;
  teammateSessionId?: string;
  teammateName?: string;
  error?: string;
}

/**
 * Dispatch a teammate: create a child session under the team parent and send it a prompt.
 */
export async function agentTeamDispatch(
  client: AgentTeamsClient,
  coordinatorSessionId: string,
  teamName: string,
  teammateName: string,
  task: string,
  agent?: string,
  directory?: string,
): Promise<DispatchResult> {
  try {
    const teams = getTeams(coordinatorSessionId);
    const team = teams.get(teamName);

    if (!team) {
      return { success: false, error: `team does not exist: ${teamName}` };
    }

    if (team.teammates.has(teammateName)) {
      return { success: false, error: `teammate already exists: ${teammateName}` };
    }

    // Create child session under the team parent with proper permissions
    const teamDir = directory ?? team.directory;
    const createResult = await sdkSessionCreate(client, {
      parentID: team.parentSessionId,
      title: `[teammate] ${teammateName}`,
      directory: teamDir,
      permission: DEFAULT_SUBAGENT_PERMISSIONS,
    });

    if (createResult.error || !createResult.data) {
      const errMsg = createResult.error ? stringifyError(createResult.error) : "no data returned";
      fileLog(`[agent-teams] dispatch create session failed: ${errMsg}`);
      return { success: false, error: `failed to create teammate session: ${errMsg}` };
    }

    const teammateSessionId = createResult.data.id;
    const teammateDir = createResult.data.directory ?? teamDir;

    // Store teammate record
    const record: TeammateRecord = {
      sessionId: teammateSessionId,
      name: teammateName,
      status: "running",
      agent,
      task,
      startTime: Date.now(),
      collected: false,
      directory: teammateDir,
    };
    team.teammates.set(teammateName, record);

    // Build system prompt with team context
    const systemPrompt = [
      `You are teammate "${teammateName}" on team "${teamName}".`,
      `Your assigned task: ${task}`,
      agent ? `Agent type: ${agent}` : "",
      "Complete your task and provide a clear summary of results.",
    ].filter(Boolean).join("\n");

    // Send the initial prompt via SDK with correct v1 param structure
    const promptResult = await sdkPromptAsync(client, teammateSessionId, {
      directory: teammateDir,
      parts: [{ type: "text" as const, text: task }],
      system: systemPrompt,
      agent,
    });

    if (promptResult.error) {
      fileLog(`[agent-teams] dispatch promptAsync failed: ${stringifyError(promptResult.error)}`);
      record.status = "failed";
      record.endTime = Date.now();
      return { success: false, error: `failed to send prompt: ${stringifyError(promptResult.error)}` };
    }

    fileLog(`[agent-teams] dispatched teammate=${teammateName} session=${teammateSessionId} team=${teamName}`);
    return { success: true, teammateSessionId, teammateName };
  } catch (err) {
    fileLog(`[agent-teams] dispatch error: ${stringifyError(err)}`);
    return { success: false, error: stringifyError(err) };
  }
}

export interface MessageResult {
  success: boolean;
  error?: string;
}

/**
 * Send a message to an existing teammate session.
 */
export async function agentTeamMessage(
  client: AgentTeamsClient,
  coordinatorSessionId: string,
  teamName: string,
  teammateName: string,
  message: string,
  directory?: string,
): Promise<MessageResult> {
  try {
    const teams = getTeams(coordinatorSessionId);
    const team = teams.get(teamName);

    if (!team) {
      return { success: false, error: `team does not exist: ${teamName}` };
    }

    const teammate = team.teammates.get(teammateName);
    if (!teammate) {
      return { success: false, error: `teammate not found: ${teammateName}` };
    }

    const result = await sdkPromptAsync(client, teammate.sessionId, {
      directory: teammate.directory ?? directory ?? team.directory,
      parts: [{ type: "text" as const, text: message }],
    });

    if (result.error) {
      return { success: false, error: `failed to send message: ${stringifyError(result.error)}` };
    }

    // If teammate was idle, mark as running again
    if (teammate.status === "idle" || teammate.status === "completed") {
      teammate.status = "running";
    }

    fileLog(`[agent-teams] message sent to ${teammateName} in team ${teamName}`);
    return { success: true };
  } catch (err) {
    fileLog(`[agent-teams] message error: ${stringifyError(err)}`);
    return { success: false, error: stringifyError(err) };
  }
}

export interface StatusResult {
  teams: Array<{
    name: string;
    parentSessionId: string;
    teammates: Array<{
      name: string;
      sessionId: string;
      status: TeammateStatus;
      task: string;
      durationMs: number;
      collected: boolean;
    }>;
  }>;
  taskBoard: TaskEntry[];
}

/**
 * Get the status of all teams and their teammates for this coordinator session.
 */
export function agentTeamStatus(
  coordinatorSessionId: string,
  teamName?: string,
): StatusResult {
  const teams = getTeams(coordinatorSessionId);
  const board = getTaskBoard(coordinatorSessionId);

  const teamEntries: StatusResult["teams"] = [];
  for (const [name, state] of teams) {
    if (teamName && name !== teamName) continue;

    const teammates: StatusResult["teams"][0]["teammates"] = [];
    for (const [, record] of state.teammates) {
      teammates.push({
        name: record.name,
        sessionId: record.sessionId,
        status: record.status,
        task: record.task,
        durationMs: (record.endTime ?? Date.now()) - record.startTime,
        collected: record.collected,
      });
    }

    teamEntries.push({
      name,
      parentSessionId: state.parentSessionId,
      teammates,
    });
  }

  return { teams: teamEntries, taskBoard: board };
}

export interface CollectResult {
  collected: Array<{
    teammateName: string;
    sessionId: string;
    task: string;
    messages: string[];
  }>;
}

/**
 * Collect results from completed teammate sessions by reading their messages.
 */
export async function agentTeamCollect(
  client: AgentTeamsClient,
  coordinatorSessionId: string,
  teamName?: string,
  directory?: string,
): Promise<CollectResult> {
  const teams = getTeams(coordinatorSessionId);
  const collected: CollectResult["collected"] = [];

  for (const [name, state] of teams) {
    if (teamName && name !== teamName) continue;

    for (const [, record] of state.teammates) {
      // Skip already-collected or still-running teammates
      if (record.collected) continue;
      if (record.status === "running") continue;

      try {
        const msgResult = await sdkSessionMessages(client, record.sessionId, {
          directory: record.directory ?? directory,
          limit: 50,
        });

        const messages: string[] = [];
        if (msgResult.data) {
          for (const msg of msgResult.data) {
            // Collect assistant text parts
            if (msg.info.role === "assistant") {
              for (const part of msg.parts) {
                if (part.type === "text" && part.text) {
                  messages.push(part.text);
                }
              }
            }
          }
        }

        record.collected = true;
        record.status = "collected";
        record.endTime = record.endTime ?? Date.now();

        collected.push({
          teammateName: record.name,
          sessionId: record.sessionId,
          task: record.task,
          messages,
        });

        fileLog(`[agent-teams] collected results from ${record.name}`);
      } catch (err) {
        fileLog(`[agent-teams] collect error for ${record.name}: ${stringifyError(err)}`);
      }
    }
  }

  return { collected };
}

/**
 * Update a teammate's status (called from event handler when session.idle fires).
 */
export function updateTeammateStatus(
  coordinatorSessionId: string,
  teammateSessionId: string,
  newStatus: TeammateStatus,
): void {
  const teams = getTeams(coordinatorSessionId);
  for (const [, state] of teams) {
    for (const [, record] of state.teammates) {
      if (record.sessionId === teammateSessionId) {
        record.status = newStatus;
        if (newStatus === "idle" || newStatus === "completed" || newStatus === "failed") {
          record.endTime = record.endTime ?? Date.now();
        }
        return;
      }
    }
  }
}

/**
 * Update a teammate's status by scanning ALL coordinator registries.
 * Used by the session.idle event handler, which only knows the teammate's
 * session ID — not which coordinator it belongs to.
 */
export function updateTeammateStatusGlobal(
  teammateSessionId: string,
  newStatus: TeammateStatus,
): void {
  fileLog(`[agent-teams] updateTeammateStatusGlobal: sid=${teammateSessionId} status=${newStatus} registrySize=${teamRegistry.size}`);
  for (const [coordinatorId] of teamRegistry) {
    const teams = getTeams(coordinatorId);
    for (const [, state] of teams) {
      for (const [, record] of state.teammates) {
        if (record.sessionId === teammateSessionId) {
          fileLog(`[agent-teams] status update: teammate=${record.name} session=${teammateSessionId} ${record.status}→${newStatus}`);
          record.status = newStatus;
          if (newStatus === "idle" || newStatus === "completed" || newStatus === "failed") {
            record.endTime = record.endTime ?? Date.now();
          }
          return;
        }
      }
    }
  }
  fileLog(`[agent-teams] updateTeammateStatusGlobal: no match found for sid=${teammateSessionId}`);
}

/**
 * Clear all agent team state for a coordinator session (called on session end).
 */
export function clearAgentTeamsState(coordinatorSessionId: string): void {
  teamRegistry.delete(coordinatorSessionId);
  taskBoards.delete(coordinatorSessionId);
}

/**
 * Get all teammate records for a coordinator session (for testing/inspection).
 */
export function getTeamRegistry(coordinatorSessionId: string): Map<string, TeamState> {
  return getTeams(coordinatorSessionId);
}
