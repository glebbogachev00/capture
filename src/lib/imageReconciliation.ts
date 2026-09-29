import { stamp } from "./clock";
import { imgLoad, imgSave } from "./imgCache";
import { referencedImageIds, syncHubImage } from "./imgSync";
import { ownedFetch } from "./ownership";
import type { Board } from "./model";

export type SyncStatus = {
  ok: boolean;
  at: number;
  note?: string;
  imageSync?: "failed";
} | null;

export type ImageReconciliation = { ok: boolean; tooLarge: boolean };

export function imageSyncStatus(result: ImageReconciliation): SyncStatus {
  return result.ok
    ? { ok: true, at: stamp() }
    : {
        ok: false,
        at: stamp(),
        imageSync: "failed",
        note: result.tooLarge
          ? "An image is too large to sync — kept locally"
          : "Some images are still waiting to sync",
      };
}

/** Reconcile every referenced byte before the aggregate sync status can be
 * successful. Four bounded lanes preserve the existing transfer throughput. */
export async function reconcileBoardImages(
  board: Board,
  confirmedOnHub: Set<string>,
): Promise<ImageReconciliation> {
  const failures: { tooLarge: boolean }[] = [];
  const lane = async (ids: string[]) => {
    for (const id of ids) {
      try {
        const local = await imgLoad(id);
        if (!local) {
          const response = await ownedFetch(`/api/img/${id}`);
          if (!response.ok) {
            failures.push({ tooLarge: false });
            continue;
          }
          const { src } = (await response.json()) as { src?: string };
          if (!src) {
            failures.push({ tooLarge: false });
            continue;
          }
          await imgSave(id, src);
          confirmedOnHub.add(id);
          continue;
        }
        if (confirmedOnHub.has(id)) continue;
        const result = await syncHubImage(id, local);
        if (result.ok) confirmedOnHub.add(id);
        else failures.push({ tooLarge: result.reason === "too_large" });
      } catch {
        failures.push({ tooLarge: false });
      }
    }
  };
  const ids = referencedImageIds(board);
  const lanes = 4;
  await Promise.all(Array.from({ length: lanes }, (_, index) =>
    lane(ids.filter((_, itemIndex) => itemIndex % lanes === index))
  ));
  return {
    ok: failures.length === 0,
    tooLarge: failures.some((failure) => failure.tooLarge),
  };
}
