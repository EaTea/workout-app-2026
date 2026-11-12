/**
 * Internal (in-memory) form of the "No equipment" ticks: for each calendar
 * date, the set of item keys (see `noEquipmentItemKey` in
 * `program/noEquipment.ts`) the person has ticked to swap. Only
 * `wire.ts` converts between this and the stored JSON; `storage.ts` and the
 * Today screen work with this type.
 *
 *   "2026-11-05" ──▶ { "3:single_leg_rdl", "5:pull_up" }
 */
export type NoEquipmentTicks = Map<string, Set<string>>;
