/**
 * Structured request logger. Logging policy (DESIGN.md §8): method, path, status and
 * duration only — never bodies, prompts, query strings, ids or headers.
 */
export interface RequestLog {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export const logRequest = (entry: RequestLog): void => {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...entry }));
};
