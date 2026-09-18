import { describe, expect, it } from "vitest";
import {
  addDays,
  forecastWindow,
  isWithinForecastWindow,
  relativeLabel,
  resolveDatePhrase,
  weekdayName,
} from "@/lib/dates";

// 2026-09-17 is a Thursday.
const TODAY = "2026-09-17";

describe("addDays", () => {
  it("rolls over a month boundary", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("rolls backwards", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("weekdayName", () => {
  it("names a known date", () => {
    expect(weekdayName(TODAY)).toBe("Thursday");
  });
});

describe("resolveDatePhrase", () => {
  it("resolves today and tomorrow", () => {
    expect(resolveDatePhrase("can I go today?", TODAY)).toBe(TODAY);
    expect(resolveDatePhrase("how about tomorrow", TODAY)).toBe("2026-09-18");
  });

  it("resolves the next occurrence of a weekday", () => {
    // Thursday -> Saturday is two days out.
    expect(resolveDatePhrase("where should I hike saturday", TODAY)).toBe("2026-09-19");
  });

  it("treats 'weekend' as the coming Saturday", () => {
    expect(resolveDatePhrase("anything good this weekend?", TODAY)).toBe("2026-09-19");
  });

  it("pushes 'next <weekday>' a full week when it is today", () => {
    expect(resolveDatePhrase("next thursday", TODAY)).toBe("2026-09-24");
    expect(resolveDatePhrase("on thursday", TODAY)).toBe(TODAY);
  });

  it("accepts an explicit ISO date", () => {
    expect(resolveDatePhrase("conditions on 2026-09-21 please", TODAY)).toBe("2026-09-21");
  });

  it("returns null when no day is mentioned", () => {
    expect(resolveDatePhrase("somewhere shady and steep", TODAY)).toBeNull();
  });
});

describe("forecast window", () => {
  it("starts today and runs seven days", () => {
    const window = forecastWindow(TODAY);
    expect(window).toHaveLength(7);
    expect(window[0]).toBe(TODAY);
  });

  it("accepts dates inside the window and rejects those outside", () => {
    expect(isWithinForecastWindow("2026-09-20", TODAY)).toBe(true);
    expect(isWithinForecastWindow("2026-10-20", TODAY)).toBe(false);
    expect(isWithinForecastWindow("2026-09-16", TODAY)).toBe(false);
  });
});

describe("relativeLabel", () => {
  it("prefers relative wording near the present", () => {
    expect(relativeLabel(TODAY, TODAY)).toBe("today");
    expect(relativeLabel("2026-09-18", TODAY)).toBe("tomorrow");
    expect(relativeLabel("2026-09-19", TODAY)).toBe("Saturday");
  });
});
