import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import PaiPlugin, {
  healthCheck,
  _subagentSessionsForTest,
  _pendingSubagentSpawnsForTest,
  _SPAWN_TIMEOUT_MS_FOR_TEST,
} from "../plugin/pai-unified.js";

// The plugin is now a function — call it once to get the hooks object
let hooks: Record<string, unknown>;

beforeAll(async () => {
  hooks = await PaiPlugin({});
});

describe("plugin function", () => {
  it("default export is a function (Plugin type)", () => {
    expect(typeof PaiPlugin).toBe("function");
  });

  it("returns an object when called", () => {
    expect(typeof hooks).toBe("object");
    expect(hooks).not.toBeNull();
  });
});

describe("hook registration", () => {
  it("registers permission.ask hook", () => {
    expect(typeof hooks["permission.ask"]).toBe("function");
  });

  it("registers experimental.chat.system.transform hook", () => {
    expect(typeof hooks["experimental.chat.system.transform"]).toBe("function");
  });

  it("registers tool.execute.before hook", () => {
    expect(typeof hooks["tool.execute.before"]).toBe("function");
  });

  it("registers tool.execute.after hook", () => {
    expect(typeof hooks["tool.execute.after"]).toBe("function");
  });

  it("registers chat.message hook", () => {
    expect(typeof hooks["chat.message"]).toBe("function");
  });

  it("registers experimental.session.compacting hook", () => {
    expect(typeof hooks["experimental.session.compacting"]).toBe("function");
  });

  it("registers event hook", () => {
    expect(typeof hooks["event"]).toBe("function");
  });
});

describe("tool registration", () => {
  it("no custom tool block registered (native OpenCode skill tool used instead)", () => {
    // OpenCode v1.3.0 has a native skill tool built-in that reads SKILL.md files.
    // The adapter no longer registers a custom skill tool — it relies on the native one.
    // The `tool` key should either be absent or an empty object.
    const tools = hooks["tool"] as Record<string, unknown> | undefined;
    if (tools !== undefined) {
      expect(Object.keys(tools).length).toBe(0);
    } else {
      expect(tools).toBeUndefined();
    }
  });
});

describe("healthCheck", () => {
  it("returns status ok", () => {
    const result = healthCheck();
    expect(result.status).toBe("ok");
  });

  it("returns plugin name", () => {
    const result = healthCheck();
    expect(result.plugin).toBe("pai-adapter");
  });

  it("returns version", () => {
    const result = healthCheck();
    expect(result.version).toBe("0.9.1");
  });
});

