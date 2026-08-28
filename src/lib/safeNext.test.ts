import { describe, it, expect } from "vitest";
import { safeNext } from "./safeNext";

/**
 * The login page carries `?next=` so a lapsed session returns you where you
 * were. Following it unchecked makes Capture an open redirect: a link to
 * `/login?next=https://look-a-like.example` walks a person through a real
 * login and then lands them elsewhere, right after they have proved they
 * trust the page.
 */
describe("where login may send you", () => {
  it("keeps an ordinary path, with its query and hash", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/app")).toBe("/app");
    expect(safeNext("/app?tab=threads#t-1")).toBe("/app?tab=threads#t-1");
  });

  it("refuses another origin", () => {
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("http://evil.example/app")).toBe("/");
  });

  it("refuses a protocol-relative destination", () => {
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("//evil.example/app")).toBe("/");
  });

  it("refuses backslash variants some parsers read as slashes", () => {
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("\\\\evil.example")).toBe("/");
  });

  it("refuses a destination hidden behind leading whitespace", () => {
    /* Browsers strip these before parsing, so the check has to as well. */
    expect(safeNext("\n//evil.example")).toBe("/");
    expect(safeNext("  https://evil.example")).toBe("/");
    expect(safeNext("\t/\\evil.example")).toBe("/");
  });

  it("refuses a control character hidden INSIDE the path", () => {
    /* The bypass a review found: leading-only stripping let this through,
       and the browser then removed the newline itself and navigated to
       //evil.example — a different origin. */
    expect(safeNext("/\n/evil.example")).toBe("/");
    expect(safeNext("/\r/evil.example")).toBe("/");
    expect(safeNext("/\t/evil.example")).toBe("/");
    expect(safeNext("/\u0000/evil.example")).toBe("/");
    expect(safeNext("/x\n/../..//evil.example")).toBe("/");
  });

  it("refuses a scheme once its control characters are stripped", () => {
    expect(safeNext("java\nscript:alert(1)")).toBe("/");
  });

  it("treats a colon inside a path as an ordinary path", () => {
    /* "/javascript:alert(1)" is not a scheme — the leading slash makes it a
       path, it resolves to this origin, and navigating to it just 404s. The
       test to apply is "does it leave the origin", not "does it look
       alarming"; rejecting it would be superstition, and the string rules
       that kind of caution produces are what let two real bypasses through
       earlier. */
    expect(safeNext("/javascript:alert(1)")).toBe("/javascript:alert(1)");
    expect(safeNext("/data:text/html,x")).toBe("/data:text/html,x");
  });

  it("falls back for anything missing, empty, or not a path", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
    expect(safeNext("app")).toBe("/");
  });
});
