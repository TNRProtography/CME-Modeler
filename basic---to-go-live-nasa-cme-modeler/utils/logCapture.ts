// --- START OF FILE src/utils/logCapture.ts ---
/**
 * Log capture — monkey-patches console methods at import time so logs
 * accumulate from the moment the app starts. The debug panel reads from
 * this buffer; nothing else in the app needs to change.
 */

export interface LogEntry {
  id: number;
  ts: number;           // Date.now()
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
}

const MAX_ENTRIES = 300;
const entries: LogEntry[] = [];
let counter = 0;

function serialize(args: unknown[]): string {
  return args
    .map(a => {
      if (a === null) return 'null';
      if (a === undefined) return 'undefined';
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(' ');
}

function capture(level: LogEntry['level'], original: (...args: unknown[]) => void) {
  return (...args: unknown[]) => {
    original.apply(console, args);
    entries.push({ id: counter++, ts: Date.now(), level, message: serialize(args) });
    if (entries.length > MAX_ENTRIES) entries.shift();
  };
}

// Patch once at module load — safe to call multiple times (guard below)
let patched = false;
export function initLogCapture() {
  if (patched || typeof window === 'undefined') return;
  patched = true;
  console.log  = capture('log',   console.log.bind(console));
  console.info = capture('info',  console.info.bind(console));
  console.warn = capture('warn',  console.warn.bind(console));
  console.error= capture('error', console.error.bind(console));
}

export function getLogs(): LogEntry[] {
  return [...entries];
}

export function clearLogs() {
  entries.length = 0;
}
// --- END OF FILE src/utils/logCapture.ts ---