/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/config", () => ({
  getCloudConfig: () => ({
    status: "ready",
    url: "https://capture.supabase.co",
    publishableKey: "sb_publishable_test",
  }),
}));

vi.mock("@/components/CloudLoginForm", () => ({
  CloudLoginForm: ({ nextPath }: { nextPath?: string | null }) => (
    <div data-testid="cloud-next">{nextPath ?? "none"}</div>
  ),
}));

import LoginPage from "@/app/login/page";

afterEach(cleanup);

describe("Cloud login page", () => {
  it("passes the requested return path into the OTP form", async () => {
    const page = await (LoginPage as unknown as (props: {
      searchParams: Promise<{ next?: string }>;
    }) => Promise<React.ReactNode>)({
      searchParams: Promise.resolve({ next: "/funding?from=login" }),
    });

    render(page);
    expect(screen.getByTestId("cloud-next").textContent).toBe("/funding?from=login");
  });
});