/**
 * env-loader.test.ts - Tests for PAI Environment Variable Loader
 *
 * MIT License — Custom implementation for PAI-OpenCode Hybrid Adapter
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadEnvFile } from "../handlers/env-loader.js";

describe("env-loader", () => {
  let tempDir: string;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "env-loader-test-"));
    // Save a shallow copy of process.env to restore later
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore process.env exactly as it was
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      process.env[key] = value;
    }
    // Clean up temp dir
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses KEY=VALUE lines correctly", () => {
    const envFile = join(tempDir, ".env");
    writeFileSync(envFile, "TEST_KEY_A=hello\nTEST_KEY_B=world\n");

    const result = loadEnvFile(envFile);

    expect(result.loaded).toBe(2);
    expect(result.missing).toBe(false);
    expect(process.env.TEST_KEY_A).toBe("hello");
    expect(process.env.TEST_KEY_B).toBe("world");
  });

  it("skips comment lines starting with #", () => {
    const envFile = join(tempDir, ".env");
    writeFileSync(envFile, "# This is a comment\nTEST_COMMENT_KEY=value\n# Another comment\n");

    const result = loadEnvFile(envFile);

    expect(result.loaded).toBe(1);
    expect(process.env.TEST_COMMENT_KEY).toBe("value");
  });

  it("skips empty lines", () => {
    const envFile = join(tempDir, ".env");
    writeFileSync(envFile, "\nTEST_EMPTY_KEY=value\n\n\n");

    const result = loadEnvFile(envFile);

    expect(result.loaded).toBe(1);
    expect(process.env.TEST_EMPTY_KEY).toBe("value");
  });

  it("handles missing .env file gracefully (no throw)", () => {
    const nonExistent = join(tempDir, "does-not-exist.env");

    const result = loadEnvFile(nonExistent);

    expect(result.loaded).toBe(0);
    expect(result.missing).toBe(true);
  });

  it("does not overwrite existing process.env values", () => {
    const envFile = join(tempDir, ".env");
    // Set an existing env var
    process.env.TEST_EXISTING_KEY = "original";
    writeFileSync(envFile, "TEST_EXISTING_KEY=overwritten\nTEST_NEW_KEY=fresh\n");

    const result = loadEnvFile(envFile);

    expect(result.loaded).toBe(1);
    expect(result.skipped).toBe(1);
    expect(process.env.TEST_EXISTING_KEY).toBe("original"); // NOT overwritten
    expect(process.env.TEST_NEW_KEY).toBe("fresh");
  });

  it("handles double-quoted values", () => {
    const envFile = join(tempDir, ".env");
    writeFileSync(envFile, 'TEST_QUOTED="hello world"\n');

    const result = loadEnvFile(envFile);

    expect(result.loaded).toBe(1);
    expect(process.env.TEST_QUOTED).toBe("hello world");
  });

  it("handles single-quoted values", () => {
    const envFile = join(tempDir, ".env");
    writeFileSync(envFile, "TEST_SINGLE='hello world'\n");

    const result = loadEnvFile(envFile);

    expect(result.loaded).toBe(1);
    expect(process.env.TEST_SINGLE).toBe("hello world");
  });

  it("skips malformed lines without key", () => {
    const envFile = join(tempDir, ".env");
    writeFileSync(envFile, "=nokey\njust_text\nVALID_KEY=ok\n");

    const result = loadEnvFile(envFile);

    expect(result.loaded).toBe(1);
    expect(process.env.VALID_KEY).toBe("ok");
  });
});
