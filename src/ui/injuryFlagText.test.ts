import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "../program/parse";
import {
  areaLabel,
  checkedSheetText,
  clearButtonLabel,
  clearConfirmationText,
  injuryTitleLine,
  pastInjuryLine,
  programSupportsInjuries,
  sideAreaLabel,
} from "./injuryFlagText";

function load(file: string) {
  return parseProgram(JSON.parse(readFileSync(file, "utf-8"))).program;
}

describe("injury flag wording", () => {
  it("labels the area for the picker", () => {
    expect(areaLabel("shoulder")).toBe("Shoulder");
  });

  it("joins side and area, pluralising for both sides", () => {
    expect(sideAreaLabel("right", "shoulder")).toBe("Right shoulder");
    expect(sideAreaLabel("left", "shoulder")).toBe("Left shoulder");
    expect(sideAreaLabel("both", "shoulder")).toBe("Both shoulders");
  });

  it("writes the banner and Settings title line with a short date and no weekday", () => {
    expect(injuryTitleLine({ area: "shoulder", side: "right", from: "2026-11-22" })).toBe("Right shoulder · since 22 Nov");
  });

  it("writes a past injury as a range, or one date when cleared the same day", () => {
    expect(pastInjuryLine({ area: "shoulder", side: "left", from: "2026-11-22", to: "2026-12-03" })).toBe("Left shoulder · 22 Nov to 3 Dec");
    expect(pastInjuryLine({ area: "shoulder", side: "left", from: "2026-11-22", to: "2026-11-22" })).toBe("Left shoulder · 22 Nov");
  });

  it("asks nothing medical when clearing, and says the app can't tell", () => {
    expect(clearButtonLabel("shoulder")).toBe("My shoulder feels OK");
    expect(clearConfirmationText("shoulder")).toBe(
      "The app can't tell whether your shoulder is ready. If a physio or doctor has given you a plan, follow theirs.",
    );
  });

  it("words the sheet for the area", () => {
    const text = checkedSheetText("shoulder");

    expect(text.heading).toBe("Get your shoulder checked");
    expect(text.intro).toBe("This isn't medical advice, and the app can't tell how bad an injury is.");
    expect(text.redFlagsLead).toBe("Get your shoulder checked by a doctor or physio soon if any of these happen:");
    expect(text.redFlags).toHaveLength(5);
    expect(text.redFlags[0]).toBe("You can't lift the arm, or it feels weak or unstable.");
    expect(text.redFlags[4]).toBe("It isn't getting better after a week or two.");
    expect(text.whileFlagged).toContain("train only what's pain-free");
    expect(text.closing).toBe("The app doesn't decide when you're ready to load the shoulder again. A physio's plan beats the app's.");
  });

  it("offers injuries only for a program whose file tags exercises with loads", () => {
    expect(programSupportsInjuries(load("public/program.json"))).toBe(true);
    expect(programSupportsInjuries(load("public/steady-strength.json"))).toBe(false);
  });
});
