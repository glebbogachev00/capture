import { PLAYGROUND } from "./playground";

/** Public landing/SEO is independent of Cloud and browser sync.
 * Both public flags are build-time constants (direct NEXT_PUBLIC_ references).
 * Legacy playground builds always retain their public front door; with neither
 * flag set, self-hosted instances still open straight onto the board.
 */
export const PUBLIC_SITE = PLAYGROUND || process.env.NEXT_PUBLIC_PUBLIC_SITE === "1";
