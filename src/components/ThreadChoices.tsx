"use client";

import { useState } from "react";
import type { Thread } from "@/lib/model";
import styles from "./ThreadChoices.module.css";

export function ThreadChoices({
  threads,
  onSelect,
  countLabel = "fragment",
}: {
  threads: Thread[];
  onSelect: (id: string) => void;
  countLabel?: "fragment" | "layer";
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const matches = threads.filter((thread) => thread.name.toLocaleLowerCase().includes(needle));

  return (
    <>
      <input
        className={styles.search}
        type="search"
        aria-label="Search threads"
        placeholder="Search threads"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
          if (event.key === "Escape" && query) {
            event.preventDefault();
            event.stopPropagation();
            setQuery("");
          }
        }}
      />
      {!matches.length && <p className="picker-hint" role="status">{needle ? "No matching threads." : "No other threads."}</p>}
      {matches.map((thread) => (
        <button key={thread.id} type="button" className="picker-row" onClick={() => onSelect(thread.id)}>
          <span className="picker-name">{thread.name}</span>
          <span className="picker-meta">
            {thread.frags.length} {countLabel}{thread.frags.length === 1 ? "" : "s"}
          </span>
        </button>
      ))}
    </>
  );
}
