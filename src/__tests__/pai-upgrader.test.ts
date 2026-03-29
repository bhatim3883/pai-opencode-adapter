import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  classifyDomain,
  parseGitStatus,
  fetchUpstream,
  checkUpstreamStatus,
  diffUpstream,
  backupPAI,
  syncFiles,
  getSyncableEntries,
  checkAdapterCompat,
  rebuildClaudeMd,
  runUpgrade,
  formatUpgradeReport,
  type ChangedFile,
  type RunCmdFn,
  type UpgradeReport,
} from "../updater/pai-upgrader.js";

// ============================================================================
// Helper: create a fake repo dir with some files
// ============================================================================

function setupFakeRepo(tmpDir: string): {
  repoDir: string;
  paiDir: string;
  paiCoreDir: string;
} {
  const repoDir = join(tmpDir, "Personal_AI_Infrastructure");
  const paiDir = join(tmpDir, ".claude");
  const paiCoreDir = join(paiDir, "PAI");

  mkdirSync(repoDir, { recursive: true });
  mkdirSync(paiCoreDir, { recursive: true });

  // Create some repo files
  mkdirSync(join(repoDir, "Algorithm"), { recursive: true });
  writeFileSync(join(repoDir, "Algorithm", "v3.7.0.md"), "# Algorithm v3.7.0");
  writeFileSync(join(repoDir, "README.md"), "# PAI");
  mkdirSync(join(repoDir, "Skills"), { recursive: true });
  writeFileSync(join(repoDir, "Skills", "Research.md"), "# Research");

  // Create existing PAI install
  mkdirSync(join(paiCoreDir, "Algorithm"), { recursive: true });
  writeFileSync(join(paiCoreDir, "Algorithm", "v3.5.0.md"), "# Algorithm v3.5.0");
  mkdirSync(join(paiCoreDir, "USER", "TELOS"), { recursive: true });
  writeFileSync(join(paiCoreDir, "USER", "TELOS", "GOALS.md"), "My goals");
  mkdirSync(join(paiCoreDir, "MEMORY", "WORK"), { recursive: true });
  writeFileSync(join(paiCoreDir, "MEMORY", "WORK", "session.json"), "{}");

  return { repoDir, paiDir, paiCoreDir };
}

// ============================================================================
// classifyDomain
// ============================================================================

describe("classifyDomain", () => {
  test("algorithm files classified as algorithm", () => {
    expect(classifyDomain("Algorithm/v3.7.0.md")).toBe("algorithm");
    expect(classifyDomain("PAI/Algorithm/v3.5.0.md")).toBe("algorithm");
  });

  test("hook files classified as hooks", () => {
    expect(classifyDomain("hooks/PostToolUse.ts")).toBe("hooks");
    expect(classifyDomain("PRDSync.hook.ts")).toBe("hooks");
  });

  test("skill files classified as skills", () => {
    expect(classifyDomain("Skills/Research/SKILL.md")).toBe("skills");
    expect(classifyDomain("skills/Agents/SKILL.md")).toBe("skills");
  });

  test("tool files classified as tools", () => {
    expect(classifyDomain("Tools/browser.ts")).toBe("tools");
  });

  test("context routing classified as context", () => {
    expect(classifyDomain("PAI/CONTEXT_ROUTING.md")).toBe("context");
    expect(classifyDomain("CLAUDE.md")).toBe("context");
  });

  test("settings classified as settings", () => {
    expect(classifyDomain("PAI/PRDFORMAT.md")).toBe("settings");
    expect(classifyDomain("config/settings.json")).toBe("settings");
  });

  test("memory files classified as memory", () => {
    expect(classifyDomain("MEMORY/STATE/work.json")).toBe("memory");
  });

  test("unknown files classified as other", () => {
    expect(classifyDomain("random-file.txt")).toBe("other");
    expect(classifyDomain("docs/guide.md")).toBe("other");
  });
});

// ============================================================================
// parseGitStatus
// ============================================================================

describe("parseGitStatus", () => {
  test("A → added", () => {
    expect(parseGitStatus("A")).toBe("added");
  });

  test("D → deleted", () => {
    expect(parseGitStatus("D")).toBe("deleted");
  });

  test("R → renamed", () => {
    expect(parseGitStatus("R")).toBe("renamed");
  });

  test("M → modified", () => {
    expect(parseGitStatus("M")).toBe("modified");
  });

  test("unknown letter → modified", () => {
    expect(parseGitStatus("X")).toBe("modified");
  });
});

