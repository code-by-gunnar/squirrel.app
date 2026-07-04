import { describe, it, expect } from "vitest";
import { toCsv } from "./csv";

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
