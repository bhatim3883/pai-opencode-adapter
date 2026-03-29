/**
 * implicit-sentiment.ts - Pattern-based implicit sentiment detection
 *
 * MIT License - Custom implementation for PAI-OpenCode Hybrid Adapter
 *
 * Detects frustrated/satisfied emotional tone from user messages
 * using regex patterns (no external API calls). Writes implicit
 * ratings to LEARNING/SIGNALS/ratings.jsonl alongside explicit ratings.
 *
 * Fire-and-forget, fail-open — never blocks or throws.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileLog } from "../lib/file-logger.js";
import { getMemoryPath } from "../lib/paths.js";
import { getISOTimestamp } from "../lib/time.js";
import type { RatingEntry } from "./learning-tracker.js";

// ── Constants ──────────────────────────────────────────────────────────────

/** Skip messages shorter than this — too little signal to be meaningful */
const MIN_MESSAGE_LENGTH = 20;

const SIGNALS_DIR_NAME = "SIGNALS";
const RATINGS_FILE = "ratings.jsonl";

/** Don't fire more than once per 30 seconds per session to avoid noise */
const COOLDOWN_MS = 30_000;

// ── Patterns ───────────────────────────────────────────────────────────────

/** Frustrated language → implicit rating 3 */
const FRUSTRATED_PATTERNS: RegExp[] = [
  /\b(this is broken|nothing works|still broken|keeps failing|not working|why does it|what the hell|this sucks|so frustrated|ugh|argh|ffs|wtf)\b/i,
  /\b(wrong again|same error|still not|you keep|stop doing|I said|I already told you|how many times)\b/i,
  /\b(completely wrong|totally broken|makes no sense|waste of time|give up)\b/i,
];

/** Satisfied language → implicit rating 8 */
const SATISFIED_PATTERNS: RegExp[] = [
  /\b(this is great|works perfectly|well done|nice work|good job|love it|exactly what I wanted|perfect|nailed it)\b/i,
  /\b(that's exactly|much better|finally works|thank you|thanks|appreciate it|impressive|beautiful)\b/i,
  /\b(brilliant|excellent|awesome|fantastic|amazing work|looking good|very nice|super helpful)\b/i,
];

// ── Session Cooldown ───────────────────────────────────────────────────────

/** Maps sessionId → timestamp of last implicit rating write */
const lastFiredMs = new Map<string, number>();

// ── Core Detection ─────────────────────────────────────────────────────────

/**
 * Analyse a message for implicit emotional sentiment.
 * Returns a rating+signal pair, or null if no strong signal detected.
 *
 * Frustrated patterns are checked first — frustration is higher-signal
 * than satisfaction for PAI learning purposes.
 */
export function detectImplicitSentiment(
  message: string,
): { rating: number; signal: string } | null {
  if (message.length < MIN_MESSAGE_LENGTH) return null;

  for (const pattern of FRUSTRATED_PATTERNS) {
    if (pattern.test(message)) {
      return { rating: 3, signal: "frustrated" };
    }
  }

  for (const pattern of SATISFIED_PATTERNS) {
    if (pattern.test(message)) {
      return { rating: 8, signal: "satisfied" };
    }
  }

  return null;
}

// ── Persistence ────────────────────────────────────────────────────────────

/**
 * Append an implicit RatingEntry to the shared ratings.jsonl file.
 * Uses the same path as learning-tracker to keep all ratings co-located.
 */
function appendImplicitRating(entry: RatingEntry): void {
  const signalsDir = getMemoryPath("LEARNING", SIGNALS_DIR_NAME);
  const filePath = join(signalsDir, RATINGS_FILE);

  if (!existsSync(signalsDir)) {
    mkdirSync(signalsDir, { recursive: true });
  }

  appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Implicit sentiment handler — call from chat.message hook.
 * Synchronous, fire-and-forget, never throws.
 */
export function implicitSentimentHandler(sessionId: string, message: string): void {
  try {
    if (!sessionId || !message) return;

    // Cooldown check — skip if we fired recently for this session
    const now = Date.now();
    const last = lastFiredMs.get(sessionId) ?? 0;
    if (now - last < COOLDOWN_MS) return;

    const result = detectImplicitSentiment(message);
    if (!result) return;

    const entry: RatingEntry = {
      timestamp: getISOTimestamp(),
      sessionId,
      rating: result.rating,
      source: "implicit",
      comment: result.signal,
    };

    appendImplicitRating(entry);
    lastFiredMs.set(sessionId, now);

    fileLog(
      `[implicit-sentiment] ${result.signal} detected for session ${sessionId.slice(0, 8)}: rating ${result.rating}`,
      "debug",
    );
  } catch (err) {
    // Fail-open — never propagate
    fileLog(`[implicit-sentiment] handler error: ${err}`, "warn");
  }
}

// ── Cleanup ────────────────────────────────────────────────────────────────

/**
 * Remove cooldown entry for a session.
 * Call on session.end to free memory and reset state.
 */
export function clearImplicitSentimentState(sessionId: string): void {
  lastFiredMs.delete(sessionId);
}