describe("error isolation — hooks do not throw on malformed input", () => {
  it("permission.ask does not throw on empty input", async () => {
    const fn = hooks["permission.ask"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(fn({}, {})).resolves.toBeUndefined();
  });

  it("tool.execute.before does not throw on empty input", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(fn({}, {})).resolves.toBeUndefined();
  });

  it("tool.execute.after does not throw on empty input", async () => {
    const fn = hooks["tool.execute.after"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(fn({}, {})).resolves.toBeUndefined();
  });

  it("chat.message does not throw on empty input", async () => {
    const fn = hooks["chat.message"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(fn({}, {})).resolves.toBeUndefined();
  });

  it("experimental.session.compacting does not throw on empty input", async () => {
    const fn = hooks["experimental.session.compacting"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(fn({}, {})).resolves.toBeUndefined();
  });

  it("event does not throw on unknown event type", async () => {
    const fn = hooks["event"] as (i: unknown) => Promise<void>;
    await expect(fn({ event: { type: "totally.unknown.event", sessionId: "x" } })).resolves.toBeUndefined();
  });

  it("event does not throw on session.idle", async () => {
    const fn = hooks["event"] as (i: unknown) => Promise<void>;
    await expect(fn({ event: { type: "session.idle", sessionId: "x", durationMs: 60000 } })).resolves.toBeUndefined();
  });

  it("event does not throw on session.compacted", async () => {
    const fn = hooks["event"] as (i: unknown) => Promise<void>;
    await expect(fn({ event: { type: "session.compacted", sessionId: "x" } })).resolves.toBeUndefined();
  });

  it("event does not throw on session.end", async () => {
    const fn = hooks["event"] as (i: unknown) => Promise<void>;
    await expect(fn({ event: { type: "session.end", sessionId: "x" } })).resolves.toBeUndefined();
  });

  it("event does not throw on session.start", async () => {
    const fn = hooks["event"] as (i: unknown) => Promise<void>;
    await expect(fn({ event: { type: "session.start", sessionId: "test-event-start" } })).resolves.toBeUndefined();
  });
});

describe("hook behavior", () => {
  it("hooks are async (return promises)", async () => {
    const fn = hooks["permission.ask"] as (i: unknown, o: unknown) => unknown;
    const result = fn({}, {});
    expect(result).toBeInstanceOf(Promise);
  });

  it("experimental.chat.system.transform is async", async () => {
    const fn = hooks["experimental.chat.system.transform"] as (i: unknown, o: unknown) => unknown;
    const result = fn({}, { system: [] });
    expect(result).toBeInstanceOf(Promise);
  });
});

describe("permission.ask — external_directory auto-allow", () => {
  const home = process.env.HOME ?? "";
  const fn = () => hooks["permission.ask"] as (i: unknown, o: unknown) => Promise<void>;

  it("auto-allows ~/.claude/ paths", async () => {
    const output: { status?: string } = {};
    await fn()({ permission: "external_directory", patterns: [`${home}/.claude/PAI/Algorithm/*`] }, output);
    expect(output.status).toBe("allow");
  });

  it("auto-allows ~/.config/opencode/ paths", async () => {
    const output: { status?: string } = {};
    await fn()({ permission: "external_directory", patterns: [`${home}/.config/opencode/agents/*`] }, output);
    expect(output.status).toBe("allow");
  });

  it("auto-allows ~/.config/opencode/ root path", async () => {
    const output: { status?: string } = {};
    await fn()({ permission: "external_directory", patterns: [`${home}/.config/opencode/*`] }, output);
    expect(output.status).toBe("allow");
  });

  it("does NOT auto-allow unknown external directories", async () => {
    const output: { status?: string } = {};
    await fn()({ permission: "external_directory", patterns: ["/tmp/some-random-dir/*"] }, output);
    expect(output.status).toBeUndefined();
  });

  it("does NOT auto-allow if ANY pattern is outside PAI paths", async () => {
    const output: { status?: string } = {};
    await fn()({
      permission: "external_directory",
      patterns: [`${home}/.claude/PAI/*`, "/etc/shadow/*"],
    }, output);
    expect(output.status).not.toBe("allow");
  });

  it("does not interfere with empty patterns array", async () => {
    const output: { status?: string } = {};
    await fn()({ permission: "external_directory", patterns: [] }, output);
    expect(output.status).toBeUndefined();
  });
});

describe("skill invocation logging", () => {
  it("tool.execute.before does not throw when tool is 'skill'", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(
      fn({ tool: "skill", sessionID: "test-skill-session", args: { name: "Research" } }, {}),
    ).resolves.toBeUndefined();
  });

  it("tool.execute.before does not throw when tool is 'Skill' (capitalized)", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(
      fn({ tool: "Skill", sessionID: "test-skill-session", args: { name: "FirstPrinciples" } }, {}),
    ).resolves.toBeUndefined();
  });

  it("tool.execute.after does not throw when tool is 'skill'", async () => {
    const fn = hooks["tool.execute.after"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(
      fn({ tool: "skill", sessionID: "test-skill-session", args: { name: "Research" } }, {}),
    ).resolves.toBeUndefined();
  });

  it("tool.execute.after does not throw when tool is 'Skill' (capitalized)", async () => {
    const fn = hooks["tool.execute.after"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(
      fn({ tool: "Skill", sessionID: "test-skill-session", args: { name: "Council" } }, {}),
    ).resolves.toBeUndefined();
  });

  it("skill logging handles missing args gracefully", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(
      fn({ tool: "skill", sessionID: "test-skill-session" }, {}),
    ).resolves.toBeUndefined();
  });

  it("skill logging handles empty args gracefully", async () => {
    const fn = hooks["tool.execute.after"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(
      fn({ tool: "skill", sessionID: "test-skill-session", args: {} }, {}),
    ).resolves.toBeUndefined();
  });
});

describe("task invocation logging", () => {
  afterEach(() => {
    // Clean up pending spawns created by Task tool.execute.before calls
    _pendingSubagentSpawnsForTest.delete("test-task-session");
  });

  it("tool.execute.before does not throw when tool is 'task'", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(
      fn({
        tool: "task",
        sessionID: "test-task-session",
        args: { subagent_type: "engineer", description: "Build feature X" },
      }, {}),
    ).resolves.toBeUndefined();
  });

  it("tool.execute.before does not throw when tool is 'Task' (capitalized)", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(
      fn({
        tool: "Task",
        sessionID: "test-task-session",
        args: { subagent_type: "research", description: "Research topic" },
      }, {}),
    ).resolves.toBeUndefined();
  });

  it("tool.execute.after does not throw when tool is 'task'", async () => {
    const fn = hooks["tool.execute.after"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(
      fn({
        tool: "task",
        sessionID: "test-task-session",
        args: { subagent_type: "thinker", description: "Analyze approach" },
      }, {}),
    ).resolves.toBeUndefined();
  });

  it("tool.execute.after does not throw when tool is 'Task' (capitalized)", async () => {
    const fn = hooks["tool.execute.after"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(
      fn({
        tool: "Task",
        sessionID: "test-task-session",
        args: { subagent_type: "explorer", description: "Explore codebase" },
      }, {}),
    ).resolves.toBeUndefined();
  });

  it("task logging handles missing args gracefully", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(
      fn({ tool: "Task", sessionID: "test-task-session" }, {}),
    ).resolves.toBeUndefined();
  });

  it("task logging handles empty args gracefully", async () => {
    const fn = hooks["tool.execute.after"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(
      fn({ tool: "task", sessionID: "test-task-session", args: {} }, {}),
    ).resolves.toBeUndefined();
  });

  it("non-skill non-task tools do not trigger skill-tracker logging (no throw)", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    await expect(
      fn({ tool: "bash", sessionID: "test-session", args: { command: "ls" } }, {}),
    ).resolves.toBeUndefined();
  });
});

describe("subagent Task tool blocking", () => {
  const subagentSid = "test-subagent-block-session";

  beforeAll(() => {
    // Register the session as a subagent
    _subagentSessionsForTest.add(subagentSid);
  });

  afterAll(() => {
    _subagentSessionsForTest.delete(subagentSid);
    // Clean up pending spawns from the "does NOT block Task for primary" test
    _pendingSubagentSpawnsForTest.delete("primary-session-xyz");
  });

  it("blocks Task tool for subagent session", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    const output: { block?: boolean; reason?: string } = {};
    await fn(
      { tool: "Task", sessionID: subagentSid, args: { subagent_type: "engineer", description: "test" } },
      output,
    );
    expect(output.block).toBe(true);
    expect(output.reason).toContain("Subagents cannot use");
  });

  it("blocks task tool (lowercase) for subagent session", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    const output: { block?: boolean; reason?: string } = {};
    await fn(
      { tool: "task", sessionID: subagentSid, args: { subagent_type: "explorer" } },
      output,
    );
    expect(output.block).toBe(true);
  });

  it("does NOT block Skill tool for subagent session", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    const output: { block?: boolean; reason?: string } = {};
    await fn(
      { tool: "Skill", sessionID: subagentSid, args: { name: "Research" } },
      output,
    );
    expect(output.block).toBeUndefined();
  });

  it("does NOT block skill tool (lowercase) for subagent session", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    const output: { block?: boolean; reason?: string } = {};
    await fn(
      { tool: "skill", sessionID: subagentSid, args: { name: "FirstPrinciples" } },
      output,
    );
    expect(output.block).toBeUndefined();
  });

  it("blocked Task call returns helpful message mentioning Skill as alternative", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    const output: { block?: boolean; reason?: string } = {};
    await fn(
      { tool: "Task", sessionID: subagentSid, args: { subagent_type: "thinker" } },
      output,
    );
    expect(output.reason).toContain("Skill tool");
  });

  it("does NOT block Task tool for primary (non-subagent) session", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    const output: { block?: boolean; reason?: string } = {};
    await fn(
      { tool: "Task", sessionID: "primary-session-xyz", args: { subagent_type: "engineer" } },
      output,
    );
    expect(output.block).toBeUndefined();
  });

  it("does NOT block bash tool for subagent session (non-voice)", async () => {
    const fn = hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
    const output: { block?: boolean; reason?: string } = {};
    await fn(
      { tool: "bash", sessionID: subagentSid, args: { command: "ls -la" } },
      output,
    );
    expect(output.block).toBeUndefined();
  });
});