// ============================================================================
// fetchUpstream
// ============================================================================

describe("fetchUpstream", () => {
  test("returns ok:true when git fetch succeeds", () => {
    const mockCmd: RunCmdFn = () => "";
    const result = fetchUpstream("/tmp/fake-repo", mockCmd);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("returns ok:false with error when git fetch fails", () => {
    const mockCmd: RunCmdFn = () => {
      throw new Error("network error");
    };
    const result = fetchUpstream("/tmp/fake-repo", mockCmd);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("git fetch failed");
  });
});

// ============================================================================
// checkUpstreamStatus
// ============================================================================

describe("checkUpstreamStatus", () => {
  test("returns hasChanges:false when HEAD equals origin/main", () => {
    const sha = "abc1234567890";
    const mockCmd: RunCmdFn = (cmd) => {
      if (cmd.includes("rev-parse HEAD")) return `${sha}\n`;
      if (cmd.includes("rev-parse origin/main")) return `${sha}\n`;
      return "0\n";
    };
    const status = checkUpstreamStatus("/tmp/fake-repo", mockCmd);
    expect(status.hasChanges).toBe(false);
    expect(status.behindCount).toBe(0);
    expect(status.currentSha).toBe(sha);
    expect(status.remoteSha).toBe(sha);
  });

  test("returns hasChanges:true with correct behindCount when behind", () => {
    const mockCmd: RunCmdFn = (cmd) => {
      if (cmd.includes("rev-parse HEAD")) return "aaa111\n";
      if (cmd.includes("rev-parse origin/main")) return "bbb222\n";
      if (cmd.includes("rev-list --count")) return "5\n";
      return "";
    };
    const status = checkUpstreamStatus("/tmp/fake-repo", mockCmd);
    expect(status.hasChanges).toBe(true);
    expect(status.behindCount).toBe(5);
  });
});

// ============================================================================
// diffUpstream
// ============================================================================

describe("diffUpstream", () => {
  test("returns empty array when no diff", () => {
    const mockCmd: RunCmdFn = () => "";
    const files = diffUpstream("/tmp/fake-repo", mockCmd);
    expect(files).toHaveLength(0);
  });

  test("parses modified files correctly", () => {
    const mockCmd: RunCmdFn = () =>
      "M\tAlgorithm/v3.7.0.md\nA\tSkills/NewSkill.md\nD\thooks/old-hook.ts";
    const files = diffUpstream("/tmp/fake-repo", mockCmd);
    expect(files).toHaveLength(3);

    expect(files[0]!.path).toBe("Algorithm/v3.7.0.md");
    expect(files[0]!.status).toBe("modified");
    expect(files[0]!.domain).toBe("algorithm");

    expect(files[1]!.path).toBe("Skills/NewSkill.md");
    expect(files[1]!.status).toBe("added");
    expect(files[1]!.domain).toBe("skills");

    expect(files[2]!.path).toBe("hooks/old-hook.ts");
    expect(files[2]!.status).toBe("deleted");
    expect(files[2]!.domain).toBe("hooks");
  });

  test("handles rename status (R100)", () => {
    const mockCmd: RunCmdFn = () =>
      "R100\tSkills/OldName.md\tSkills/NewName.md";
    const files = diffUpstream("/tmp/fake-repo", mockCmd);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("Skills/NewName.md");
    expect(files[0]!.status).toBe("renamed");
  });
});

// ============================================================================
// backupPAI
// ============================================================================

describe("backupPAI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pai-backup-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates backup directory with timestamp", () => {
    const paiCoreDir = join(tmpDir, "PAI");
    mkdirSync(paiCoreDir, { recursive: true });
    writeFileSync(join(paiCoreDir, "test.md"), "hello");

    const result = backupPAI(paiCoreDir, tmpDir);
    expect(result.backupPath).toBeTruthy();
    expect(result.error).toBeUndefined();
    expect(existsSync(result.backupPath!)).toBe(true);
    expect(readFileSync(join(result.backupPath!, "test.md"), "utf-8")).toBe(
      "hello"
    );
  });

  test("returns error when PAI core dir does not exist", () => {
    const result = backupPAI(join(tmpDir, "nonexistent"), tmpDir);
    expect(result.backupPath).toBeNull();
    expect(result.error).toContain("does not exist");
  });
});

