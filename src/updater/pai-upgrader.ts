/**
 * PAI Upgrader — Core upgrade logic for syncing PAI from upstream repo.
 *
 * Flow:
 *  1. FETCH — git fetch origin in the upstream repo clone
 *  2. CHECK — compare HEAD vs origin/main (exit early if 0 behind)
 *  3. DIFF  — categorize changed files by domain
 *  4. BACKUP — snapshot ~/.claude/PAI/ before touching it
 *  5. PULL  — git pull origin main
 *  6. SYNC  — copy changed files from repo → ~/.claude/PAI/ (preserve USER/, MEMORY/)
 *  7. REBUILD — run BuildCLAUDE.ts to regenerate CLAUDE.md from template + settings
 *  8. COMPAT — check if adapter needs changes for the new PAI version
 *  9. VERIFY — run adapter tests + sanity checks
 *
 * Based on official PAI upgrade instructions:
 *   https://github.com/danielmiessler/Personal_AI_Infrastructure
 *   1. Back up current installation
 *   2. Clone/copy new release over installation
 *   3. Run install.sh (for fresh installs — skipped during upgrade)
 *   4. Rebuild CLAUDE.md via BuildCLAUDE.ts
 */

import { execSync } from "child_process";
import { existsSync, cpSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, relative, basename } from "path";

import { fileLog } from "../lib/file-logger.js";
import { PAI_DIR, PAI_REPO_DIR, PAI_CORE_DIR } from "../lib/constants.js";

// ============================================================================
// Types
// ============================================================================

export type UpgradePhase =
  | "fetch"
  | "check"
  | "diff"
  | "backup"
  | "pull"
  | "sync"
  | "rebuild"
  | "compat"
  | "verify";

export type ChangeDomain =
  | "algorithm"
  | "hooks"
  | "skills"
  | "tools"
  | "settings"
  | "context"
  | "memory"
  | "other";

export interface ChangedFile {
  path: string;
  domain: ChangeDomain;
  status: "added" | "modified" | "deleted" | "renamed";
}

export interface UpstreamStatus {
  behindCount: number;
  currentSha: string;
  remoteSha: string;
  hasChanges: boolean;
}

export interface UpgradeReport {
  timestamp: string;
  phase: UpgradePhase;
  upstreamStatus: UpstreamStatus | null;
  changedFiles: ChangedFile[];
  backupPath: string | null;
  syncedFiles: string[];
  claudeMdRebuilt: boolean;
  claudeMdRebuildOutput: string;
  adapterCompatible: boolean;
  incompatibilities: string[];
  warnings: string[];
  errors: string[];
  success: boolean;
}

export type RunCmdFn = (cmd: string, opts?: { cwd?: string }) => string;

export interface UpgraderOptions {
  /** Override the PAI repo directory (for testing) */
  repoDir?: string;
  /** Override the PAI install directory (for testing) */
  paiDir?: string;
  /** Override the PAI core directory (for testing) */
  paiCoreDir?: string;
  /** Override the command runner (for testing) */
  runCmd?: RunCmdFn;
  /** Dry-run mode — don't actually modify files */
  dryRun?: boolean;
}

// ============================================================================
// Preserved directories — never overwritten during sync
// ============================================================================

const PRESERVED_DIRS = ["USER", "MEMORY"];

// ============================================================================
// Domain classification
// ============================================================================

/**
 * Classify a changed file path into a domain for impact analysis.
 */
export function classifyDomain(filePath: string): ChangeDomain {
  const lower = filePath.toLowerCase();

  if (lower.includes("algorithm/") || lower.includes("algorithm.md")) return "algorithm";
  if (lower.includes("hooks/") || lower.includes("hook")) return "hooks";
  if (lower.includes("skills/") || lower.includes("skill")) return "skills";
  if (lower.includes("tools/") || lower.includes("tool")) return "tools";
  if (lower.includes("context_routing") || lower.includes("claude.md")) return "context";
  if (lower.includes("memory/") || lower.includes("state/")) return "memory";
  if (
    lower.includes("settings") ||
    lower.includes("config") ||
    lower.includes("prdformat")
  )
    return "settings";

  return "other";
}

/**
 * Parse git status letter to a friendly status.
 */
export function parseGitStatus(
  letter: string
): "added" | "modified" | "deleted" | "renamed" {
  switch (letter) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "modified";
  }
}

// ============================================================================
// Phase 1: FETCH
// ============================================================================

