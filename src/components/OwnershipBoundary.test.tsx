// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync, existsSync } from "node:fs";

it("scopes the board's existing sans stack to every ownership boundary state", () => {
  const cssPath = `${process.cwd()}/src/components/OwnershipBoundary.module.css`;
  expect(existsSync(cssPath)).toBe(true);
  const css = readFileSync(cssPath, "utf8");
  const globals = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8");
  const boardStack = globals.match(/\.capture-root\s*\{[^}]*font-family:\s*([^;]+);/)![1];
  expect(css).toContain(`font-family: ${boardStack};`);
  const source = readFileSync(`${process.cwd()}/src/components/OwnershipBoundary.tsx`, "utf8");
  const fallback = readFileSync(`${process.cwd()}/src/components/OwnershipFallback.tsx`, "utf8");
  expect(source).toContain('import styles from "./OwnershipBoundary.module.css"');
  expect(fallback).toContain('import styles from "./OwnershipBoundary.module.css"');
  expect(fallback).toContain('styles.root');
  expect(source.match(/<OwnershipFallback/g)).toHaveLength(3);
  expect(source).toContain('return <div className={styles.root}>');
  expect(css).toContain('env(safe-area-inset-top');
  expect(css).toContain('prefers-reduced-motion: reduce');
  expect(css).toContain(':focus-visible');
});
import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStorage } from "@/lib/storage";
import { OwnershipLifetime } from "@/lib/ownership";
import { EMPTY, KEY } from "@/lib/model";
vi.doMock("react", () => React);

beforeEach(() => { localStorage.clear(); vi.resetModules(); vi.stubGlobal("React", React); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("brands pending and failed verification without mounting the board or inventing progress", async () => {
  let fail!: (reason: Error) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((_, reject) => { fail = reject; })));
  const { OwnershipBoundary } = await import("./OwnershipBoundary");
  const child = vi.fn(() => <p>PRIVATE BOARD</p>);
  render(<OwnershipBoundary cloud>{React.createElement(child)}</OwnershipBoundary>);
  expect(screen.getByText("capture")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Opening Capture" })).toBeTruthy();
  expect(screen.getByText("Verifying this device’s account…")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(child).not.toHaveBeenCalled();
  await act(async () => { fail(new TypeError("Load failed")); });
  expect(screen.getByRole("heading", { name: "Let’s verify your account" })).toBeTruthy();
  expect(screen.getByText("Your account could not be verified. Your device data has not been changed.")).toBeTruthy();
  const recovery = screen.getByRole("link", { name: "Reload and verify" });
  expect(recovery.getAttribute("href")).toBe("/app");
  recovery.focus();
  expect(document.activeElement).toBe(recovery);
  expect(screen.queryByText("Verifying this device’s account…")).toBeNull();
  expect(child).not.toHaveBeenCalled();
});

it("verifies identity before any hydration, then synchronously hides account content and portals on transition", async () => {
  const storage = createStorage(new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 }));
  await storage.set(KEY, JSON.stringify({ ...EMPTY, actions: [{ id: "a", text: "A PRIVATE", at: Date.now() }] }));
  let verify!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (url) => String(url) === "/api/cloud/identity"
    ? new Promise<Response>(resolve => { verify = resolve; }) : new Response(null, { status: 503 })));
  const opened = vi.spyOn(indexedDB, "open");
  const { OwnershipBoundary } = await import("./OwnershipBoundary");
  const { ConfirmDelete } = await import("./ConfirmDelete");
  const { useBoard } = await import("@/hooks/useBoard");
  function Probe() {
    const board = useBoard(Date.now());
    return <><pre>{JSON.stringify(board.data)}</pre><ConfirmDelete title="A PRIVATE PORTAL" onCancel={() => {}} onConfirm={() => {}} /></>;
  }
  render(<OwnershipBoundary cloud><Probe /></OwnershipBoundary>);
  expect(opened).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain("A PRIVATE");
  await act(async () => { verify(Response.json({ owner: "A", expiresAt: Date.now() + 60000 })); });
  await waitFor(() => expect(document.body.textContent).toContain('"A PRIVATE"'));
  expect(screen.getByText("A PRIVATE PORTAL")).toBeTruthy();
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: "capture:auth-transition" })));
  expect(document.body.textContent).not.toContain("A PRIVATE");
  expect(screen.getByText(/session ended or changed/)).toBeTruthy();
  expect(await storage.get(KEY)).toContain("A PRIVATE");
});

