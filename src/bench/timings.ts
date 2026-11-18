/**
 * Small helpers for the startup-time benchmark: turn a list of measured run
 * times into a summary, and a summary into one printed line.
 *
 * This module deliberately has NO runtime imports, so a plain Node script
 * (`scripts/benchStartup.ts`) can load it with type stripping.
 *
 *   run times (ms) --summarizeTimings--> TimingSummary --formatTimingRow--> text line
 */

/** The figures reported for one benchmark size. All times are in milliseconds. */
export interface TimingSummary {
  /** How many runs were measured. */
  runs: number;
  /** The fastest run. */
  min: number;
  /** The middle run (mean of the two middle runs when the count is even). */
  median: number;
  /** The slowest run. */
  max: number;
}

/**
 * Summarizes a list of run times into count, min, median and max.
 * The median of an even count is the mean of the two middle values.
 * Throws on an empty list, because a benchmark with no runs is a bug.
 * Called by the benchmark script once per log size; does not change its input.
 */
export function summarizeTimings(milliseconds: number[]): TimingSummary {
  if (milliseconds.length === 0) {
    throw new Error("summarizeTimings needs at least one timing");
  }

  // Sort a copy so the caller's list keeps its run order.
  const sorted = [...milliseconds].sort((first, second) => first - second);
  const middleIndex = Math.floor(sorted.length / 2);

  const median =
    sorted.length % 2 === 1
      ? (sorted[middleIndex] as number)
      : ((sorted[middleIndex - 1] as number) + (sorted[middleIndex] as number)) / 2;

  return {
    runs: sorted.length,
    min: sorted[0] as number,
    median,
    max: sorted[sorted.length - 1] as number,
  };
}

/**
 * Formats one benchmark result as a single readable line, for example
 * `2 years  14,503 sets  median 380 ms  (min 330, max 450, 11 runs)`.
 * Times are rounded to whole milliseconds and the set count gets thousands
 * separators (always en-US style, so output does not depend on the machine's
 * locale). Called by the benchmark script after each size has been measured.
 */
export function formatTimingRow(label: string, setCount: number, summary: TimingSummary): string {
  const sets = `${setCount.toLocaleString("en-US")} sets`;
  const median = `median ${Math.round(summary.median)} ms`;
  const spread = `(min ${Math.round(summary.min)}, max ${Math.round(summary.max)}, ${summary.runs} runs)`;

  return `${label}  ${sets}  ${median}  ${spread}`;
}
