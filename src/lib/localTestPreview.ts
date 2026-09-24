/**
 * Browser half of the disposable Preview boundary. When enabled at build
 * time, Capture keeps its board and image bytes on this browser only and
 * never contacts the shared self-hosted hub.
 */
export const LOCAL_TEST_PREVIEW =
  process.env.NEXT_PUBLIC_CAPTURE_LOCAL_TEST_PREVIEW === "1";