it("failed logout shows retry, survives fresh boundary reload, and never mounts the old account", async () => {
  const location = { href: "/app" };
  vi.stubGlobal("location", location);
  let logoutResponse = 502;
  const network = vi.fn(async (url) => String(url) === "/api/logout"
    ? new Response(null, { status: logoutResponse })
    : Response.json({ owner: "A", expiresAt: Date.now() + 60000 }));
  vi.stubGlobal("fetch", network);
  const ownership = await import("@/lib/ownership");
  const { OwnershipBoundary } = await import("./OwnershipBoundary");
  const first = render(<OwnershipBoundary cloud><p>A PRIVATE</p></OwnershipBoundary>);
  await screen.findByText("A PRIVATE");
  await act(async () => { await ownership.logoutAndNavigate(); });
  expect(document.body.textContent).not.toContain("A PRIVATE");
  expect(screen.getByText(/Logout has not completed/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry logout" })).toBeTruthy();
  first.unmount();
  vi.resetModules();
  const { OwnershipBoundary: Fresh } = await import("./OwnershipBoundary");
  const child = vi.fn(() => <p>A PRIVATE</p>);
  render(<Fresh cloud>{React.createElement(child)}</Fresh>);
  await screen.findByRole("button", { name: "Retry logout" });
  expect(child).not.toHaveBeenCalled();
  expect(location.href).toBe("/app");
  logoutResponse = 200;
  fireEvent.click(screen.getByRole("button", { name: "Retry logout" }));
  await waitFor(() => expect(location.href).toBe("/login"));
  expect(localStorage.getItem(ownership.LOGOUT_PENDING_KEY)).toBeNull();
  expect(child).not.toHaveBeenCalled();
});

it.each(["capture:auth-transition", "capture:logout-pending"])("does not hydrate a stale verified identity if %s changes during bootstrap", async (key) => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const opened = vi.spyOn(indexedDB, "open");
  const { OwnershipBoundary } = await import("./OwnershipBoundary");
  const child = vi.fn(() => <p>A PRIVATE</p>);
  render(<OwnershipBoundary cloud>{React.createElement(child)}</OwnershipBoundary>);
  act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
  await act(async () => { finish(Response.json({ owner: "A", expiresAt: Date.now() + 60000 })); });
  expect(child).not.toHaveBeenCalled();
  expect(opened).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain("A PRIVATE");
});

it("opens an opted-in offline local board without mounting any personal network work", async () => {
  const ownership = await import("@/lib/ownership");
  new ownership.OwnershipLifetime({ owner: "offline-ui", expiresAt: Date.now() + 60000 }).keepOffline(true);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const network = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
  vi.stubGlobal("fetch", network);
  const { OwnershipBoundary } = await import("./OwnershipBoundary");
  const { ConfirmDelete } = await import("./ConfirmDelete");
  render(<OwnershipBoundary cloud><p>LOCAL BOARD</p><ConfirmDelete title="Delete offline note" onConfirm={() => {}} onCancel={() => {}} /></OwnershipBoundary>);
  await screen.findByText("LOCAL BOARD");
  expect(screen.getByText("Delete offline note")).toBeTruthy();
  const status = screen.getByRole("status");
  expect(status.textContent).toContain("Local changes are not synced. AI is unavailable");
  const styles = (await import("./OwnershipBoundary.module.css")).default;
  expect(status.className).toBe(styles.offlineStatus);
  expect(status.hasAttribute("hidden")).toBe(false);
  expect(status.hasAttribute("aria-hidden")).toBe(false);
  // jsdom has no layout: pin the local clipping contract; the browser fixture
  // verifies the rendered header has no banner or extra vertical space.
  const css = readFileSync(`${process.cwd()}/src/components/OwnershipBoundary.module.css`, "utf8");
  const rule = css.match(/\.offlineStatus\s*\{([^}]+)\}/)?.[1] ?? "";
  for (const declaration of ["position: absolute", "width: 1px", "height: 1px", "padding: 0", "margin: -1px", "overflow: hidden", "clip-path: inset(50%)", "white-space: nowrap", "border: 0"]) {
    expect(rule).toContain(declaration);
  }
  expect(rule).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  expect(() => ownership.getDocumentLifetime().assertOnline()).toThrow();
  expect(screen.getByText("LOCAL BOARD").closest("[hidden], [inert]")).toBeNull();
  expect(network.mock.calls).toHaveLength(1);
});

