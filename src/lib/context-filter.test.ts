import { describe, it, expect } from "vitest";
import { resolveContextFilter } from "./context-filter";

describe("resolveContextFilter", () => {
  const live = new Set([1, 2]);

  it("returns 'all' when the cookie is absent", () => {
    expect(resolveContextFilter(undefined, live)).toBe("all");
  });

  it("returns 'all' for an empty string", () => {
    expect(resolveContextFilter("", live)).toBe("all");
  });

  it("returns 'unassigned' verbatim", () => {
    expect(resolveContextFilter("unassigned", live)).toBe("unassigned");
  });

  it("returns the numeric id when it is a live context", () => {
    expect(resolveContextFilter("2", live)).toBe(2);
  });

  it("falls back to 'all' for a stale/deleted id", () => {
    expect(resolveContextFilter("99", live)).toBe("all");
  });

  it("falls back to 'all' for non-numeric junk", () => {
    expect(resolveContextFilter("abc", live)).toBe("all");
  });
});