// ============================================================================
// getSyncableEntries
// ============================================================================

describe("getSyncableEntries", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pai-sync-entries-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("excludes hidden files and git dirs", () => {
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
    writeFileSync(join(tmpDir, ".gitignore"), "");
    writeFileSync(join(tmpDir, "Algorithm.md"), "");
    mkdirSync(join(tmpDir, "Skills"), { recursive: true });

    const entries = getSyncableEntries(tmpDir);
    expect(entries).not.toContain(".git");
    expect(entries).not.toContain(".gitignore");
    expect(entries).toContain("Algorithm.md");
    expect(entries).toContain("Skills");
  });

  test("excludes USER and MEMORY (preserved dirs)", () => {
    mkdirSync(join(tmpDir, "USER"), { recursive: true });
    mkdirSync(join(tmpDir, "MEMORY"), { recursive: true });
    writeFileSync(join(tmpDir, "Algorithm.md"), "");

    const entries = getSyncableEntries(tmpDir);
    expect(entries).not.toContain("USER");
    expect(entries).not.toContain("MEMORY");
    expect(entries).toContain("Algorithm.md");
  });

  test("excludes LICENSE and README.md", () => {
    writeFileSync(join(tmpDir, "LICENSE"), "MIT");
    writeFileSync(join(tmpDir, "README.md"), "# Repo");
    writeFileSync(join(tmpDir, "Algorithm.md"), "");

    const entries = getSyncableEntries(tmpDir);
    expect(entries).not.toContain("LICENSE");
    expect(entries).not.toContain("README.md");
    expect(entries).toContain("Algorithm.md");
  });
});

// ============================================================================
// syncFiles
// ============================================================================

describe("syncFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pai-sync-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("copies files from repo to PAI core dir", () => {
    const { repoDir, paiCoreDir } = setupFakeRepo(tmpDir);

    const result = syncFiles(repoDir, paiCoreDir, false);
    expect(result.errors).toHaveLength(0);
    expect(result.syncedFiles.length).toBeGreaterThan(0);

    // Algorithm dir should have been copied
    expect(existsSync(join(paiCoreDir, "Algorithm", "v3.7.0.md"))).toBe(true);
    // Skills dir should have been copied
    expect(existsSync(join(paiCoreDir, "Skills", "Research.md"))).toBe(true);
  });

  test("preserves USER directory (never overwrites)", () => {
    const { repoDir, paiCoreDir } = setupFakeRepo(tmpDir);

    // Add USER dir to repo (should be ignored)
    mkdirSync(join(repoDir, "USER"), { recursive: true });
    writeFileSync(join(repoDir, "USER", "EVIL.md"), "should not sync");

    syncFiles(repoDir, paiCoreDir, false);

    // Original user file should still exist
    expect(
      readFileSync(
        join(paiCoreDir, "USER", "TELOS", "GOALS.md"),
        "utf-8"
      )
    ).toBe("My goals");
    // Evil file should NOT exist
    expect(existsSync(join(paiCoreDir, "USER", "EVIL.md"))).toBe(false);
  });

  test("preserves MEMORY directory (never overwrites)", () => {
    const { repoDir, paiCoreDir } = setupFakeRepo(tmpDir);

    syncFiles(repoDir, paiCoreDir, false);

    // Original memory file should still exist
    expect(
      readFileSync(
        join(paiCoreDir, "MEMORY", "WORK", "session.json"),
        "utf-8"
      )
    ).toBe("{}");
  });

  test("dry-run does not modify files", () => {
    const { repoDir, paiCoreDir } = setupFakeRepo(tmpDir);

    const result = syncFiles(repoDir, paiCoreDir, true);
    expect(result.syncedFiles.length).toBeGreaterThan(0);
    expect(result.syncedFiles[0]).toContain("[dry-run]");

    // Should NOT have synced the new algorithm file
    expect(existsSync(join(paiCoreDir, "Algorithm", "v3.7.0.md"))).toBe(
      false
    );
  });
});

// ============================================================================
// checkAdapterCompat
// ============================================================================

