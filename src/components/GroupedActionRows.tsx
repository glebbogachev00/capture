"use client";

import type { ReactElement, ReactNode } from "react";
import type { Action } from "@/lib/model";
import type { GroupedActions } from "@/lib/group";

export function GroupedActionRows({
  grouped,
  renderRow,
}: {
  grouped: GroupedActions;
  renderRow: (action: Action) => ReactElement;
}) {
  const nodes: ReactNode[] = [];
  grouped.groups.forEach((group, index) => {
    nodes.push(
      <div className="group-label" key={`group-label:${index}:${group.label}`}>
        {group.label} · {group.actions.length}
      </div>
    );
    nodes.push(...group.actions.map(renderRow));
  });
  if (grouped.groups.length && grouped.rest.length) {
    nodes.push(
      <div className="group-label rest" key="group-rest-label">
        everything else · {grouped.rest.length}
      </div>
    );
  }
  nodes.push(...grouped.rest.map(renderRow));
  return <>{nodes}</>;
}
