/**
 * Where Today scrolls to when Ed comes back from a set (PR 34 of PLAN.md).
 * Without this, every return from the log screen or an EMOM timer landed at
 * the top of the day and Ed had to scroll to the exercise he was on.
 *
 *   log screen (Ed worked on row K) ──rememberRow(K)──▶ Today renders
 *        ──rowToScrollTo(rows, K)──▶ scroll to the first unfinished row after K,
 *        else the first unfinished row of the day, else stay at the top
 *
 * Rows are identified by `todayRowKey`, which both the Today row (data-row-key)
 * and the log route use, so the same exercise always gets the same key.
 */

/** One Today row as the scroll decision sees it. */
export interface TodayRowState {
  /** `todayRowKey` of the row. */
  key: string;

  /** True when every set of the row is logged or skipped (its progress reads "✓"). */
  isComplete: boolean;
}

/**
 * The key of a Today row: its block position, exercise, and on a combined date
 * its day (two days share a date, so the day tells their rows apart).
 * `day` is undefined on a normal date.
 */
export function todayRowKey(blockPosition: number, exerciseId: string, day: number | undefined): string {
  return `${blockPosition}:${exerciseId}:${day ?? ""}`;
}

/**
 * The index of the row to scroll to after leaving the row `workedKey`: the
 * first unfinished row after it in the day's order, else the first unfinished
 * row of the day. Undefined when every row is finished, or when `workedKey` is
 * not on the screen (then the page stays where it is).
 */
export function rowToScrollTo(rows: readonly TodayRowState[], workedKey: string): number | undefined {
  const workedIndex = rows.findIndex((row) => row.key === workedKey);
  if (workedIndex < 0) return undefined;

  for (let index = workedIndex + 1; index < rows.length; index++) {
    if (!rows[index]!.isComplete) return index;
  }
  for (let index = 0; index < workedIndex; index++) {
    if (!rows[index]!.isComplete) return index;
  }
  return undefined;
}

/**
 * Scrolls the row that `rowToScrollTo` picks into view, reading the rows from
 * the rendered Today screen. Called by app.ts after Today is attached to the page.
 */
export function scrollToNextUnfinishedRow(container: ParentNode, workedKey: string): void {
  const rowElements = Array.from(container.querySelectorAll<HTMLElement>(".item-row[data-row-key]"));
  const rows: TodayRowState[] = rowElements.map((element) => ({
    key: element.dataset.rowKey ?? "",
    isComplete: element.dataset.complete === "true",
  }));

  const index = rowToScrollTo(rows, workedKey);
  if (index === undefined) return;
  rowElements[index]?.scrollIntoView({ block: "center" });
}
