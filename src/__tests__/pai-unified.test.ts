import { describe, it, expect, beforeAll } from "bun:test";
import PaiPlugin, { healthCheck } from "../plugin/pai-unified.js";

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
  it("has tool object with agent_team_dispatch", () => {
    const tools = hooks["tool"] as Record<string, unknown>;
    expect(typeof tools).toBe("object");
    expect(typeof tools["agent_team_dispatch"]).toBe("object");
  });

  it("has agent_team_status tool", () => {
    const tools = hooks["tool"] as Record<string, unknown>;
    expect(typeof tools["agent_team_status"]).toBe("object");
  });

  it("has agent_team_collect tool", () => {
    const tools = hooks["tool"] as Record<string, unknown>;
    expect(typeof tools["agent_team_collect"]).toBe("object");
  });

  it("each tool has description and execute", () => {
    const tools = hooks["tool"] as Record<string, { description: string; execute: unknown }>;
    for (const tool of Object.values(tools)) {
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.execute).toBe("function");
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
    expect(result.version).toBe("0.1.0");
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