describe("checkAdapterCompat", () => {
  test("returns compatible when no files changed", () => {
    const result = checkAdapterCompat([]);
    expect(result.compatible).toBe(true);
    expect(result.incompatibilities).toHaveLength(0);
  });

  test("returns compatible for other-domain changes", () => {
    const files: ChangedFile[] = [
      { path: "docs/guide.md", domain: "other", status: "modified" },
    ];
    const result = checkAdapterCompat(files);
    expect(result.compatible).toBe(true);
  });

  test("flags algorithm file deletion as incompatibility", () => {
    const files: ChangedFile[] = [
      { path: "Algorithm/v3.5.0.md", domain: "algorithm", status: "deleted" },
    ];
    const result = checkAdapterCompat(files);
    expect(result.compatible).toBe(false);
    expect(result.incompatibilities.length).toBeGreaterThan(0);
    expect(result.incompatibilities[0]).toContain("Algorithm file deleted");
  });

  test("flags new algorithm file as incompatibility", () => {
    const files: ChangedFile[] = [
      { path: "Algorithm/v4.0.0.md", domain: "algorithm", status: "added" },
    ];
    const result = checkAdapterCompat(files);
    expect(result.compatible).toBe(false);
    expect(result.incompatibilities[0]).toContain("New algorithm file");
  });

  test("flags hook changes as incompatibility", () => {
    const files: ChangedFile[] = [
      { path: "hooks/NewHook.ts", domain: "hooks", status: "added" },
    ];
    const result = checkAdapterCompat(files);
    expect(result.compatible).toBe(false);
    expect(result.incompatibilities[0]).toContain("hooks changed");
  });

  test("flags context deletion as incompatibility", () => {
    const files: ChangedFile[] = [
      {
        path: "PAI/CONTEXT_ROUTING.md",
        domain: "context",
        status: "deleted",
      },
    ];
    const result = checkAdapterCompat(files);
    expect(result.compatible).toBe(false);
    expect(result.incompatibilities[0]).toContain("Context routing");
  });

  test("flags settings changes as incompatibility", () => {
    const files: ChangedFile[] = [
      { path: "PAI/PRDFORMAT.md", domain: "settings", status: "modified" },
    ];
    const result = checkAdapterCompat(files);
    expect(result.compatible).toBe(false);
    expect(result.incompatibilities[0]).toContain("settings/config changed");
  });

  test("returns affected adapter files for algorithm changes", () => {
    const files: ChangedFile[] = [
      { path: "Algorithm/v3.7.0.md", domain: "algorithm", status: "modified" },
    ];
    const result = checkAdapterCompat(files);
    expect(result.affectedAdapterFiles.length).toBeGreaterThan(0);
    expect(result.affectedDomains).toContain("algorithm");
  });
});

// ============================================================================
// rebuildClaudeMd
// ============================================================================

describe("rebuildClaudeMd", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pai-rebuild-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns warning when BuildCLAUDE.ts does not exist", () => {
    const mockCmd: RunCmdFn = () => "";
    const result = rebuildClaudeMd(tmpDir, mockCmd, false);
    expect(result.rebuilt).toBe(false);
    expect(result.warning).toContain("BuildCLAUDE.ts not found");
  });

  test("returns dry-run message without executing", () => {
    // Create the script file so it passes existence check
    mkdirSync(join(tmpDir, "PAI", "Tools"), { recursive: true });
    writeFileSync(join(tmpDir, "PAI", "Tools", "BuildCLAUDE.ts"), "// stub");

    let cmdCalled = false;
    const mockCmd: RunCmdFn = () => {
      cmdCalled = true;
      return "";
    };
    const result = rebuildClaudeMd(tmpDir, mockCmd, true);
    expect(result.rebuilt).toBe(false);
    expect(result.output).toContain("[dry-run]");
    expect(cmdCalled).toBe(false);
  });

  test("runs BuildCLAUDE.ts and returns output on success", () => {
    mkdirSync(join(tmpDir, "PAI", "Tools"), { recursive: true });
    writeFileSync(join(tmpDir, "PAI", "Tools", "BuildCLAUDE.ts"), "// stub");

    const mockCmd: RunCmdFn = (cmd) => {
      if (cmd.includes("BuildCLAUDE.ts")) {
        return "Built CLAUDE.md from template\n   Algorithm: v3.7.0\n";
      }
      return "";
    };
    const result = rebuildClaudeMd(tmpDir, mockCmd, false);
    expect(result.rebuilt).toBe(true);
    expect(result.output).toContain("Built CLAUDE.md from template");
    expect(result.error).toBeUndefined();
  });

  test("returns error when BuildCLAUDE.ts execution fails", () => {
    mkdirSync(join(tmpDir, "PAI", "Tools"), { recursive: true });
    writeFileSync(join(tmpDir, "PAI", "Tools", "BuildCLAUDE.ts"), "// stub");

    const mockCmd: RunCmdFn = () => {
      throw new Error("bun not found");
    };
    const result = rebuildClaudeMd(tmpDir, mockCmd, false);
    expect(result.rebuilt).toBe(false);
    expect(result.error).toContain("BuildCLAUDE.ts failed");
  });
});

