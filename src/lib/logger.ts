/**
 * Minimal structured logger — outputs newline-delimited JSON to
 * stdout / stderr. Swap for a proper library (e.g. Pino) if needed.
 */

type Level = "info" | "warn" | "error";

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info:  (message: string, context?: Record<string, unknown>) => emit("info",  message, context),
  warn:  (message: string, context?: Record<string, unknown>) => emit("warn",  message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),
};
