/** Generates a short, time-prefixed unique id for a run message. */
export function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
}
