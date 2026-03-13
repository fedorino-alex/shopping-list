const LEVELS = { debug: 0, info: 1, error: 2 } as const;
type LogLevel = keyof typeof LEVELS;

const currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel | undefined) ?? "debug";

function log(level: LogLevel, tag: string, message: string, data?: unknown): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  const timestamp = new Date().toISOString();
  const prefix = `${timestamp} [${level.toUpperCase().padEnd(5)}] [${tag}]`;

  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

export const logger = {
  debug: (tag: string, message: string, data?: unknown): void =>
    log("debug", tag, message, data),
  info: (tag: string, message: string, data?: unknown): void =>
    log("info", tag, message, data),
  error: (tag: string, message: string, data?: unknown): void =>
    log("error", tag, message, data),
};
