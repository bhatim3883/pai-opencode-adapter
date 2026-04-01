/**
 * Agent Model Sync
 *
 * Synchronizes model assignments from pai-adapter.json into agent .md files'
 * YAML frontmatter. Ensures the `model:` field in each agent definition
 * matches the configured role→model mapping.
 *
 * Problem: OpenCode reads the `model:` field from agent .md YAML frontmatter
 * to determine which model a subagent uses. The `<model-routing>` context we
 * inject into system prompts is purely advisory — it doesn't override the
 * hardcoded model in the agent file. This module bridges that gap.
 *
 * @module lib/agent-model-sync
 */

import { existsSync, readFileSync, readdirSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileLog } from "./file-logger.js";
import { getConfigDir, getAdapterConfigPath } from "./paths.js";
import { getModelConfig, type ModelRole } from "./model-resolver.js";

// ── Agent → Role Mapping ─────────────────────────────────

/**
 * Maps agent filename (without .md) to its model role in pai-adapter.json.
 *
 * - algorithm / native: primary agents → use "default" model
 * - intern: simple/cheap tasks → use "intern" model (flash-lite)
 * - explorer: codebase exploration → use "explorer" model (flash)
 * - research: research tasks → use "explorer" model (fast, broad)
 * - engineer: implementation tasks → use "engineer" model (sonnet)
 * - architect: system design → use "architect" model (sonnet)
 * - thinker: deep reasoning → use "reviewer" model (strongest, opus)
 */
export const AGENT_ROLE_MAP: Record<string, ModelRole> = {
	algorithm: "default",
	native: "default",
	intern: "intern",
	explorer: "explorer",
	research: "explorer",
	engineer: "engineer",
	architect: "architect",
	thinker: "reviewer",
};

// ── YAML Frontmatter Patching ─────────────────────────────

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns the frontmatter string and the rest of the content.
 */
function parseFrontmatter(content: string): { frontmatter: string; body: string } | null {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) {
		return null;
	}
	return {
		frontmatter: match[1] ?? "",
		body: match[2] ?? "",
	};
}

/**
 * Replace or add the `model:` field in YAML frontmatter.
 * Preserves all other fields and their order.
 */
function patchModelField(frontmatter: string, newModel: string): string {
	const modelLineRegex = /^model:\s*.+$/m;

	if (modelLineRegex.test(frontmatter)) {
		// Replace existing model field
		return frontmatter.replace(modelLineRegex, `model: ${newModel}`);
	}

	// No model field found — add it after description (or at end)
	const lines = frontmatter.split("\n");
	const descIndex = lines.findIndex((l) => l.startsWith("description:"));
	if (descIndex >= 0) {
		lines.splice(descIndex + 1, 0, `model: ${newModel}`);
	} else {
		lines.push(`model: ${newModel}`);
	}
	return lines.join("\n");
}

/**
 * Reconstruct a markdown file from patched frontmatter and body.
 */
function reconstructFile(frontmatter: string, body: string): string {
	if (body) {
		return `---\n${frontmatter}\n---\n${body}`;
	}
	return `---\n${frontmatter}\n---\n`;
}

// ── Sync Logic ────────────────────────────────────────────

export interface SyncResult {
	synced: string[];
	skipped: string[];
	errors: string[];
}

/**
 * Synchronize model assignments from pai-adapter.json into agent .md files.
 *
 * Reads the model config, then for each agent file in ~/.config/opencode/agents/,
 * patches the `model:` YAML frontmatter field to match the configured role model.
 *
 * Only writes the file if the model actually changed, to avoid unnecessary I/O.
 */
