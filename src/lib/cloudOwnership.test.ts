import { expect, it, vi } from "vitest";
import { handleCloudBoardGet, handleCloudBoardPut } from "./cloudBoard";

it.each([undefined, "A", "anonymous"])("rejects old/mismatched board clients (%s) before any access", async (owner) => {
  const repository = { get: vi.fn(), create: vi.fn(), update: vi.fn() };
  const deps = { isEnabled: () => true, verifyIdentity: async () => ({ userId: "B" }), repository };
  for (const method of ["GET", "PUT"] as const) {
    const request = new Request("https://capture.test/api/cloud/board?userId=B", {
      method, headers: owner ? { "X-Capture-Owner": owner } : {},
      ...(method === "PUT" ? { body: '{"board":{"private":"A"}}' } : {}),
    });
    const response = await (method === "GET" ? handleCloudBoardGet : handleCloudBoardPut)(request, deps);
    expect(response.status).toBe(owner === undefined ? 428 : 412);
  }
  expect(repository.get).not.toHaveBeenCalled();
  expect(repository.create).not.toHaveBeenCalled();
  expect(repository.update).not.toHaveBeenCalled();
});
