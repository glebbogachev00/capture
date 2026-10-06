/**
 * The iPhone app (ios/ in this repo) opens Capture in a native web view and
 * injects Capacitor's bridge into it. These helpers reach that app's
 * CaptureShell plugin; in a browser there is no bridge, and every caller keeps
 * to the web path.
 */
type Bridge = {
  isNativePlatform?: () => boolean;
  nativePromise?: (plugin: string, method: string, options?: object) => Promise<unknown>;
};

const bridge = (): Bridge | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as { Capacitor?: Bridge }).Capacitor;

export const inNativeShell = () =>
  Boolean(bridge()?.isNativePlatform?.() && bridge()?.nativePromise);

export function callShell<T = unknown>(method: string, options: object = {}): Promise<T> {
  const call = bridge()?.nativePromise;
  return call
    ? (call("CaptureShell", method, options) as Promise<T>)
    : Promise.reject(new Error("not in the iPhone app"));
}

/** Fired by the iPhone app each time it comes to the foreground. */
export const SHELL_ACTIVE_EVENT = "capture:shell-active";
