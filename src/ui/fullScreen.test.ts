import { describe, expect, it } from "vitest";
import { nextFullScreenStep, readFullScreenEnvironment, type FullScreenBrowserLike, type FullScreenEnvironment } from "./fullScreen";

/** A browser that can go full screen, is in a normal tab, and is not a Home Screen app. */
function normalBrowserEnvironment(overrides: Partial<FullScreenEnvironment> = {}): FullScreenEnvironment {
  return { fullscreenEnabled: true, isFullScreen: false, isHomeScreenApp: false, ...overrides };
}

describe("nextFullScreenStep", () => {
  it("enters full screen when the browser allows it and the page is not full screen", () => {
    expect(nextFullScreenStep(normalBrowserEnvironment())).toBe("enter");
  });

  it("exits full screen when the page is already full screen", () => {
    expect(nextFullScreenStep(normalBrowserEnvironment({ isFullScreen: true }))).toBe("exit");
  });

  it("shows the Home Screen hint where the browser has no Fullscreen API (iPhone Safari)", () => {
    expect(nextFullScreenStep(normalBrowserEnvironment({ fullscreenEnabled: false }))).toBe("showHomeScreenHint");
  });

  it("hides the button for a Home Screen app, which is already full screen", () => {
    expect(nextFullScreenStep(normalBrowserEnvironment({ isHomeScreenApp: true }))).toBe("hideButton");
  });

  it("hides the button even when the API says it is enabled, because a Home Screen app has no browser bars", () => {
    expect(nextFullScreenStep({ fullscreenEnabled: true, isFullScreen: false, isHomeScreenApp: true })).toBe("hideButton");
  });
});

/** A fake browser for `readFullScreenEnvironment`; `standalone` is what `display-mode: standalone` matches. */
function fakeBrowser(options: { enabled?: boolean; fullScreenElement?: unknown; standalone?: boolean; standaloneFlag?: boolean }): FullScreenBrowserLike {
  return {
    fullscreenEnabled: options.enabled ?? true,
    fullscreenElement: options.fullScreenElement ?? null,
    matchMedia: (query: string) => ({ matches: query === "(display-mode: standalone)" && options.standalone === true }),
    standaloneFlag: options.standaloneFlag,
  };
}

describe("readFullScreenEnvironment", () => {
  it("reads a normal tab as allowed, not full screen, and not a Home Screen app", () => {
    expect(readFullScreenEnvironment(fakeBrowser({}))).toEqual({ fullscreenEnabled: true, isFullScreen: false, isHomeScreenApp: false });
  });

  it("reports full screen when some element is the full-screen element", () => {
    expect(readFullScreenEnvironment(fakeBrowser({ fullScreenElement: {} })).isFullScreen).toBe(true);
  });

  it("treats display-mode standalone as a Home Screen app", () => {
    expect(readFullScreenEnvironment(fakeBrowser({ standalone: true })).isHomeScreenApp).toBe(true);
  });

  it("treats iPhone's navigator.standalone flag as a Home Screen app", () => {
    expect(readFullScreenEnvironment(fakeBrowser({ standaloneFlag: true })).isHomeScreenApp).toBe(true);
  });

  it("reports a browser without the Fullscreen API as not enabled", () => {
    expect(readFullScreenEnvironment(fakeBrowser({ enabled: false })).fullscreenEnabled).toBe(false);
  });
});
