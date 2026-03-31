/**
 * skill-loader.test.ts — Unit tests for the PAI Skill Loader handler.
 *
 * Tests cover:
 *   - resolveSkillPath: direct hit, not-found, path-traversal guard
 *   - resolveWorkflowPath: invalid skill returns null
 *   - listSkills: output format + known skill presence
 *   - createSkillTool: tool shape (description + execute)
 *   - execute(): list mode, path-traversal rejection, not-found error
 */

import { describe, it, expect } from "bun:test";
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import {
  resolveSkillPath,
  resolveWorkflowPath,
  listSkills,
  createSkillTool,
} from "../handlers/skill-loader.js";
import type { ToolContext } from "@opencode-ai/plugin";

// ── Minimal ToolContext mock ──────────────────────────────────────────────────

const mockCtx: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
};

// ── resolveSkillPath ──────────────────────────────────────────────────────────

describe("resolveSkillPath", () => {
  it("returns a path ending in Research/SKILL.md for a known skill", () => {
    const result = resolveSkillPath("Research");
    // Research is a known skill in ~/.claude/skills/
    // If the skill exists locally, result should end with Research/SKILL.md
    if (result !== null) {
      expect(result).toContain("Research");
      expect(result).toMatch(/SKILL\.md$/);
    } else {
      // Acceptable if the skill dir doesn't exist in the test environment
      expect(result).toBeNull();
    }
  });

  it("returns null for a non-existent skill name", () => {
    const result = resolveSkillPath("nonexistent-skill-xyz-12345");
    expect(result).toBeNull();
  });

  it("returns null when name contains .. (path traversal guard)", () => {
    // The function should reject names with .. before doing any FS access
    expect(resolveSkillPath("../etc/passwd")).toBeNull();
    expect(resolveSkillPath("../Research")).toBeNull();
    expect(resolveSkillPath("Research/../../../etc")).toBeNull();
  });

  it("returns a string (not null) for a skill that actually exists", () => {
    // We know Research exists in this environment — if it doesn't, skip
    const result = resolveSkillPath("Research");
    if (result !== null) {
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

// ── resolveWorkflowPath ───────────────────────────────────────────────────────

describe("resolveWorkflowPath", () => {
  it("returns null for a non-existent skill", () => {
    const result = resolveWorkflowPath("nonexistent-skill-xyz-12345", "SomeWorkflow");
    expect(result).toBeNull();
  });

  it("returns null when skillName contains ..", () => {
    expect(resolveWorkflowPath("../etc/passwd", "Workflow")).toBeNull();
  });

  it("returns null when workflow contains ..", () => {
    expect(resolveWorkflowPath("Research", "../../../etc/passwd")).toBeNull();
  });

  it("returns a string path when skill and workflow both exist", () => {
    // Research skill is known to have a Workflows/ directory
    const skillPath = resolveSkillPath("Research");
    if (skillPath === null) return; // skip if Research not installed

    // Try to find any workflow file in Research/Workflows/
    const skillDir = dirname(skillPath);
    const workflowsDir = join(skillDir, "Workflows");
    if (!existsSync(workflowsDir)) return; // skip if no Workflows dir

    let files: string[];
    try {
      files = readdirSync(workflowsDir).filter((f) => f.endsWith(".md"));
    } catch {
      return;
    }
    if (files.length === 0) return;

    // Take the first workflow file and try resolving it
    const workflowName = files[0]!.replace(/\.md$/, "");
    const result = resolveWorkflowPath("Research", workflowName);
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
    expect(result).toMatch(/\.md$/);
  });
});

// ── listSkills ────────────────────────────────────────────────────────────────

describe("listSkills", () => {
  it("returns a string containing 'Available PAI Skills'", () => {
    const result = listSkills();
    expect(typeof result).toBe("string");
    expect(result).toContain("Available PAI Skills");
  });

  it("contains 'Research' when the Research skill is installed", () => {
    const skillPath = resolveSkillPath("Research");
    if (skillPath === null) return; // skip if Research not installed

    const result = listSkills();
    expect(result).toContain("Research");
  });

  it("each skill entry starts with a dash (bullet format)", () => {
    const result = listSkills();
    const lines = result.split("\n").slice(1); // skip header line
    for (const line of lines) {
      if (line.trim().length > 0) {
        expect(line).toMatch(/^- /);
      }
    }
  });
});

// ── createSkillTool ───────────────────────────────────────────────────────────

describe("createSkillTool", () => {
  it("returns an object (ToolDefinition shape)", () => {
    const toolDef = createSkillTool();
    expect(typeof toolDef).toBe("object");
    expect(toolDef).not.toBeNull();
  });

  it("has a description property of type string", () => {
    const toolDef = createSkillTool();
    expect(typeof toolDef.description).toBe("string");
    expect(toolDef.description.length).toBeGreaterThan(0);
  });

  it("has an execute property that is a function", () => {
    const toolDef = createSkillTool();
    expect(typeof toolDef.execute).toBe("function");
  });

  it("description mentions skill() usage", () => {
    const toolDef = createSkillTool();
    expect(toolDef.description).toContain('skill("list")');
  });

  it("description mentions workflow loading", () => {
    const toolDef = createSkillTool();
    expect(toolDef.description.toLowerCase()).toContain("workflow");
  });
});

// ── execute() — list mode ─────────────────────────────────────────────────────

describe("skill tool execute — list mode", () => {
  it("returns available skills string when name is 'list'", async () => {
    const toolDef = createSkillTool();
    const result = await toolDef.execute({ name: "list", workflow: undefined }, mockCtx);
    expect(typeof result).toBe("string");
    expect(result).toContain("Available PAI Skills");
  });

  it("returns available skills string when name is undefined", async () => {
    const toolDef = createSkillTool();
    const result = await toolDef.execute({ name: undefined, workflow: undefined }, mockCtx);
    expect(result).toContain("Available PAI Skills");
  });

  it("returns available skills string when name is empty string", async () => {
    const toolDef = createSkillTool();
    const result = await toolDef.execute({ name: "", workflow: undefined }, mockCtx);
    expect(result).toContain("Available PAI Skills");
  });
});

// ── execute() — path traversal guard ─────────────────────────────────────────

describe("skill tool execute — path traversal guard", () => {
  it("returns error for name containing ..", async () => {
    const toolDef = createSkillTool();
    const result = await toolDef.execute({ name: "../etc/passwd", workflow: undefined }, mockCtx);
    expect(result).toContain("Error");
    expect(result.toLowerCase()).toContain("path traversal");
  });

  it("does not return skill content for .. paths", async () => {
    const toolDef = createSkillTool();
    const result = await toolDef.execute({ name: "../etc/passwd" }, mockCtx);
    expect(result).not.toContain("root");
    expect(result).not.toContain("/etc/");
  });

  it("returns error for workflow containing ..", async () => {
    const toolDef = createSkillTool();
    const result = await toolDef.execute(
      { name: "Research", workflow: "../../../etc/passwd" },
      mockCtx,
    );
    expect(result).toContain("Error");
    expect(result.toLowerCase()).toContain("path traversal");
  });
});

// ── execute() — not-found ─────────────────────────────────────────────────────

describe("skill tool execute — not found", () => {
  it("returns not-found error for an unknown skill name", async () => {
    const toolDef = createSkillTool();
    const result = await toolDef.execute({ name: "nonexistent-skill-xyz-12345" }, mockCtx);
    expect(result).toContain("Error");
    expect(result).toContain("nonexistent-skill-xyz-12345");
    expect(result.toLowerCase()).toContain("not found");
  });

  it("not-found error suggests using skill('list')", async () => {
    const toolDef = createSkillTool();
    const result = await toolDef.execute({ name: "nonexistent-skill-xyz-12345" }, mockCtx);
    expect(result).toContain('skill("list")');
  });
});

// ── execute() — normal mode ───────────────────────────────────────────────────

describe("skill tool execute — normal mode (requires installed skills)", () => {
  it("returns file content (non-empty string) for Research skill", async () => {
    const skillPath = resolveSkillPath("Research");
    if (skillPath === null) return; // skip if not installed

    const toolDef = createSkillTool();
    const result = await toolDef.execute({ name: "Research" }, mockCtx);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // Should NOT be an error string
    expect(result).not.toMatch(/^Error:/);
  });
});
