/**
 * In-memory "remember the rest I adjusted" store for the Today screen.
 *
 * When Ed changes a rest timer with its stepper and then starts it, the same
 * length is most likely wanted for the next set too. Today's rest buttons record
 * the started value here and read it back as the default the next time that
 * same rest is opened, and as the button's label.
 *
 * Deliberately NOT persisted: it lives for one page load (a "visit"), so a
 * reload goes back to the program's prescribed rest. Keys are built by
 * `restMemoryKey` so a value belongs to one date's one rest and never leaks
 * to another day's session.
 */
export interface RestMemory {
  /** The remembered seconds for `key`, or `fallbackSeconds` if none was recorded. */
  get(key: string, fallbackSeconds: number): number;
  /** Records `seconds` as the rest to use next time for `key`. */
  set(key: string, seconds: number): void;
}

/** Creates an empty memory. Today keeps one for the lifetime of the page; tests make their own. */
export function createRestMemory(): RestMemory {
  const remembered = new Map<string, number>();

  return {
    get: (key, fallbackSeconds) => remembered.get(key) ?? fallbackSeconds,
    set: (key, seconds) => {
      remembered.set(key, seconds);
    },
  };
}

/**
 * Builds the stable key for one rest button: the day, the block's position on
 * the screen and which rest in the block it is (an exercise id, or
 * "between-pairs" for a superset block's shared rest).
 */
export function restMemoryKey(date: string, blockPosition: number, restId: string): string {
  return `${date}|block ${blockPosition}|${restId}`;
}