it("does not restart slow bootstrap on child rerenders or focus, and ignores StrictMode's abandoned response", async () => {
  const responses: ((response: Response) => void)[] = [];
  const network = vi.fn(() => new Promise<Response>(resolve => { responses.push(resolve); }));
  vi.stubGlobal("fetch", network);
  const { OwnershipBoundary } = await import("./OwnershipBoundary");
  const child = vi.fn(() => <p>VERIFIED CHILD</p>);
  const view = render(<React.StrictMode><OwnershipBoundary cloud>{React.createElement(child)}</OwnershipBoundary></React.StrictMode>);
  expect(network).toHaveBeenCalledTimes(2);
  view.rerender(<React.StrictMode><OwnershipBoundary cloud>{React.createElement(child)}</OwnershipBoundary></React.StrictMode>);
  act(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("pageshow")); });
  expect(network).toHaveBeenCalledTimes(2);
  expect(child).not.toHaveBeenCalled();
  await act(async () => { responses[0](Response.json({ owner: "abandoned", expiresAt: Date.now() + 60000 })); });
  expect(child).not.toHaveBeenCalled();
  await act(async () => { responses[1](Response.json({ owner: "current", expiresAt: Date.now() + 60000 })); });
  await screen.findByText("VERIFIED CHILD");
  const { getDocumentLifetime } = await import("@/lib/ownership");
  expect(getDocumentLifetime().owner).toBe("current");
  expect(screen.queryByText(/account could not be verified/)).toBeNull();
});

it("two minutes of slow successful polling keeps the verified board visible without remounting", async () => {
  const pending: ((response: Response) => void)[] = [];
  const network = vi.fn(() => new Promise<Response>(resolve => { pending.push(resolve); }));
  vi.stubGlobal("fetch", network);
  const { OwnershipBoundary } = await import("./OwnershipBoundary");
  const mounted = vi.fn();
  const unmounted = vi.fn();
  function Child() { React.useEffect(() => { mounted(); return unmounted; }, []); return <p>VERIFIED CHILD</p>; }
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const view = render(<OwnershipBoundary cloud><Child /></OwnershipBoundary>);
  await act(async () => { pending.shift()!(Response.json({ owner: "poll-account", expiresAt: Date.now() + 3_600_000 })); });
  await screen.findByText("VERIFIED CHILD");
  try {
    for (let cycle = 0; cycle < 4; cycle++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(screen.queryByText("Verifying your account…")).toBeNull();
      expect(screen.getByText("VERIFIED CHILD").closest("[hidden]")).toBeNull();
      await act(async () => { pending.shift()!(Response.json({ owner: "poll-account", expiresAt: Date.now() + 3_600_000 })); });
      expect(screen.queryByText("Verifying your account…")).toBeNull();
      expect(screen.getByText("VERIFIED CHILD").closest("[hidden]")).toBeNull();
      expect(screen.queryByText(/account could not be verified/)).toBeNull();
    }
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledTimes(5);
  } finally { view.unmount(); vi.useRealTimers(); }
});

it.each(["focus", "pageshow", "online"])("visible %s revalidation preserves typing and focus while holding requests and disclosures", async (event) => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const ownership = await import("@/lib/ownership");
  const { OwnershipBoundary } = await import("./OwnershipBoundary");
  const mounted = vi.fn();
  const unmounted = vi.fn();
  function Child() {
    React.useEffect(() => { mounted(); return unmounted; }, []);
    const [text, setText] = React.useState("Keep my place");
    return <input aria-label="Draft" value={text} onChange={e => setText(e.target.value)} />;
  }
  render(<OwnershipBoundary cloud><Child /></OwnershipBoundary>);
  expect(screen.queryByRole("textbox")).toBeNull();
  await act(async () => { finish(Response.json({ owner: "A", expiresAt: Date.now() + 60000 })); });
  const draft = await screen.findByRole("textbox") as HTMLInputElement;
  draft.focus();
  draft.setSelectionRange(5, 5);
  act(() => window.dispatchEvent(new Event(event)));
  expect(draft.closest("[hidden]")).toBeNull();
  expect(draft.closest("[inert]")).toBeNull();
  expect(document.activeElement).toBe(draft);
  expect(draft.selectionStart).toBe(5);
  fireEvent.change(draft, { target: { value: "Keep typing during verification" } });
  expect(draft.value).toBe("Keep typing during verification");
  expect(screen.queryByRole("main")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  const life = ownership.getDocumentLifetime();
  expect(() => life.assertDisclosure()).toThrow("verification pending");
  const network = vi.fn(async () => Response.json({}));
  const queued = life.request("/api/sync", {}, network);
  expect(network).not.toHaveBeenCalled();
  await act(async () => { finish(Response.json({ owner: "A", expiresAt: Date.now() + 60000 })); await queued; });
  expect(network).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox")).toBe(draft);
  expect(draft.closest("[inert]")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new Event(event)));
  await act(async () => { finish(Response.json({ owner: "B", expiresAt: Date.now() + 60000 })); });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(life.snapshot()).toBe("revoked");
});