// ============================================================================
// runUpgrade (mocked)
// ============================================================================

describe("runUpgrade", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pai-upgrade-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("errors when repo dir does not exist", async () => {
    const report = await runUpgrade({
      repoDir: join(tmpDir, "nonexistent"),
      paiDir: tmpDir,
      paiCoreDir: join(tmpDir, "PAI"),
    });
    expect(report.success).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]).toContain("not found");
  });

  test("succeeds with no changes (up to date)", async () => {
    const { repoDir, paiDir, paiCoreDir } = setupFakeRepo(tmpDir);
    const sha = "abc12345";

    const mockCmd: RunCmdFn = (cmd) => {
      if (cmd.includes("fetch origin")) return "";
      if (cmd.includes("rev-parse HEAD")) return `${sha}\n`;
      if (cmd.includes("rev-parse origin/main")) return `${sha}\n`;
      return "";
    };

    const report = await runUpgrade({
      repoDir,
      paiDir,
      paiCoreDir,
      runCmd: mockCmd,
    });
    expect(report.success).toBe(true);
    expect(report.upstreamStatus?.hasChanges).toBe(false);
    expect(report.changedFiles).toHaveLength(0);
  });

  test("full upgrade with changes and sync", async () => {
    const { repoDir, paiDir, paiCoreDir } = setupFakeRepo(tmpDir);

    const mockCmd: RunCmdFn = (cmd) => {
      if (cmd.includes("fetch origin")) return "";
      if (cmd.includes("rev-parse HEAD")) return "aaa111\n";
      if (cmd.includes("rev-parse origin/main")) return "bbb222\n";
      if (cmd.includes("rev-list --count")) return "3\n";
      if (cmd.includes("diff --name-status"))
        return "M\tAlgorithm/v3.7.0.md\nA\tSkills/NewSkill.md";
      if (cmd.includes("pull origin main")) return "";
      return "";
    };

    const report = await runUpgrade({
      repoDir,
      paiDir,
      paiCoreDir,
      runCmd: mockCmd,
    });

    expect(report.success).toBe(true);
    expect(report.upstreamStatus?.behindCount).toBe(3);
    expect(report.changedFiles).toHaveLength(2);
    expect(report.backupPath).toBeTruthy();
    expect(report.syncedFiles.length).toBeGreaterThan(0);
    // BuildCLAUDE.ts won't exist in test tmpdir, so rebuild should fail gracefully
    expect(report.claudeMdRebuilt).toBe(false);
  });

  test("dry-run does not create backup or pull", async () => {
    const { repoDir, paiDir, paiCoreDir } = setupFakeRepo(tmpDir);
    let pullCalled = false;

    const mockCmd: RunCmdFn = (cmd) => {
      if (cmd.includes("fetch origin")) return "";
      if (cmd.includes("rev-parse HEAD")) return "aaa\n";
      if (cmd.includes("rev-parse origin/main")) return "bbb\n";
      if (cmd.includes("rev-list --count")) return "1\n";
      if (cmd.includes("diff --name-status")) return "M\tAlgorithm/v3.7.0.md";
      if (cmd.includes("pull")) {
        pullCalled = true;
        return "";
      }
      return "";
    };

    const report = await runUpgrade({
      repoDir,
      paiDir,
      paiCoreDir,
      runCmd: mockCmd,
      dryRun: true,
    });

    expect(pullCalled).toBe(false);
    expect(report.backupPath).toBe("[dry-run] no backup created");
    expect(report.syncedFiles[0]).toContain("[dry-run]");
  });

  test("reports fetch failure gracefully", async () => {
    const { repoDir, paiDir, paiCoreDir } = setupFakeRepo(tmpDir);

    const mockCmd: RunCmdFn = (cmd) => {
      if (cmd.includes("fetch origin")) throw new Error("network down");
      return "";
    };

    const report = await runUpgrade({
      repoDir,
      paiDir,
      paiCoreDir,
      runCmd: mockCmd,
    });

    expect(report.success).toBe(false);
    expect(report.errors[0]).toContain("git fetch failed");
  });

  test("full upgrade runs BuildCLAUDE.ts when present", async () => {
    const { repoDir, paiDir, paiCoreDir } = setupFakeRepo(tmpDir);

    // Create BuildCLAUDE.ts in the PAI dir
    mkdirSync(join(paiDir, "PAI", "Tools"), { recursive: true });
    writeFileSync(join(paiDir, "PAI", "Tools", "BuildCLAUDE.ts"), "// stub");

    const mockCmd: RunCmdFn = (cmd) => {
      if (cmd.includes("fetch origin")) return "";
      if (cmd.includes("rev-parse HEAD")) return "aaa111\n";
      if (cmd.includes("rev-parse origin/main")) return "bbb222\n";
      if (cmd.includes("rev-list --count")) return "1\n";
      if (cmd.includes("diff --name-status")) return "M\tAlgorithm/v3.7.0.md";
      if (cmd.includes("pull origin main")) return "";
      if (cmd.includes("BuildCLAUDE.ts")) return "Built CLAUDE.md from template\n";
      return "";
    };

    const report = await runUpgrade({
      repoDir,
      paiDir,
      paiCoreDir,
      runCmd: mockCmd,
    });

    expect(report.claudeMdRebuilt).toBe(true);
    expect(report.claudeMdRebuildOutput).toContain("Built CLAUDE.md");
  });
});

