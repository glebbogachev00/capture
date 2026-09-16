// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LandingThreadExample } from "./LandingThreadExample";

vi.stubGlobal("React", React);
afterEach(cleanup);

it("starts with a complete, explicitly illustrative transformation", () => {
  render(<LandingThreadExample />);
  expect(screen.getByText(/format is still open/)).toBeTruthy();
  expect(screen.getByText(/Illustrative example, not a live AI result/)).toBeTruthy();
  expect(screen.getByText(/Expiry is not completion/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Add Wednesday/ })).toBeTruthy();
});

it("accumulates sources, updates the summary, and replays only on request", () => {
  render(<LandingThreadExample />);
  fireEvent.click(screen.getByRole("button", { name: /Add Wednesday/ }));
  expect(screen.getByText(/The explanation can follow/)).toBeTruthy();
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: /Add Friday/ }));
  expect(screen.getByText(/moved from an idea to a decision/)).toBeTruthy();
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(screen.getByText(/Maybe the workshop should start/)).toBeTruthy();
  expect(screen.getByText(/3 source captures kept/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Replay example/ }));
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText(/format is still open/)).toBeTruthy();
});
