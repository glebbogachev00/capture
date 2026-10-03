import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownerPrecondition } from "./ownerPrecondition";
import { deletePublicThread, getPublicThreads, postPublicThread, type PublicThreadsDeps } from "./publicThreadRoutes.server";
import { filePublicThreadStore, publicThreadMode } from "./publicThreadStore.server";

const KEY = "b".repeat(64);
const PRIVATE = "PRIVATE NOTE the owner did not tick";
const snapshot = (title = "Does the product earn the story?") => ({
  title,
  intro: "An application of an idea from a public interview.",
  byline: "Gleb",
  fragments: [{ text: "## The source\n\nHe recalls selling motorcycle accessories." }, { text: "## Try it\n\nChoose one sentence." }],
  sourceKey: KEY,
});

let dir: string;
let tokens = 0;
const deps = (): PublicThreadsDeps => {
  const store = filePublicThreadStore(dir);
  return {
    origin: "https://cloud.example",
    newToken: () => `snap-${String(tokens++).padStart(2, "0")}${"a".repeat(14)}`.replace(/\d/g, (d) => "abcdefghij"[Number(d)]),
    // A signed-in user is whoever the test's cookie says; nobody without it.
    async authorize(request) {
      const owner = request.headers.get("x-test-user");
      if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
      return ownerPrecondition(request, owner) ?? { owner, store };
    },
    async whoami(request) { return request.headers.get("x-test-user"); },
  };
};
const as = (user: string | null, init: RequestInit & { url?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (user) { headers.set("x-test-user", user); headers.set("X-Capture-Owner", user); }
  return new Request(init.url ?? "https://cloud.example/api/cloud/public-threads", { ...init, headers });
};
const publish = (user: string | null, body: unknown) =>
  postPublicThread(as(user, { method: "POST", body: JSON.stringify(body) }), deps());

beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "capture-public-")); tokens = 0; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe("owner endpoints", () => {
  it("refuse a signed-out caller and a caller whose owner header disagrees", async () => {
    expect((await publish(null, { snapshot: snapshot() })).status).toBe(401);
    const mismatched = new Request("https://cloud.example/api/cloud/public-threads", {
      method: "POST", body: JSON.stringify({ snapshot: snapshot() }), headers: { "x-test-user": "alice", "X-Capture-Owner": "mallory" },
    });
    expect((await postPublicThread(mismatched, deps())).status).toBe(412);
    expect(readFileSafe()).toBe("");
  });

  it("publish exactly the reviewed snapshot and nothing that came with it", async () => {
    const response = await publish("alice", {
      snapshot: { ...snapshot(), boardId: "b1", summary: PRIVATE, fragments: [...snapshot().fragments.map((f) => ({ ...f, id: "f", at: 1, imgs: ["p"] }))] },
      extra: PRIVATE,
    });
    expect(response.status).toBe(201);
    const { thread, url } = await response.json();
    expect(url).toBe(`https://cloud.example/t/${thread.token}`);
    const stored = readFileSafe();
    expect(stored).not.toContain(PRIVATE);
    expect(stored).not.toMatch(/"(boardId|summary|imgs|at|id)"/);
    const read = await filePublicThreadStore(dir).read(thread.token);
    expect(read).toEqual({ ...snapshot(), sourceKey: undefined, token: thread.token, publishedAt: read!.publishedAt, updatedAt: read!.updatedAt });
    expect(Object.keys(read!)).not.toContain("sourceKey");
  });

  it("only the owner can update or unpublish; another user changes nothing", async () => {
    const { thread } = await (await publish("alice", { snapshot: snapshot() })).json();
    const changed = { ...snapshot("Mallory's title"), fragments: [{ text: "defaced" }] };
    expect((await publish("mallory", { snapshot: changed, replace: thread.token })).status).toBe(404);
    expect((await deletePublicThread(as("mallory", { method: "DELETE", url: `https://cloud.example/api/cloud/public-threads?token=${thread.token}` }), deps())).status).toBe(404);
    expect((await filePublicThreadStore(dir).read(thread.token))?.title).toBe("Does the product earn the story?");
    const mine = await (await getPublicThreads(as("mallory"), deps())).json();
    expect(mine.threads).toEqual([]);
  });

  it("an explicit update changes the snapshot and keeps the link; private edits never do", async () => {
    const input = snapshot();
    const { thread } = await (await publish("alice", { snapshot: input })).json();
    input.fragments.push({ text: PRIVATE }); // the private thread grows after publishing
    expect(JSON.stringify(await filePublicThreadStore(dir).read(thread.token))).not.toContain(PRIVATE);

    const update = await publish("alice", { snapshot: { ...snapshot("Updated title"), fragments: [{ text: "Only this now" }] }, replace: thread.token });
    expect(update.status).toBe(200);
    const read = await filePublicThreadStore(dir).read(thread.token);
    expect(read).toMatchObject({ token: thread.token, title: "Updated title", fragments: [{ text: "Only this now" }] });
    expect(read!.publishedAt <= read!.updatedAt).toBe(true);
  });

  it("lists the owner's snapshots with links, for update and unpublish", async () => {
    await publish("alice", { snapshot: snapshot() });
    const body = await (await getPublicThreads(as("alice"), deps())).json();
    expect(body.owner).toBe("alice");
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0]).toMatchObject({ sourceKey: KEY, url: expect.stringMatching(/^https:\/\/cloud\.example\/t\//) });
  });
});

describe("public reading", () => {
  beforeEach(() => {
    vi.stubEnv("CAPTURE_CLOUD", "");
    vi.stubEnv("CAPTURE_PUBLISH_PREVIEW_DIR", dir);
  });

  it("is off unless Cloud or the development preview is configured, and never in a production preview", () => {
    expect(publicThreadMode()).toBe("preview");
    expect(publicThreadMode({ NODE_ENV: "production", CAPTURE_PUBLISH_PREVIEW_DIR: dir })).toBe("off");
    expect(publicThreadMode({})).toBe("off");
  });

  it("serves the selected content in the first HTML and as Markdown, then nothing after unpublishing", async () => {
    const { thread } = await (await publish("alice", { snapshot: snapshot() })).json();
    const { default: Page } = await import("@/app/t/[token]/page");
    const { GET } = await import("@/app/t/[token]/context.md/route");

    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ token: thread.token }) }));
    expect(html).toContain("Does the product earn the story?");
    expect(html).toContain("He recalls selling motorcycle accessories.");
    expect(html).toContain("Shared snapshot");
    expect(html).not.toContain(KEY);

    const text = await GET(new Request("https://cloud.example/x"), { params: Promise.resolve({ token: thread.token }) });
    expect(text.status).toBe(200);
    expect(text.headers.get("content-type")).toContain("text/markdown");
    expect(text.headers.get("cache-control")).toContain("no-store");
    const markdown = await text.text();
    expect(markdown).toContain("## The source\n\nHe recalls selling motorcycle accessories.");
    expect(markdown).not.toContain(KEY);

    await deletePublicThread(as("alice", { method: "DELETE", url: `https://cloud.example/api/cloud/public-threads?token=${thread.token}` }), deps());
    expect((await GET(new Request("https://cloud.example/x"), { params: Promise.resolve({ token: thread.token }) })).status).toBe(404);
    await expect(Page({ params: Promise.resolve({ token: thread.token }) })).rejects.toThrow();
  });

  it("does not look anything up for a malformed token", async () => {
    const { GET } = await import("@/app/t/[token]/context.md/route");
    expect((await GET(new Request("https://cloud.example/x"), { params: Promise.resolve({ token: "../public-threads.json" }) })).status).toBe(404);
  });
});

function readFileSafe(): string {
  try { return readFileSync(path.join(dir, "public-threads.json"), "utf8"); } catch { return ""; }
}