it("a persisted pageshow cannot retain a view even if visibilitychange was missed", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const { OwnershipBoundary } = await import("./OwnershipBoundary");
  render(<OwnershipBoundary cloud><p>BFCACHE BOARD</p></OwnershipBoundary>);
  await act(async () => { finish(Response.json({ owner: "A", expiresAt: Date.now() + 60000 })); });
  await screen.findByText("BFCACHE BOARD");
  act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  expect(screen.getByText("BFCACHE BOARD").closest("[hidden]")).not.toBeNull();
  await act(async () => { finish(Response.json({ owner: "A", expiresAt: Date.now() + 60000 })); });
  expect(screen.getByText("BFCACHE BOARD").closest("[hidden]")).toBeNull();
});

it.each([false, true])("a hidden/resumed view stays hidden until verification (finish while hidden: %s)", async (finishHidden) => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const ownership = await import("@/lib/ownership");
  const { OwnershipBoundary } = await import("./OwnershipBoundary");
  const { ConfirmDelete } = await import("./ConfirmDelete");
  render(<OwnershipBoundary cloud><p>RESUME BOARD</p><ConfirmDelete title="RESUME PORTAL" onCancel={() => {}} onConfirm={() => {}} /></OwnershipBoundary>);
  await act(async () => { finish(Response.json({ owner: "A", expiresAt: Date.now() + 60000 })); });
  await screen.findByText("RESUME BOARD");
  const visibility = vi.spyOn(document, "visibilityState", "get");
  const life = ownership.getDocumentLifetime();
  act(() => window.dispatchEvent(new Event("focus")));
  expect(screen.getByText("RESUME BOARD").closest("[hidden]")).toBeNull();
  act(() => { visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange")); });
  expect(screen.getByText("RESUME BOARD").closest("[hidden]")).not.toBeNull();
  expect(screen.queryByText("RESUME PORTAL")).toBeNull();
  if (finishHidden) {
    await act(async () => { finish(Response.json({ owner: "A", expiresAt: Date.now() + 60000 })); });
    expect(screen.getByText("RESUME BOARD").closest("[hidden]")).not.toBeNull();
  }
  act(() => {
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
  });
  expect(screen.getByText("RESUME BOARD").closest("[hidden]")).not.toBeNull();
  expect(() => life.assertDisclosure()).toThrow("verification pending");
  expect(screen.getByText("Verifying your account…")).toBeTruthy();
  await act(async () => { finish(Response.json({ owner: "A", expiresAt: Date.now() + 60000 })); });
  expect(screen.getByText("RESUME BOARD").closest("[hidden]")).toBeNull();
  expect(screen.getByText("RESUME PORTAL")).toBeTruthy();
});

it.each(["owner-change", "http-error", "malformed", "transport-error", "expiry", "logout", "cross-tab", "focus", "pageshow", "online", "hidden"])(
  "a pending background poll fails closed on %s, including portals and disclosure continuations",
  async (trigger) => {
    let finish!: (response: Response) => void;
    let reject!: (error: Error) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve, fail) => { finish = resolve; reject = fail; })));
    const ownership = await import("@/lib/ownership");
    const { OwnershipBoundary } = await import("./OwnershipBoundary");
    const { ConfirmDelete } = await import("./ConfirmDelete");
    vi.useFakeTimers();
    const view = render(<OwnershipBoundary cloud><p>PRIVATE BOARD</p><ConfirmDelete title="PRIVATE PORTAL" onCancel={() => {}} onConfirm={() => {}} /></OwnershipBoundary>);
    try {
      await act(async () => { finish(Response.json({ owner: "A", expiresAt: Date.now() + 60000 })); });
      const life = ownership.getDocumentLifetime();
      // Begin readback before the poll; a request started during it must wait.
      let bodyDone!: (body: object) => void;
      const raw = Response.json({});
      raw.json = () => new Promise(resolve => { bodyDone = resolve; });
      const response = await life.request("/api/sync", {}, async () => raw);
      const body = response.json();
      const rejectedBody = expect(body).rejects.toThrow();
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      expect(screen.queryByText("Verifying your account…")).toBeNull();
      expect(screen.getByText("PRIVATE BOARD").closest("[hidden]")).toBeNull();
      expect(screen.getByText("PRIVATE PORTAL")).toBeTruthy();
      expect(() => life.assertDisclosure()).toThrow("verification pending");
      // A foreground signal during this same pending request retains the view,
      // but all failure paths below must still remove it synchronously.
      act(() => window.dispatchEvent(new Event("focus")));
      expect(screen.getByText("PRIVATE BOARD").closest("[hidden]")).toBeNull();
      expect(screen.getByText("PRIVATE BOARD").closest("[inert]")).toBeNull();
      if (trigger === "owner-change" || trigger === "http-error" || trigger === "malformed" || trigger === "transport-error") {
        await act(async () => {
          if (trigger === "transport-error") reject(new TypeError("Load failed"));
          else finish(trigger === "http-error" ? new Response(null, { status: 503 })
            : trigger === "malformed" ? new Response("not json")
            : Response.json({ owner: "B", expiresAt: Date.now() + 60000 }));
        });
      } else if (trigger === "expiry") {
        await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      } else {
        act(() => {
          if (trigger === "logout") ownership.announceAuthTransition();
          else if (trigger === "cross-tab") window.dispatchEvent(new StorageEvent("storage", { key: "sb-project-auth-token" }));
          else if (trigger === "hidden") {
            vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
            document.dispatchEvent(new Event("visibilitychange"));
          } else window.dispatchEvent(new Event(trigger));
        });
      }
      const foreground = ["focus", "pageshow", "online", "hidden"].includes(trigger);
      expect(life.snapshot()).toBe(trigger === "hidden" ? "checking" : foreground ? "active" : "revoked");
      expect(() => life.assertDisclosure()).toThrow();
      if (foreground && trigger !== "hidden") expect(screen.getByText("PRIVATE PORTAL")).toBeTruthy();
      else expect(screen.queryByText("PRIVATE PORTAL")).toBeNull();
      if (trigger === "hidden") expect(screen.getByText("PRIVATE BOARD").closest("[hidden]")).not.toBeNull();
      else if (foreground) {
        expect(screen.getByText("PRIVATE BOARD").closest("[hidden]")).toBeNull();
        expect(screen.getByText("PRIVATE BOARD").closest("[inert]")).toBeNull();
      } else expect(screen.queryByText("PRIVATE BOARD")).toBeNull();
      // Foreground checks keep work waiting. A later revocation must release it
      // as a rejection, never as the private body. A stale poll cannot revive it.
      act(() => { life.revoke(); });
      await act(async () => {
        bodyDone({ private: "A" });
        finish(Response.json({ owner: "A", expiresAt: Date.now() + 60000 }));
      });
      await rejectedBody;
      expect(life.snapshot()).toBe("revoked");
      expect(screen.queryByText("PRIVATE BOARD")).toBeNull();
    } finally { view.unmount(); vi.useRealTimers(); }
  },
);

