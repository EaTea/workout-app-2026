import { describe, expect, it } from "vitest";
import { APP_TITLE, buildPlaceholderHtml } from "./placeholder";

describe("buildPlaceholderHtml", () => {
  it("renders the given title as the page heading", () => {
    expect(buildPlaceholderHtml(APP_TITLE)).toContain(
      "<h1>Explosive Endurance</h1>",
    );
  });
});
