import { LOG_LEVEL } from "../types.ts";

export class Logger {
  logLevel: number;
  constructor(logLevel: LOG_LEVEL) {
    this.logLevel = logLevel;
  }
  getTimestamp() {
    let [date, time] = new Date().toJSON().split("T");
    date = date.replaceAll("-", "/");
    time = time.split(".")[0];
    return `[${date} - ${time}]`;
  }

  // deno-lint-ignore no-explicit-any
  debug(...messages: any) {
    if (this.logLevel > LOG_LEVEL.INFO) return;
    console.info(this.getTimestamp() + "info:", ...messages);
  }

  // deno-lint-ignore no-explicit-any
  info(...messages: any) {
    if (this.logLevel > LOG_LEVEL.INFO) return;
    console.info(this.getTimestamp() + "info:", ...messages);
  }

  // deno-lint-ignore no-explicit-any
  log(...messages: any) {
    if (this.logLevel > LOG_LEVEL.INFO) return;
    console.log(this.getTimestamp() + "log:", ...messages);
  }

  // deno-lint-ignore no-explicit-any
  warn(...messages: any) {
    if (this.logLevel > LOG_LEVEL.WARN) return;
    console.warn(this.getTimestamp() + " warn:", ...messages);
  }

  // deno-lint-ignore no-explicit-any
  error(...messages: any) {
    if (this.logLevel > LOG_LEVEL.ERROR) return;
    console.error(this.getTimestamp() + " error:", ...messages);
  }
}
