/**
 * env-loader.ts - PAI Environment Variable Loader
 *
 * MIT License — Custom implementation for PAI-OpenCode Hybrid Adapter
 *
 * Loads API keys from ~/.config/PAI/.env into process.env at plugin startup.
 * PAI skills reference environment variables (SHODAN_API_KEY, APIFY_TOKEN, etc.)
 * but the shell doesn't source the .env file automatically.
 *
 * Parsing rules:
 *   - KEY=VALUE lines are parsed and injected into process.env
 *   - Supports quoted values: KEY="value" and KEY='value'
 *   - Lines starting with # are skipped (comments)
 *   - Empty lines are skipped
 *   - Existing process.env values are NOT overwritten (system env takes precedence)
 *   - Malformed lines are logged and skipped (no throw)
 *
 * @module env-loader
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileLog } from "../lib/file-logger.js";

/** Default path to PAI's .env file */
const DEFAULT_ENV_PATH = join(homedir(), ".config", "PAI", ".env");

/**
 * Parse a single KEY=VALUE line, handling optional quotes.
 * Returns [key, value] or null if the line is not a valid assignment.
 */
function parseLine(line: string): [string, string] | null {
  const trimmed = line.trim();

  // Skip empty lines and comments
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  // Must contain = to be a valid assignment
  const eqIndex = trimmed.indexOf("=");
  if (eqIndex < 1) {
    return null;
  }

  const key = trimmed.slice(0, eqIndex).trim();
  let value = trimmed.slice(eqIndex + 1).trim();

  // Strip surrounding quotes (double or single)
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  // Validate key: must be non-empty and contain only valid env var chars
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  return [key, value];
}

/**
 * Load environment variables from a .env file into process.env.
 *
 * @param envPath - Path to the .env file (defaults to ~/.config/PAI/.env)
 * @returns Object with loaded count and skipped count
 */
export function loadEnvFile(
  envPath: string = DEFAULT_ENV_PATH,
): { loaded: number; skipped: number; missing: boolean } {
  if (!existsSync(envPath)) {
    fileLog(`[env-loader] .env file not found: ${envPath}`, "debug");
    return { loaded: 0, skipped: 0, missing: true };
  }

  let content: string;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch (err) {
    fileLog(`[env-loader] failed to read .env file: ${String(err)}`, "error");
    return { loaded: 0, skipped: 0, missing: false };
  }

  const lines = content.split("\n");
  let loaded = 0;
  let skipped = 0;

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) {
      continue; // comment, empty, or malformed — skip silently
    }

    const [key, value] = parsed;

    // Do NOT overwrite existing env vars — system/shell env takes precedence
    if (process.env[key] !== undefined) {
      skipped++;
      continue;
    }

    process.env[key] = value;
    loaded++;
  }

  fileLog(
    `[env-loader] loaded ${loaded} env vars from ${envPath} (${skipped} skipped — already set)`,
    "info",
  );

  return { loaded, skipped, missing: false };
}
