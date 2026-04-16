export type Logger = {
  debug: (msg: string, extra?: unknown) => void;
  info: (msg: string, extra?: unknown) => void;
  warn: (msg: string, extra?: unknown) => void;
  error: (msg: string, extra?: unknown) => void;
};

export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export function consoleLogger(prefix = '[cache-mesh]'): Logger {
  return {
    debug: (m, e) => console.debug(prefix, m, e ?? ''),
    info: (m, e) => console.info(prefix, m, e ?? ''),
    warn: (m, e) => console.warn(prefix, m, e ?? ''),
    error: (m, e) => console.error(prefix, m, e ?? ''),
  };
}
