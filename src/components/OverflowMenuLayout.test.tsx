/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Row } from "./cards";
import type { Action } from "@/lib/model";

const action: Action = {
  id: "action-1",
  text: "Test the menu alignment",
  done: false,
  at: Date.UTC(2026, 8, 12),
  shelf: "keep",
  expires: null,
};

const noop = vi.fn();

afterEach(cleanup);

describe("overflow menu layout", () => {
  it("renders the action menu as a full-row sibling of the action controls", () => {
    const { container } = render(
      <Row
        a={action}
        now={action.at}
        shelfOpen={false}
        onToggle={noop}
        onShelfClick={noop}
        onSetShelf={noop}
        onRestore={noop}
        onRemove={noop}
        onMakeThread={noop}
        onEditText={noop}
        onResort={noop}
        onMakeIntention={noop}
        onCopy={noop}
        busy={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "More options" }));

    const row = container.querySelector(".act");
    const menu = container.querySelector(".row-actions");
    expect(menu).toBeTruthy();
    expect(menu?.parentElement).toBe(row);
    expect(menu?.previousElementSibling?.classList.contains("act-tools")).toBe(true);
  });

  it("uses an equal two-column grid anchored to the right edge", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const actionRule = css.match(/\.act\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const moreRule = css.match(/\.more-btn\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const menuRule = css.match(/\.row-actions\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const actionMenuRule = css.match(/\.act\s*>\s*\.row-actions\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const buttonRule = css.match(/\.row-actions\s*>\s*\.ghost\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const oddRule = css.match(/\.row-actions\s*>\s*\.ghost:last-child:nth-child\(odd\)\s*\{([\s\S]*?)\}/)?.[1] ?? "";

    expect(actionRule).toMatch(/flex-wrap:\s*wrap/);
    expect(moreRule).toMatch(/width:\s*40px/);
    expect(moreRule).toMatch(/height:\s*40px/);
    expect(menuRule).toMatch(/display:\s*grid/);
    expect(menuRule).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(menuRule).toMatch(/width:\s*min\(100%,\s*430px\)/);
    expect(menuRule).toMatch(/margin-top:\s*8px/);
    expect(menuRule).toMatch(/margin-left:\s*auto/);
    expect(menuRule).toMatch(/padding-top:\s*8px/);
    expect(actionMenuRule).toMatch(/flex:\s*0\s+0\s+min\(100%,\s*430px\)/);
    expect(buttonRule).toMatch(/width:\s*100%/);
    expect(buttonRule).toMatch(/justify-content:\s*center/);
    expect(oddRule).toMatch(/grid-column:\s*1\s*\/\s*-1/);
  });
});