// ============================================================================
// formatUpgradeReport
// ============================================================================

describe("formatUpgradeReport", () => {
  test("formats up-to-date report", () => {
    const report: UpgradeReport = {
      timestamp: "2026-03-29T12:00:00Z",
      phase: "verify",
      upstreamStatus: {
        behindCount: 0,
        currentSha: "abc12345",
        remoteSha: "abc12345",
        hasChanges: false,
      },
      changedFiles: [],
      backupPath: null,
      syncedFiles: [],
      claudeMdRebuilt: false,
      claudeMdRebuildOutput: "",
      adapterCompatible: true,
      incompatibilities: [],
      warnings: [],
      errors: [],
      success: true,
    };
    const formatted = formatUpgradeReport(report);
    expect(formatted).toContain("Up to Date");
    expect(formatted).toContain("abc1234");
  });

  test("formats report with changes", () => {
    const report: UpgradeReport = {
      timestamp: "2026-03-29T12:00:00Z",
      phase: "verify",
      upstreamStatus: {
        behindCount: 5,
        currentSha: "aaa11111",
        remoteSha: "bbb22222",
        hasChanges: true,
      },
      changedFiles: [
        { path: "Algorithm/v3.7.0.md", domain: "algorithm", status: "modified" },
        { path: "Skills/New.md", domain: "skills", status: "added" },
      ],
      backupPath: "/tmp/PAI.backup-20260329",
      syncedFiles: ["Algorithm", "Skills"],
      claudeMdRebuilt: true,
      claudeMdRebuildOutput: "Built CLAUDE.md from template",
      adapterCompatible: false,
      incompatibilities: ["New algorithm file — adapter may need to support it"],
      warnings: [],
      errors: [],
      success: true,
    };
    const formatted = formatUpgradeReport(report);
    expect(formatted).toContain("5 commit(s)");
    expect(formatted).toContain("aaa1111");
    expect(formatted).toContain("bbb2222");
    expect(formatted).toContain("Algorithm/v3.7.0.md");
    expect(formatted).toContain("Adapter needs updates");
    expect(formatted).toContain("Upgrade completed successfully");
  });

  test("formats report with errors", () => {
    const report: UpgradeReport = {
      timestamp: "2026-03-29T12:00:00Z",
      phase: "fetch",
      upstreamStatus: null,
      changedFiles: [],
      backupPath: null,
      syncedFiles: [],
      claudeMdRebuilt: false,
      claudeMdRebuildOutput: "",
      adapterCompatible: true,
      incompatibilities: [],
      warnings: [],
      errors: ["git fetch failed: network down"],
      success: false,
    };
    const formatted = formatUpgradeReport(report);
    expect(formatted).toContain("Errors");
    expect(formatted).toContain("network down");
    expect(formatted).toContain("completed with errors");
  });
});
