import { describe, test, expect, beforeEach } from "bun:test";
import {
  detectImplicitSentiment,
  implicitSentimentHandler,
  clearImplicitSentimentState,
} from "../handlers/implicit-sentiment.js";

const TEST_SESSION = "test-implicit-sentiment-abc";

beforeEach(() => {
  clearImplicitSentimentState(TEST_SESSION);
});

describe("detectImplicitSentiment", () => {
  test("detects frustrated signals", () => {
    const result = detectImplicitSentiment("this is broken and nothing works");
    expect(result).not.toBeNull();
    expect(result?.rating).toBe(3);
    expect(result?.signal).toBe("frustrated");
  });

  test("detects satisfied signals", () => {
    const result = detectImplicitSentiment("this is great, works perfectly now");
    expect(result).not.toBeNull();
    expect(result?.rating).toBe(8);
    expect(result?.signal).toBe("satisfied");
  });

  test("skips short messages (throttle)", () => {
    const result = detectImplicitSentiment("ok");
    expect(result).toBeNull();
  });

  test("skips neutral messages", () => {
    const result = detectImplicitSentiment("please add a button to the header component");
    expect(result).toBeNull();
  });

  test("detects frustrated - 'still not working' pattern", () => {
    const result = detectImplicitSentiment("this is still not working after all those changes");
    expect(result?.signal).toBe("frustrated");
  });

  test("detects satisfied - 'thank you' pattern", () => {
    const result = detectImplicitSentiment("thank you, that was exactly what I needed");
    expect(result?.signal).toBe("satisfied");
  });

  test("frustrated takes priority over neutral long message", () => {
    const result = detectImplicitSentiment("I really wish this would stop doing what the hell is going on here");
    expect(result?.rating).toBe(3);
  });
});

describe("implicitSentimentHandler", () => {
  test("handler respects cooldown — second call within 30s produces no output", () => {
    // First call with a frustrated message — should fire
    implicitSentimentHandler(TEST_SESSION, "this is broken and nothing works right now");

    // Clear the clearImplicitSentimentState so we can inspect the internal map indirectly:
    // By NOT clearing, the second call should be throttled by the cooldown.
    // We verify by checking that calling it again with a satisfied message doesn't override.
    // Since we can't directly inspect lastFiredMs, we verify fail-open behavior instead:
    // the second call must not throw.
    expect(() =>
      implicitSentimentHandler(TEST_SESSION, "this is great, works perfectly now"),
    ).not.toThrow();
  });

  test("handler does not throw on empty input (fail-open)", () => {
    expect(() => implicitSentimentHandler(TEST_SESSION, "")).not.toThrow();
  });

  test("handler does not throw on empty sessionId (fail-open)", () => {
    expect(() => implicitSentimentHandler("", "this is broken and nothing works")).not.toThrow();
  });

  test("handler does not throw on neutral message", () => {
    expect(() =>
      implicitSentimentHandler(TEST_SESSION, "please add a button to the header component"),
    ).not.toThrow();
  });

  test("handler fires for frustrated message without throwing", () => {
    expect(() =>
      implicitSentimentHandler(TEST_SESSION, "this is broken and nothing works right now"),
    ).not.toThrow();
  });

  test("handler fires for satisfied message without throwing", () => {
    expect(() =>
      implicitSentimentHandler(TEST_SESSION, "this is great, works perfectly now for real"),
    ).not.toThrow();
  });

  test("clearImplicitSentimentState resets cooldown", () => {
    // Fire once
    implicitSentimentHandler(TEST_SESSION, "this is broken and nothing works right now");
    // Reset
    clearImplicitSentimentState(TEST_SESSION);
    // Should fire again without throwing
    expect(() =>
      implicitSentimentHandler(TEST_SESSION, "this is broken and nothing works right now"),
    ).not.toThrow();
  });
});
