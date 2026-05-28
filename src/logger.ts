import { config } from "./config.js";

const levels = { debug: 10, info: 20, warn: 30, error: 40 };

function enabled(level: keyof typeof levels): boolean {
  return levels[level] >= levels[config.logLevel];
}

export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (enabled("debug")) console.log(message, ...args);
  },
  info(message: string, ...args: unknown[]): void {
    if (enabled("info")) console.log(message, ...args);
  },
  warn(message: string, ...args: unknown[]): void {
    if (enabled("warn")) console.warn(message, ...args);
  },
  error(message: string | unknown, ...args: unknown[]): void {
    if (enabled("error")) console.error(message, ...args);
  },
};
