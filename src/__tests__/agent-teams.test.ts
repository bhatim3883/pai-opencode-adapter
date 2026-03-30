import { describe, it, expect, beforeEach } from "bun:test";

import {
  agentTeamCreate,
  agentTeamDispatch,
  agentTeamMessage,
  agentTeamStatus,
  agentTeamCollect,
  clearAgentTeamsState,
  getTeamRegistry,
  type AgentTeamsClient,
  type SdkSessionClient,
} from "../handlers/agent-teams.js";

const SESSION = "test-coordinator-session";

// ── Mock SDK client ──────────────────────────────────────────────
//
// Simulates the v1 OpenCode SDK session client. We mock at the SDK level
// (not at the fetch level) because the SDK client uses in-process Bun routing,
// not real HTTP. Tests exercise the handler logic + v1 param structure.

let sessionCounter = 0;
const mockSessions = new Map<string, {
  id: string;
  title: string;
  parentID?: string;
  directory?: string;
  messages: Array<{
    info: { role: string };
    parts: Array<{ type: string; text?: string }>;
  }>;
}>();

/** Controls which operations should fail */
let failOn: "create" | "promptAsync" | "messages" | null = null;

function makeMockSdkClient(): SdkSessionClient {
  return {
    session: {
      create(options?: Record<string, unknown>) {
        if (failOn === "create") {
          return Promise.resolve({ error: "SDK create failed" });
        }
        const body = (options?.body ?? {}) as Record<string, unknown>;
        const id = `mock-session-${++sessionCounter}`;
        mockSessions.set(id, {
          id,
          title: String(body.title ?? ""),
          parentID: body.parentID ? String(body.parentID) : undefined,
          directory: body.directory ? String(body.directory) : undefined,
          messages: [],
        });
        return Promise.resolve({
          data: {
            id,
            title: String(body.title ?? ""),
            directory: body.directory ? String(body.directory) : "/mock/dir",
          },
        });
      },

      promptAsync(options: Record<string, unknown>) {
        if (failOn === "promptAsync") {
          return Promise.resolve({ error: "SDK promptAsync failed" });
        }
        const path = options.path as { id?: string } | undefined;
        const sessionID = path?.id;
        if (!sessionID) {
          return Promise.resolve({ error: "missing path.id" });
        }
        const session = mockSessions.get(sessionID);
        if (!session) {
          return Promise.resolve({ error: `session not found: ${sessionID}` });
        }
        const body = (options.body ?? {}) as { parts?: Array<{ type: string; text: string }> };
        if (body.parts) {
          session.messages.push({
            info: { role: "user" },
            parts: body.parts.map((p) => ({ type: p.type, text: p.text })),
          });
        }
        session.messages.push({
          info: { role: "assistant" },
          parts: [{ type: "text", text: `Completed task for session ${sessionID}` }],
        });
        return Promise.resolve({ data: {} });
      },

      messages(options: Record<string, unknown>) {
        if (failOn === "messages") {
          return Promise.resolve({ error: "SDK messages failed" });
        }
        const path = options.path as { id?: string } | undefined;
        const sessionID = path?.id;
        if (!sessionID) {
          return Promise.resolve({ error: "missing path.id" });
        }
        const session = mockSessions.get(sessionID);
        if (!session) {
          return Promise.resolve({ error: `session not found: ${sessionID}` });
        }
        const query = (options.query ?? {}) as { limit?: number };
        const limit = query.limit ?? 50;
        return Promise.resolve({ data: session.messages.slice(0, limit) });
      },
    },
  };
}

function createMockClient(): AgentTeamsClient {
  sessionCounter = 0;
  mockSessions.clear();
  failOn = null;
  return { sdkClient: makeMockSdkClient(), directory: "/mock/dir" };
}

function createFailingClient(fail: "create" | "promptAsync" | "messages"): AgentTeamsClient {
  sessionCounter = 0;
  mockSessions.clear();
  failOn = fail;
  return { sdkClient: makeMockSdkClient(), directory: "/mock/dir" };
}

// ── Tests ────────────────────────────────────────────────────────

describe("agentTeamCreate", () => {
  beforeEach(() => {
    clearAgentTeamsState(SESSION);
  });

  it("creates a team with parent session", async () => {
    const client = createMockClient();
    const result = await agentTeamCreate(client, SESSION, "alpha-team");
    expect(result.success).toBe(true);
    expect(result.teamName).toBe("alpha-team");
    expect(result.parentSessionId).toBeDefined();
    expect(typeof result.parentSessionId).toBe("string");
  });

  it("stores team in registry", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "bravo-team");
    const registry = getTeamRegistry(SESSION);
    expect(registry.has("bravo-team")).toBe(true);
    expect(registry.get("bravo-team")!.parentSessionId).toBeDefined();
  });

  it("returns error if team name already exists", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "dup-team");
    const result = await agentTeamCreate(client, SESSION, "dup-team");
    expect(result.success).toBe(false);
    expect(result.error).toContain("team already exists");
  });

  it("returns error when SDK create fails", async () => {
    const client = createFailingClient("create");
    const result = await agentTeamCreate(client, SESSION, "fail-team");
    expect(result.success).toBe(false);
    expect(result.error).toContain("failed to create team session");
  });

  it("separate sessions have independent teams", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "team-a");
    await agentTeamCreate(client, "other-session", "team-a");
    const reg1 = getTeamRegistry(SESSION);
    const reg2 = getTeamRegistry("other-session");
    expect(reg1.has("team-a")).toBe(true);
    expect(reg2.has("team-a")).toBe(true);
    expect(reg1.get("team-a")!.parentSessionId).not.toBe(reg2.get("team-a")!.parentSessionId);
    clearAgentTeamsState("other-session");
  });
});