describe("subagent preamble injection in system.transform", () => {
  const subagentSid = "test-subagent-preamble-session";

  beforeAll(() => {
    _subagentSessionsForTest.add(subagentSid);
  });

  afterAll(() => {
    _subagentSessionsForTest.delete(subagentSid);
  });

  it("subagent session receives preamble in output.system", async () => {
    const fn = hooks["experimental.chat.system.transform"] as (i: unknown, o: unknown) => Promise<void>;
    const output = { system: [] as string[] };
    await fn({ sessionID: subagentSid, model: "test-model" }, output);
    const combined = output.system.join("\n");
    expect(combined).toContain("You Are a Subagent");
  });

  it("primary session does NOT receive preamble", async () => {
    const fn = hooks["experimental.chat.system.transform"] as (i: unknown, o: unknown) => Promise<void>;
    const output = { system: [] as string[] };
    await fn({ sessionID: "primary-session-no-preamble", model: "test-model" }, output);
    const combined = output.system.join("\n");
    expect(combined).not.toContain("You Are a Subagent");
  });

  it("preamble appears before PAI context in output.system", async () => {
    const fn = hooks["experimental.chat.system.transform"] as (i: unknown, o: unknown) => Promise<void>;
    const output = { system: [] as string[] };
    await fn({ sessionID: subagentSid, model: "test-model" }, output);
    // Preamble should be the first element that contains "Subagent"
    const preambleIdx = output.system.findIndex(s => s.includes("You Are a Subagent"));
    expect(preambleIdx).toBeGreaterThanOrEqual(0);
    // Any Algorithm context should come after
    const algoIdx = output.system.findIndex(s => s.includes("Algorithm"));
    if (algoIdx >= 0) {
      expect(preambleIdx).toBeLessThan(algoIdx);
    }
  });
});

