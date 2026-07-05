import { describe, it, expect } from "vitest";
import { toCsv, parseCsv } from "./csv";

describe("toCsv", () => {
  it("joins headers and rows with CRLF", () => {
    const csv = toCsv(["A", "B"], [
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(csv).toBe("A,B\r\n1,2\r\n3,4");
  });

  it("quotes fields containing commas, quotes or newlines", () => {
    const csv = toCsv(["Name", "Notes"], [
      ["Spotify, Family", 'He said "hi"'],
      ["Line\nbreak", "plain"],
    ]);
    expect(csv).toBe(
      'Name,Notes\r\n"Spotify, Family","He said ""hi"""\r\n"Line\nbreak",plain',
    );
  });

  it("renders null/undefined as empty and keeps numbers", () => {
    const csv = toCsv(["X", "Y", "Z"], [[null, undefined, 9]]);
    expect(csv).toBe("X,Y,Z\r\n,,9");
  });
});

describe("parseCsv", () => {
  it("round-trips a toCsv document", () => {
    const csv = toCsv(["A", "B"], [["1", "two"], ["3", "four"]]);
    expect(parseCsv(csv)).toEqual([["A", "B"], ["1", "two"], ["3", "four"]]);
  });
  it("handles quoted fields with commas, quotes and newlines", () => {
    const csv = 'Name,Notes\r\n"A, Inc.","He said ""hi""\nsecond line"';
    expect(parseCsv(csv)).toEqual([
      ["Name", "Notes"],
      ["A, Inc.", 'He said "hi"\nsecond line'],
    ]);
  });
  it("accepts LF or CRLF line endings", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("strips a leading UTF-8 BOM", () => {
    expect(parseCsv("﻿a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("ignores a trailing newline (no phantom empty row)", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps empty cells", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]);
  });
});
