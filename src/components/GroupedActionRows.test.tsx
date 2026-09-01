/** @vitest-environment jsdom */
import { useEffect } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GroupedActionRows } from "./GroupedActionRows";
import type { Action } from "@/lib/model";

const action = (id: string): Action => ({
  id,
  text: `Action ${id}`,
  done: false,
  at: 1,
  shelf: "keep",
  expires: null,
});

describe("GroupedActionRows", () => {
  it("keeps surviving rows mounted when the group's first action disappears", () => {
    const mounts = new Map<string, number>();
    const Probe = ({ item }: { item: Action }) => {
      useEffect(() => {
        mounts.set(item.id, (mounts.get(item.id) ?? 0) + 1);
      }, [item.id]);
      return <div data-testid={item.id}>{item.text}</div>;
    };
    const a = action("a");
    const b = action("b");
    const c = action("c");
    const renderRow = (item: Action) => <Probe key={item.id} item={item} />;
    const { getByTestId, rerender } = render(
      <GroupedActionRows
        grouped={{ groups: [{ label: "work", actions: [a, b, c] }], rest: [] }}
        renderRow={renderRow}
      />
    );
    const before = getByTestId("b");

    rerender(
      <GroupedActionRows
        grouped={{ groups: [{ label: "work", actions: [b, c] }], rest: [] }}
        renderRow={renderRow}
      />
    );

    expect(getByTestId("b")).toBe(before);
    expect(mounts.get("b")).toBe(1);
  });
});