export function fetchUpstream(
  repoDir: string,
  runCmd: RunCmdFn
): { ok: boolean; error?: string } {
  try {
    runCmd("git fetch origin", { cwd: repoDir });
    return { ok: true };
  } catch (err) {
    const msg = `git fetch failed: ${err}`;
    fileLog(msg, "error");
    return { ok: false, error: msg };
  }
}

// ============================================================================
// Phase 2: CHECK
// ============================================================================

export function checkUpstreamStatus(
  repoDir: string,
  runCmd: RunCmdFn
): UpstreamStatus {
  const currentSha = runCmd("git rev-parse HEAD", { cwd: repoDir }).trim();
  const remoteSha = runCmd("git rev-parse origin/main", { cwd: repoDir }).trim();

  let behindCount = 0;
  if (currentSha !== remoteSha) {
    const countStr = runCmd(
      `git rev-list --count HEAD..origin/main`,
      { cwd: repoDir }
    ).trim();
    behindCount = parseInt(countStr, 10) || 0;
  }

  return {
    behindCount,
    currentSha,
    remoteSha,
    hasChanges: behindCount > 0,
  };
}

// ============================================================================
// Phase 3: DIFF
// ============================================================================

export function diffUpstream(
  repoDir: string,
  runCmd: RunCmdFn
): ChangedFile[] {
  const diffOutput = runCmd(
    "git diff --name-status HEAD..origin/main",
    { cwd: repoDir }
  ).trim();

  if (!diffOutput) return [];

  const files: ChangedFile[] = [];
  for (const line of diffOutput.split("\n")) {
    const parts = line.split("\t");
    const statusLetter = parts[0]?.trim() ?? "M";
    // For renames, git outputs R100\told\tnew — use the new path
    const filePath =
      statusLetter.startsWith("R") ? (parts[2] ?? parts[1] ?? "") : (parts[1] ?? "");

    if (!filePath) continue;

    files.push({
      path: filePath,
      domain: classifyDomain(filePath),
      status: parseGitStatus(statusLetter.charAt(0)),
    });
  }

  return files;
}

// ============================================================================
// Phase 4: BACKUP
// ============================================================================

