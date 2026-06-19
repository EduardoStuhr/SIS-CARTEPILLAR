export function captureError(error: unknown, context?: string) {
  console.error("[ERROR_CAPTURE]", context || "", error);
}