describe("agentTeamDispatch", () => {
  beforeEach(() => {
    clearAgentTeamsState(SESSION);
  });

  it("dispatches a teammate to a team", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "dev-team");
    const result = await agentTeamDispatch(client, SESSION, "dev-team", "coder-1", "write tests");
    expect(result.success).toBe(true);
    expect(result.teammateName).toBe("coder-1");
    expect(result.teammateSessionId).toBeDefined();
  });

  it("creates child session under team parent", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "team-x");
    await agentTeamDispatch(client, SESSION, "team-x", "worker-1", "do work");
    const registry = getTeamRegistry(SESSION);
    const team = registry.get("team-x")!;
    const teammate = team.teammates.get("worker-1")!;
    expect(teammate.sessionId).toBeDefined();
    expect(teammate.status).toBe("running");
  });

  it("sends initial prompt via SDK with correct path.id", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "prompt-team");
    const result = await agentTeamDispatch(client, SESSION, "prompt-team", "bot-1", "analyze data");
    expect(result.success).toBe(true);
    // Verify the mock session got the prompt via path.id (not {id} placeholder)
    const session = mockSessions.get(result.teammateSessionId!);
    expect(session).toBeDefined();
    expect(session!.messages.length).toBeGreaterThan(0);
  });

  it("stores teammate record with session ID", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "record-team");
    await agentTeamDispatch(client, SESSION, "record-team", "agent-a", "task-1");
    const registry = getTeamRegistry(SESSION);
    const teammate = registry.get("record-team")!.teammates.get("agent-a")!;
    expect(teammate.name).toBe("agent-a");
    expect(teammate.task).toBe("task-1");
    expect(teammate.startTime).toBeGreaterThan(0);
  });

  it("injects system prompt with team context", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "sys-team");
    const result = await agentTeamDispatch(client, SESSION, "sys-team", "helper", "help out", "researcher");
    expect(result.success).toBe(true);
  });

  it("returns error if team does not exist", async () => {
    const client = createMockClient();
    const result = await agentTeamDispatch(client, SESSION, "nonexistent", "bot", "task");
    expect(result.success).toBe(false);
    expect(result.error).toContain("team does not exist");
  });

  it("returns error if teammate name already exists", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "dup-mate-team");
    await agentTeamDispatch(client, SESSION, "dup-mate-team", "same-name", "task-1");
    const result = await agentTeamDispatch(client, SESSION, "dup-mate-team", "same-name", "task-2");
    expect(result.success).toBe(false);
    expect(result.error).toContain("teammate already exists");
  });

  it("marks teammate failed when promptAsync fails", async () => {
    // Create team with working client first
    const workingClient = createMockClient();
    await agentTeamCreate(workingClient, SESSION, "fail-prompt-team");

    // Now set failOn to promptAsync — create will succeed but prompt will fail
    failOn = "promptAsync";
    const result = await agentTeamDispatch(workingClient, SESSION, "fail-prompt-team", "fail-bot", "task");
    expect(result.success).toBe(false);
    expect(result.error).toContain("failed to send prompt");
  });
});

describe("agentTeamMessage", () => {
  beforeEach(() => {
    clearAgentTeamsState(SESSION);
  });

  it("sends message to existing teammate", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "msg-team");
    await agentTeamDispatch(client, SESSION, "msg-team", "responder", "initial task");
    const result = await agentTeamMessage(client, SESSION, "msg-team", "responder", "follow up");
    expect(result.success).toBe(true);
  });

  it("returns error if team does not exist", async () => {
    const client = createMockClient();
    const result = await agentTeamMessage(client, SESSION, "no-team", "bot", "hello");
    expect(result.success).toBe(false);
    expect(result.error).toContain("team does not exist");
  });

  it("returns error if teammate not found", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "team-no-mate");
    const result = await agentTeamMessage(client, SESSION, "team-no-mate", "ghost", "hello");
    expect(result.success).toBe(false);
    expect(result.error).toContain("teammate not found");
  });

  it("accepts message content as string", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "str-team");
    await agentTeamDispatch(client, SESSION, "str-team", "bot", "task");
    const result = await agentTeamMessage(client, SESSION, "str-team", "bot", "do this specific thing");
    expect(result.success).toBe(true);
  });
});