export function syncAgentModels(): SyncResult {
	const result: SyncResult = { synced: [], skipped: [], errors: [] };

	// Locate agents directory
	const agentsDir = join(getConfigDir(), "agents");
	if (!existsSync(agentsDir)) {
		fileLog("[agent-model-sync] Agents directory not found, skipping sync", "debug");
		result.skipped.push("agents directory not found");
		return result;
	}

	// Load model config
	let config: ReturnType<typeof getModelConfig>;
	try {
		config = getModelConfig();
	} catch (err) {
		fileLog(`[agent-model-sync] Failed to load model config: ${err}`, "warn");
		result.errors.push(`config load failed: ${String(err)}`);
		return result;
	}

	// List agent .md files
	let agentFiles: string[];
	try {
		agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
	} catch (err) {
		fileLog(`[agent-model-sync] Failed to read agents dir: ${err}`, "warn");
		result.errors.push(`read agents dir failed: ${String(err)}`);
		return result;
	}

	for (const filename of agentFiles) {
		const agentName = filename.replace(/\.md$/, "");
		const role = AGENT_ROLE_MAP[agentName];

		if (!role) {
			fileLog(`[agent-model-sync] No role mapping for agent "${agentName}", skipping`, "debug");
			result.skipped.push(agentName);
			continue;
		}

		// Resolve the model for this role
		let targetModel: string | undefined;
		if (role === "default" || role === "validation") {
			targetModel = config.models[role];
		} else {
			targetModel = config.models.agents?.[role];
		}

		if (!targetModel) {
			fileLog(`[agent-model-sync] No model configured for role "${role}", skipping ${agentName}`, "debug");
			result.skipped.push(`${agentName} (no model for role ${role})`);
			continue;
		}

		// Read and patch the agent file
		const filePath = join(agentsDir, filename);
		try {
			const content = readFileSync(filePath, "utf-8");
			const parsed = parseFrontmatter(content);

			if (!parsed) {
				fileLog(`[agent-model-sync] No YAML frontmatter in ${filename}, skipping`, "warn");
				result.skipped.push(`${agentName} (no frontmatter)`);
				continue;
			}

			// Check if model already matches
			const currentModelMatch = parsed.frontmatter.match(/^model:\s*(.+)$/m);
			const currentModel = currentModelMatch?.[1]?.trim();

			if (currentModel === targetModel) {
				result.skipped.push(`${agentName} (already correct)`);
				continue;
			}

			// Patch and write
			const patchedFrontmatter = patchModelField(parsed.frontmatter, targetModel);
			const newContent = reconstructFile(patchedFrontmatter, parsed.body);
			writeFileSync(filePath, newContent, "utf-8");

			fileLog(
				`[agent-model-sync] Updated ${agentName}: ${currentModel ?? "(none)"} → ${targetModel}`,
				"info",
			);
			result.synced.push(`${agentName}: ${currentModel ?? "(none)"} → ${targetModel}`);
		} catch (err) {
			fileLog(`[agent-model-sync] Error processing ${filename}: ${err}`, "warn");
			result.errors.push(`${agentName}: ${String(err)}`);
		}
	}

	if (result.synced.length > 0) {
		fileLog(
			`[agent-model-sync] Sync complete: ${result.synced.length} updated, ${result.skipped.length} skipped`,
			"info",
		);
	}

	return result;
}

// ── Config File Watcher ──────────────────────────────────

let configWatcher: ReturnType<typeof watch> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 500;

/**
 * Debounced sync handler — shared by both "change" and "rename" events.
 * Triggers syncAgentModels() after a 500ms quiet period.
 */
function debouncedSync(): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}
	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		fileLog("[agent-model-sync] Config change detected, re-syncing agent models", "info");
		try {
			const result = syncAgentModels();
			if (result.synced.length > 0) {
				fileLog(
					`[agent-model-sync] Re-sync result: ${result.synced.join(", ")}`,
					"info",
				);
			}
			if (result.errors.length > 0) {
				fileLog(
					`[agent-model-sync] Re-sync errors: ${result.errors.join(", ")}`,
					"warn",
				);
			}
		} catch (err) {
			fileLog(`[agent-model-sync] Re-sync failed: ${err}`, "error");
		}
	}, DEBOUNCE_MS);
}

/**
 * Watch pai-adapter.json for changes and trigger syncAgentModels() on change.
 *
 * Watches the PARENT DIRECTORY rather than the file itself. This is critical
 * on macOS because `fs.watch` uses kqueue, which watches the file's inode.
 * When editors like VS Code save via write-to-temp + rename (atomic write),
 * the original inode is replaced, silently killing a file-level watcher.
 * Directory-level watching catches both "change" (in-place edits) and
 * "rename" (atomic write replacements) for the target filename.
 *
 * Uses debouncing (500ms) to avoid thrashing when editors trigger multiple
 * fs.watch events for a single save.
 *
 * @returns A stop function to close the watcher
 */
export function watchConfigAndSync(): () => void {
	const configPath = getAdapterConfigPath();
	const configDir = dirname(configPath);
	const configFilename = basename(configPath);

	if (!existsSync(configPath)) {
		fileLog("[agent-model-sync] Config file not found, skipping watcher", "warn");
		return () => {};
	}

	if (configWatcher) {
		fileLog("[agent-model-sync] Watcher already active, skipping", "debug");
		return () => { stopConfigWatcher(); };
	}

	try {
		// Watch the parent directory and filter for our config filename.
		// This survives atomic writes (write-to-temp + rename) on macOS
		// because the directory inode persists even when file inodes change.
		configWatcher = watch(configDir, (eventType, filename) => {
			// filename may be null on some platforms; filter for our target
			if (filename && filename !== configFilename) {
				return;
			}
			// Both "change" (in-place write) and "rename" (atomic write)
			// indicate the config file was modified. Debounce both.
			if (eventType === "change" || eventType === "rename") {
				debouncedSync();
			}
		});

		fileLog(`[agent-model-sync] Watching config directory for changes: ${configDir} (file: ${configFilename})`, "info");
	} catch (err) {
		fileLog(`[agent-model-sync] Failed to start config watcher: ${err}`, "error");
		configWatcher = null;
		return () => {};
	}

	return stopConfigWatcher;
}

/**
 * Stop the config file watcher.
 */
function stopConfigWatcher(): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
	if (configWatcher) {
		configWatcher.close();
		configWatcher = null;
		fileLog("[agent-model-sync] Config watcher stopped", "info");
	}
}
