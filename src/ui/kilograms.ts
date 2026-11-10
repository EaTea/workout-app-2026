/**
 * Rules for the kg value on the log screen and History: the step size, the
 * allowed range, and parsing of a number the athlete types instead of
 * stepping. Kept free of the DOM so it can be unit tested; `setEditor.ts`
 * uses it for the kg stepper.
 *
 *   typed text ──▶ parseKilogramInput ──▶ { isValid, kilograms }
 */

/** Kg step of the + / − buttons. Matches the smallest common plate pair. */
export const KILOGRAM_STEP = 2.5;

/** Largest load that can be typed. */
export const MAXIMUM_KILOGRAMS = 500;

/** The outcome of reading typed kg text. */
export interface KilogramInputResult {
  /** False when the text is not a usable load; the caller then reverts to the value it had. */
  isValid: boolean;

  /** The parsed load when valid. 0 means "no load" (the caller stores nothing). */
  kilograms?: number;
}

/**
 * Reads kg text typed into the kg field. Accepts a whole number or one with
 * a single decimal ("22", "22.5", also "22,5" as phones in many locales type
 * it), from 0 to `MAXIMUM_KILOGRAMS`. Anything else (empty, letters, a
 * negative number, two decimals, above the maximum) is invalid, and the
 * field reverts. Called when the typed value is committed (Enter or blur).
 */
export function parseKilogramInput(text: string): KilogramInputResult {
  const trimmed = text.trim().replace(",", ".");
  if (!/^\d+(\.\d)?$/.test(trimmed)) return { isValid: false };

  const kilograms = Number(trimmed);
  if (kilograms > MAXIMUM_KILOGRAMS) return { isValid: false };

  return { isValid: true, kilograms };
}

/**
 * Rounds to one decimal place, so repeated 2.5 steps from a typed value such
 * as 22.3 never show floating-point noise ("24.799999999999997").
 */
export function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