it.each(["body-abort", "body-invalid-json", "expired-body", "transport-abort", "transport-typeerror"])(
  "fails closed at the real bootstrap for %s even without an HTTP error, and does not retry on focus",
  async (failure) => {
    const network = vi.fn(async () => {
      if (failure === "transport-abort") throw new DOMException("Load cancelled", "AbortError");
      if (failure === "transport-typeerror") throw new TypeError("Load failed");
      const response = failure === "body-invalid-json" ? new Response("<html>interrupted</html>", { status: 200 })
        : Response.json({ owner: "A", expiresAt: Date.now() + (failure === "expired-body" ? -1 : 60000) });
      if (failure === "body-abort") vi.spyOn(response, "json").mockRejectedValue(new DOMException("Load cancelled", "AbortError"));
      expect(response.status).toBe(200);
      return response;
    });
    vi.stubGlobal("fetch", network);
    const opened = vi.spyOn(indexedDB, "open");
    const { OwnershipBoundary } = await import("./OwnershipBoundary");
    const child = vi.fn(() => <p>UNVERIFIED BOARD</p>);
    render(<OwnershipBoundary cloud>{React.createElement(child)}</OwnershipBoundary>);
    await screen.findByText(/account could not be verified/);
    act(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("pageshow")); window.dispatchEvent(new Event("online")); });
    await act(async () => {});
    expect(network).toHaveBeenCalledTimes(1);
    expect(child).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
  },
);

it.each([503, 401, 404])("identity failure %s never becomes an anonymous/self-hosted board", async (status) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));
  const opened = vi.spyOn(indexedDB, "open");
  const { OwnershipBoundary } = await import("./OwnershipBoundary");
  const child = vi.fn(() => <p>UNVERIFIED BOARD</p>);
  render(<OwnershipBoundary cloud>{React.createElement(child)}</OwnershipBoundary>);
  await screen.findByText(/account could not be verified/);
  expect(child).not.toHaveBeenCalled();
  expect(opened).not.toHaveBeenCalled();
});
