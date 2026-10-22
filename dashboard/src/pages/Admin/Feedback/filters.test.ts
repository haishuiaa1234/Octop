import { describe, expect, it } from "vitest";
import { feedbackDateRange } from "./filters";

describe("feedback dates use the server timezone", () => {
  it("includes the full final day in Shanghai, independent of browser timezone", () => {
    expect(
      feedbackDateRange("2026-10-22", "2026-10-22", "Asia/Shanghai"),
    ).toEqual({
      start_time: Date.parse("2026-10-21T16:00:00Z") / 1000,
      end_time: Date.parse("2026-10-22T16:00:00Z") / 1000,
    });
  });
  it("handles a 23-hour daylight saving day", () => {
    const range = feedbackDateRange(
      "2026-03-08",
      "2026-03-08",
      "America/New_York",
    );
    expect(range.end_time! - range.start_time!).toBe(23 * 3600);
  });
  it("rejects inverted ranges", () => {
    expect(() =>
      feedbackDateRange("2026-10-23", "2026-10-22", "UTC"),
    ).toThrow();
  });
});