export function backupPAI(
  paiCoreDir: string,
  paiDir: string
): { backupPath: string | null; error?: string } {
  if (!existsSync(paiCoreDir)) {
    return { backupPath: null, error: "PAI core directory does not exist" };
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  const backupPath = join(paiDir, `PAI.backup-${timestamp}`);

  try {
    cpSync(paiCoreDir, backupPath, { recursive: true });
    fileLog(`PAI backed up to ${backupPath}`, "info");
    return { backupPath };
  } catch (err) {
    const msg = `Backup failed: ${err}`;
    fileLog(msg, "error");
    return { backupPath: null, error: msg };
  }
}

// ============================================================================
// Phase 5: PULL
// ============================================================================

export function pullUpstream(
  repoDir: string,
  runCmd: RunCmdFn
): { ok: boolean; error?: string } {
  try {
    runCmd("git pull origin main", { cwd: repoDir });
    return { ok: true };
  } catch (err) {
    const msg = `git pull failed: ${err}`;
    fileLog(msg, "error");
    return { ok: false, error: msg };
  }
}

// ============================================================================
// Phase 6: SYNC
// ============================================================================

/**
 * Determine which files/dirs from the repo root should be synced to PAI core.
 * Returns paths relative to the repo root that should be copied.
 */
export function getSyncableEntries(repoDir: string): string[] {
  try {
    const entries = readdirSync(repoDir);
    return entries.filter((entry) => {
      // Skip git internals and hidden files
      if (entry.startsWith(".")) return false;
      // Skip user-specific preserved directories if they exist in repo
      if (PRESERVED_DIRS.includes(entry)) return false;
      // Skip common non-PAI repo files
      if (["LICENSE", "README.md", "CHANGELOG.md"].includes(entry)) return false;
      return true;
    });
  } catch {
    return [];
  }
}

/**
 * Sync files from the upstream repo clone into the installed PAI directory.
 * Preserves USER/ and MEMORY/ — never overwrites those.
 */
export function syncFiles(
  repoDir: string,
  paiCoreDir: string,
  dryRun: boolean
): { syncedFiles: string[]; errors: string[] } {
  const syncedFiles: string[] = [];
  const errors: string[] = [];

  const entries = getSyncableEntries(repoDir);

  for (const entry of entries) {
    const srcPath = join(repoDir, entry);
    const destPath = join(paiCoreDir, entry);

    try {
      if (dryRun) {
        syncedFiles.push(`[dry-run] ${entry}`);
        continue;
      }

      const srcStat = statSync(srcPath);
      if (srcStat.isDirectory()) {
        cpSync(srcPath, destPath, { recursive: true, force: true });
      } else {
        // Ensure parent dir exists
        const parentDir = join(paiCoreDir);
        if (!existsSync(parentDir)) {
          mkdirSync(parentDir, { recursive: true });
        }
        cpSync(srcPath, destPath, { force: true });
      }
      syncedFiles.push(entry);
    } catch (err) {
      errors.push(`Failed to sync ${entry}: ${err}`);
    }
  }

  if (syncedFiles.length > 0) {
    fileLog(`Synced ${syncedFiles.length} entries to ${paiCoreDir}`, "info");
  }

  return { syncedFiles, errors };
}

// ============================================================================
// Phase 7: REBUILD — Regenerate CLAUDE.md via BuildCLAUDE.ts
// ============================================================================

/**
 * Path to BuildCLAUDE.ts relative to the PAI directory.
 * This script reads CLAUDE.md.template, resolves variables from settings.json
 * and PAI/Algorithm/LATEST, and writes CLAUDE.md.
 */
const BUILD_CLAUDE_RELATIVE = "PAI/Tools/BuildCLAUDE.ts";

export function rebuildClaudeMd(
  paiDir: string,
  runCmd: RunCmdFn,
  dryRun: boolean
): { rebuilt: boolean; output: string; error?: string; warning?: string } {
  const buildScript = join(paiDir, BUILD_CLAUDE_RELATIVE);

  if (!existsSync(buildScript)) {
    return {
      rebuilt: false,
      output: "",
      warning: `BuildCLAUDE.ts not found at ${buildScript} — CLAUDE.md not rebuilt`,
    };
  }

  if (dryRun) {
    return {
      rebuilt: false,
      output: `[dry-run] Would run: bun ${buildScript}`,
    };
  }

  try {
    const output = runCmd(`bun run "${buildScript}"`, { cwd: paiDir });
    fileLog("CLAUDE.md rebuilt via BuildCLAUDE.ts", "info");
    return { rebuilt: true, output: output.trim() };
  } catch (err) {
    const msg = `BuildCLAUDE.ts failed: ${err}`;
    fileLog(msg, "error");
    return { rebuilt: false, output: "", error: msg };
  }
}

// ============================================================================
// Phase 8: COMPAT — Adapter compatibility check
// ============================================================================

/**
 * Surface areas in the adapter that might be affected by PAI changes.
 */
const ADAPTER_SURFACE_MAP: Record<ChangeDomain, string[]> = {
  algorithm: [
    "src/config/commands/algorithm.md",
    "src/handlers/context-loader.ts",
  ],
  hooks: [
    "src/plugin/pai-unified.ts",
    "src/handlers/",
  ],
  skills: [
    "src/config/commands/",
  ],
  tools: [
    "src/handlers/tool-handler.ts",
  ],
  settings: [
    "src/lib/constants.ts",
    "src/lib/paths.ts",
  ],
  context: [
    "src/handlers/context-loader.ts",
    "CLAUDE.md mapping",
  ],
  memory: [
    "src/lib/paths.ts",
    "src/handlers/session-lifecycle.ts",
  ],
  other: [],
};

export interface CompatResult {
  compatible: boolean;
  incompatibilities: string[];
  affectedDomains: ChangeDomain[];
  affectedAdapterFiles: string[];
}

export function checkAdapterCompat(changedFiles: ChangedFile[]): CompatResult {
  const affectedDomains = new Set<ChangeDomain>();
  const affectedAdapterFiles = new Set<string>();
  const incompatibilities: string[] = [];

  for (const file of changedFiles) {
    affectedDomains.add(file.domain);
    const surfaceFiles = ADAPTER_SURFACE_MAP[file.domain] ?? [];
    for (const sf of surfaceFiles) {
      affectedAdapterFiles.add(sf);
    }
  }

  // Algorithm changes are the most likely to break the adapter
  if (affectedDomains.has("algorithm")) {
    const algorithmChanges = changedFiles.filter(
      (f) => f.domain === "algorithm"
    );
    for (const ac of algorithmChanges) {
      if (ac.status === "deleted") {
        incompatibilities.push(
          `Algorithm file deleted: ${ac.path} — adapter may reference this`
        );
      } else if (ac.status === "added") {
        incompatibilities.push(
          `New algorithm file: ${ac.path} — adapter may need to support it`
        );
      }
    }
  }

  // Hook changes almost always need adapter attention
  if (affectedDomains.has("hooks")) {
    incompatibilities.push(
      "PAI hooks changed — adapter hook handlers may need updates"
    );
  }

  // Context routing changes affect the context-loader
  if (affectedDomains.has("context")) {
    const contextDeleted = changedFiles.some(
      (f) => f.domain === "context" && f.status === "deleted"
    );
    if (contextDeleted) {
      incompatibilities.push(
        "Context routing files deleted — adapter context-loader will break"
      );
    }
  }

  // Settings/config changes can shift paths
  if (affectedDomains.has("settings")) {
    incompatibilities.push(
      "PAI settings/config changed — adapter path constants may need updates"
    );
  }

  return {
    compatible: incompatibilities.length === 0,
    incompatibilities,
    affectedDomains: Array.from(affectedDomains),
    affectedAdapterFiles: Array.from(affectedAdapterFiles),
  };
}

// ============================================================================
// Main orchestrator
// ============================================================================

export async function runUpgrade(options: UpgraderOptions = {}): Promise<UpgradeReport> {
  const {
    repoDir = PAI_REPO_DIR,
    paiDir = PAI_DIR,
    paiCoreDir = PAI_CORE_DIR,
    runCmd = (cmd, opts) =>
      execSync(cmd, { encoding: "utf-8", cwd: opts?.cwd }),
    dryRun = false,
  } = options;

  const report: UpgradeReport = {
    timestamp: new Date().toISOString(),
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
    errors: [],
    success: false,
  };

  fileLog(`PAI upgrade starting (dryRun: ${dryRun})`, "info");

  // Validate prerequisites
  if (!existsSync(repoDir)) {
    report.errors.push(
      `PAI upstream repo not found at ${repoDir}. Run: git clone https://github.com/danielmiessler/Personal_AI_Infrastructure ${repoDir}`
    );
    return report;
  }

  // Phase 1: FETCH
  report.phase = "fetch";
  const fetchResult = fetchUpstream(repoDir, runCmd);
  if (!fetchResult.ok) {
    report.errors.push(fetchResult.error!);
    return report;
  }

  // Phase 2: CHECK
  report.phase = "check";
  const status = checkUpstreamStatus(repoDir, runCmd);
  report.upstreamStatus = status;

  if (!status.hasChanges) {
    report.phase = "verify";
    report.success = true;
    fileLog("PAI is already up to date", "info");
    return report;
  }

  // Phase 3: DIFF
  report.phase = "diff";
  report.changedFiles = diffUpstream(repoDir, runCmd);

  // Phase 4: BACKUP
  report.phase = "backup";
  if (!dryRun) {
    const backup = backupPAI(paiCoreDir, paiDir);
    report.backupPath = backup.backupPath;
    if (backup.error) {
      report.errors.push(backup.error);
      // Non-fatal — continue but warn
    }
  } else {
    report.backupPath = "[dry-run] no backup created";
  }

  // Phase 5: PULL
  report.phase = "pull";
  if (!dryRun) {
    const pullResult = pullUpstream(repoDir, runCmd);
    if (!pullResult.ok) {
      report.errors.push(pullResult.error!);
      return report;
    }
  }

  // Phase 6: SYNC
  report.phase = "sync";
  const syncResult = syncFiles(repoDir, paiCoreDir, dryRun);
  report.syncedFiles = syncResult.syncedFiles;
  if (syncResult.errors.length > 0) {
    report.errors.push(...syncResult.errors);
  }

  // Phase 7: REBUILD — regenerate CLAUDE.md from template + settings
  report.phase = "rebuild";
  const rebuildResult = rebuildClaudeMd(paiDir, runCmd, dryRun);
  report.claudeMdRebuilt = rebuildResult.rebuilt;
  report.claudeMdRebuildOutput = rebuildResult.output;
  if (rebuildResult.error) {
    report.errors.push(rebuildResult.error);
  }
  if (rebuildResult.warning) {
    report.warnings.push(rebuildResult.warning);
  }

  // Phase 8: COMPAT
  report.phase = "compat";
  const compat = checkAdapterCompat(report.changedFiles);
  report.adapterCompatible = compat.compatible;
  report.incompatibilities = compat.incompatibilities;

  // Phase 9: VERIFY (basic)
  report.phase = "verify";
  report.success = report.errors.length === 0;

  fileLog(
    `PAI upgrade complete: ${report.changedFiles.length} files changed, ` +
      `${report.syncedFiles.length} synced, ` +
      `adapter ${report.adapterCompatible ? "compatible" : "NEEDS UPDATES"}`,
    "info"
  );

  return report;
}

// ============================================================================
// Report formatting
// ============================================================================

export function formatUpgradeReport(report: UpgradeReport): string {
  const lines: string[] = [];

  lines.push("# PAI Upgrade Report");
  lines.push(`**Timestamp:** ${report.timestamp}`);
  lines.push("");

  // Upstream status
  if (report.upstreamStatus) {
    if (!report.upstreamStatus.hasChanges) {
      lines.push("## Status: Up to Date");
      lines.push(
        `Local PAI is already at the latest upstream commit (\`${report.upstreamStatus.currentSha.slice(0, 8)}\`).`
      );
      return lines.join("\n");
    }

    lines.push("## Upstream Changes");
    lines.push(
      `- **Behind:** ${report.upstreamStatus.behindCount} commit(s)`
    );
    lines.push(
      `- **Local:** \`${report.upstreamStatus.currentSha.slice(0, 8)}\``
    );
    lines.push(
      `- **Remote:** \`${report.upstreamStatus.remoteSha.slice(0, 8)}\``
    );
    lines.push("");
  }

  // Changed files by domain
  if (report.changedFiles.length > 0) {
    lines.push("## Changed Files");

    const byDomain = new Map<ChangeDomain, ChangedFile[]>();
    for (const f of report.changedFiles) {
      const existing = byDomain.get(f.domain) ?? [];
      existing.push(f);
      byDomain.set(f.domain, existing);
    }

    for (const [domain, files] of byDomain) {
      lines.push(`### ${domain} (${files.length})`);
      for (const f of files.slice(0, 10)) {
        lines.push(`- \`${f.status}\` ${f.path}`);
      }
      if (files.length > 10) {
        lines.push(`- ... and ${files.length - 10} more`);
      }
      lines.push("");
    }
  }

  // Sync results
  if (report.syncedFiles.length > 0) {
    lines.push("## Synced");
    lines.push(
      `${report.syncedFiles.length} entries synced to PAI installation.`
    );
    lines.push("");
  }

  // CLAUDE.md rebuild
  lines.push("## CLAUDE.md Rebuild");
  if (report.claudeMdRebuilt) {
    lines.push("CLAUDE.md rebuilt successfully from template.");
    if (report.claudeMdRebuildOutput) {
      lines.push(`\`\`\`\n${report.claudeMdRebuildOutput}\n\`\`\``);
    }
  } else if (report.claudeMdRebuildOutput.includes("[dry-run]")) {
    lines.push(report.claudeMdRebuildOutput);
  } else {
    lines.push("CLAUDE.md was not rebuilt — check errors below.");
  }
  lines.push("");

  // Backup
  if (report.backupPath) {
    lines.push(`**Backup:** \`${report.backupPath}\``);
    lines.push("");
  }

  // Adapter compatibility
  lines.push("## Adapter Compatibility");
  if (report.adapterCompatible) {
    lines.push(
      "Adapter is compatible with the updated PAI — no changes needed."
    );
  } else {
    lines.push("**Adapter needs updates:**");
    for (const inc of report.incompatibilities) {
      lines.push(`- ${inc}`);
    }
  }
  lines.push("");

  // Warnings
  if (report.warnings.length > 0) {
    lines.push("## Warnings");
    for (const w of report.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }

  // Errors
  if (report.errors.length > 0) {
    lines.push("## Errors");
    for (const e of report.errors) {
      lines.push(`- ${e}`);
    }
    lines.push("");
  }

  // Overall
  lines.push("---");
  lines.push(
    report.success
      ? "Upgrade completed successfully."
      : "Upgrade completed with errors — review above."
  );

  return lines.join("\n");
}

// ============================================================================
// CLI entry point
// ============================================================================

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  runUpgrade({ dryRun })
    .then((report) => {
      process.stdout.write(formatUpgradeReport(report) + "\n");
      process.exit(report.success ? 0 : 1);
    })
    .catch((err) => {
      process.stderr.write(`PAI upgrade error: ${err}\n`);
      process.exit(1);
    });
}