describe("Task-call timing registry — subagent detection", () => {
  const toolBeforeFn = () => hooks["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
  const eventFn = () => hooks["event"] as (i: unknown) => Promise<void>;

  afterEach(() => {
    // Clean up all test sessions introduced by this describe block
    const testSessionPrefixes = [
      "primary-timing-test",
      "primary-timing-abc",
      "primary-timing-multi",
      "primary-timing-fifo",
    ];
    for (const prefix of testSessionPrefixes) {
      _pendingSubagentSpawnsForTest.delete(prefix);
      _subagentSessionsForTest.delete(prefix);
    }
    _subagentSessionsForTest.delete("spawned-sub-123");
    _subagentSessionsForTest.delete("spawned-sub-456");
    _subagentSessionsForTest.delete("spawned-fifo-1");
    _subagentSessionsForTest.delete("spawned-fifo-2");
  });

  it("Task tool.execute.before registers pending spawn for primary session", async () => {
    await toolBeforeFn()(
      { tool: "Task", sessionID: "primary-timing-test", args: { subagent_type: "engineer" } },
      {},
    );
    const pending = _pendingSubagentSpawnsForTest.get("primary-timing-test");
    expect(pending).toBeDefined();
    expect(Array.isArray(pending)).toBe(true);
    expect(pending!.length).toBeGreaterThanOrEqual(1);
  });

  it("session.created after Task call registers new session as subagent", async () => {
    // Fire Task from primary session
    await toolBeforeFn()(
      { tool: "Task", sessionID: "primary-timing-abc", args: { subagent_type: "engineer" } },
      {},
    );
    // Fire session.created for the newly spawned session
    await eventFn()({
      event: {
        type: "session.created",
        properties: { info: { id: "spawned-sub-123" } },
      },
    });
    expect(_subagentSessionsForTest.has("spawned-sub-123")).toBe(true);
  });

  it("pending spawn entry is consumed after matching", async () => {
    // Fire Task from primary session to queue a pending spawn
    await toolBeforeFn()(
      { tool: "Task", sessionID: "primary-timing-abc", args: { subagent_type: "engineer" } },
      {},
    );
    // Fire session.created to consume it
    await eventFn()({
      event: {
        type: "session.created",
        properties: { info: { id: "spawned-sub-456" } },
      },
    });
    // The entry should be consumed (queue empty or key removed)
    const pending = _pendingSubagentSpawnsForTest.get("primary-timing-abc");
    const isEmpty = pending === undefined || pending.length === 0;
    expect(isEmpty).toBe(true);
  });

  it("Task from subagent session does NOT register pending spawn", async () => {
    const subSid = "test-subagent-no-pending-spawn";
    _subagentSessionsForTest.add(subSid);
    try {
      await toolBeforeFn()(
        { tool: "Task", sessionID: subSid, args: { subagent_type: "engineer" } },
        {},
      );
      // Subagent Task calls are blocked — no pending spawn should be queued
      const pending = _pendingSubagentSpawnsForTest.get(subSid);
      const isEmpty = pending === undefined || pending.length === 0;
      expect(isEmpty).toBe(true);
    } finally {
      _subagentSessionsForTest.delete(subSid);
      _pendingSubagentSpawnsForTest.delete(subSid);
    }
  });

  it("multiple Task calls queue multiple pending spawns", async () => {
    await toolBeforeFn()(
      { tool: "Task", sessionID: "primary-timing-multi", args: { subagent_type: "engineer" } },
      {},
    );
    await toolBeforeFn()(
      { tool: "Task", sessionID: "primary-timing-multi", args: { subagent_type: "explorer" } },
      {},
    );
    const pending = _pendingSubagentSpawnsForTest.get("primary-timing-multi");
    expect(pending).toBeDefined();
    expect(pending!.length).toBe(2);
  });

  it("multiple spawned sessions consume pending spawns in FIFO order", async () => {
    // Queue two pending spawns from the same primary session
    await toolBeforeFn()(
      { tool: "Task", sessionID: "primary-timing-fifo", args: { subagent_type: "engineer" } },
      {},
    );
    await toolBeforeFn()(
      { tool: "Task", sessionID: "primary-timing-fifo", args: { subagent_type: "explorer" } },
      {},
    );
    // Two session.created events consume both pending entries
    await eventFn()({
      event: {
        type: "session.created",
        properties: { info: { id: "spawned-fifo-1" } },
      },
    });
    await eventFn()({
      event: {
        type: "session.created",
        properties: { info: { id: "spawned-fifo-2" } },
      },
    });
    expect(_subagentSessionsForTest.has("spawned-fifo-1")).toBe(true);
    expect(_subagentSessionsForTest.has("spawned-fifo-2")).toBe(true);
  });
});

describe("Task-call timing registry — spawn expiry", () => {
  const eventFn = () => hooks["event"] as (i: unknown) => Promise<void>;

  afterEach(() => {
    _pendingSubagentSpawnsForTest.delete("primary-expired-test");
    _pendingSubagentSpawnsForTest.delete("primary-fresh-test");
    _subagentSessionsForTest.delete("session-after-expired");
    _subagentSessionsForTest.delete("session-after-fresh");
  });

  it("expired pending spawn is NOT matched to session.created", async () => {
    // Manually inject a spawn entry that is already past the 30s timeout
    const expiredTimestamp = Date.now() - (_SPAWN_TIMEOUT_MS_FOR_TEST + 1000);
    _pendingSubagentSpawnsForTest.set("primary-expired-test", [{ timestamp: expiredTimestamp }]);

    await eventFn()({
      event: {
        type: "session.created",
        properties: { info: { id: "session-after-expired" } },
      },
    });

    // The expired entry should NOT have caused the new session to be registered as a subagent
    expect(_subagentSessionsForTest.has("session-after-expired")).toBe(false);
  });

  it("non-expired pending spawn IS matched to session.created", async () => {
    // Manually inject a spawn entry that is within the timeout window (1s ago)
    const recentTimestamp = Date.now() - 1000;
    _pendingSubagentSpawnsForTest.set("primary-fresh-test", [{ timestamp: recentTimestamp }]);

    await eventFn()({
      event: {
        type: "session.created",
        properties: { info: { id: "session-after-fresh" } },
      },
    });

    // The fresh entry SHOULD have caused the new session to be registered as a subagent
    expect(_subagentSessionsForTest.has("session-after-fresh")).toBe(true);
  });
});