describe("agentTeamStatus", () => {
  beforeEach(() => {
    clearAgentTeamsState(SESSION);
  });

  it("returns task board entries for team", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "status-team");
    await agentTeamDispatch(client, SESSION, "status-team", "bot-1", "task A");
    await agentTeamDispatch(client, SESSION, "status-team", "bot-2", "task B");
    const status = agentTeamStatus(SESSION, "status-team");
    expect(status.teams.length).toBe(1);
    expect(status.teams[0]!.teammates.length).toBe(2);
  });

  it("returns teammate list with names and statuses", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "named-team");
    await agentTeamDispatch(client, SESSION, "named-team", "alice", "research");
    const status = agentTeamStatus(SESSION, "named-team");
    const teammate = status.teams[0]!.teammates[0]!;
    expect(teammate.name).toBe("alice");
    expect(teammate.status).toBe("running");
    expect(teammate.task).toBe("research");
  });

  it("returns empty results for nonexistent team", () => {
    const status = agentTeamStatus(SESSION, "nonexistent");
    expect(status.teams).toEqual([]);
  });

  it("returns all teams when no filter specified", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "team-1");
    await agentTeamCreate(client, SESSION, "team-2");
    const status = agentTeamStatus(SESSION);
    expect(status.teams.length).toBe(2);
  });

  it("includes duration in milliseconds", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "dur-team");
    await agentTeamDispatch(client, SESSION, "dur-team", "bot", "task");
    const status = agentTeamStatus(SESSION, "dur-team");
    expect(status.teams[0]!.teammates[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("includes collected flag", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "coll-team");
    await agentTeamDispatch(client, SESSION, "coll-team", "bot", "task");
    const status = agentTeamStatus(SESSION, "coll-team");
    expect(status.teams[0]!.teammates[0]!.collected).toBe(false);
  });
});

describe("agentTeamCollect", () => {
  beforeEach(() => {
    clearAgentTeamsState(SESSION);
  });

  it("reads messages from completed teammate sessions", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "collect-team");
    await agentTeamDispatch(client, SESSION, "collect-team", "bot", "do work");

    // Mark teammate as idle (simulating session.idle event)
    const registry = getTeamRegistry(SESSION);
    const teammate = registry.get("collect-team")!.teammates.get("bot")!;
    teammate.status = "idle";

    const result = await agentTeamCollect(client, SESSION, "collect-team");
    expect(result.collected.length).toBe(1);
    expect(result.collected[0]!.teammateName).toBe("bot");
    expect(result.collected[0]!.messages.length).toBeGreaterThan(0);
  });

  it("marks collected results to prevent double-collection", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "dedup-team");
    await agentTeamDispatch(client, SESSION, "dedup-team", "bot", "task");

    const registry = getTeamRegistry(SESSION);
    registry.get("dedup-team")!.teammates.get("bot")!.status = "idle";

    await agentTeamCollect(client, SESSION, "dedup-team");
    const second = await agentTeamCollect(client, SESSION, "dedup-team");
    expect(second.collected).toEqual([]);
  });

  it("skips running teammates", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "skip-team");
    await agentTeamDispatch(client, SESSION, "skip-team", "running-bot", "task");
    // Don't change status — still "running"
    const result = await agentTeamCollect(client, SESSION, "skip-team");
    expect(result.collected).toEqual([]);
  });

  it("collects from all teams when no filter", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "team-a");
    await agentTeamCreate(client, SESSION, "team-b");
    await agentTeamDispatch(client, SESSION, "team-a", "bot-a", "task-a");
    await agentTeamDispatch(client, SESSION, "team-b", "bot-b", "task-b");

    const registry = getTeamRegistry(SESSION);
    registry.get("team-a")!.teammates.get("bot-a")!.status = "idle";
    registry.get("team-b")!.teammates.get("bot-b")!.status = "idle";

    const result = await agentTeamCollect(client, SESSION);
    expect(result.collected.length).toBe(2);
  });

  it("returns empty for session with no teams", async () => {
    const client = createMockClient();
    const result = await agentTeamCollect(client, SESSION);
    expect(result.collected).toEqual([]);
  });
});

describe("clearAgentTeamsState", () => {
  beforeEach(() => {
    clearAgentTeamsState(SESSION);
  });

  it("clears team registry for session", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "clear-team");
    clearAgentTeamsState(SESSION);
    const registry = getTeamRegistry(SESSION);
    expect(registry.size).toBe(0);
  });

  it("clears task board for session", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "board-team");
    clearAgentTeamsState(SESSION);
    const status = agentTeamStatus(SESSION);
    expect(status.taskBoard).toEqual([]);
  });

  it("clears teammate records for session", async () => {
    const client = createMockClient();
    await agentTeamCreate(client, SESSION, "mate-team");
    await agentTeamDispatch(client, SESSION, "mate-team", "bot", "task");
    clearAgentTeamsState(SESSION);
    const registry = getTeamRegistry(SESSION);
    expect(registry.size).toBe(0);
  });

  it("clear on empty session does not throw", () => {
    expect(() => clearAgentTeamsState("never-used-session")).not.toThrow();
  });
});
