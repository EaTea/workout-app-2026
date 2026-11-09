/**
 * Registers the service worker that makes the app installable and usable
 * offline. Called once from main.ts at startup.
 *
 * Only runs in production builds: in `npm run dev` there is no sw.js, and a
 * worker would serve stale files while editing. The URL is relative so it
 * resolves under the GitHub Pages sub-path (/workout-app-2026/sw.js).
 * Failure is logged, never thrown: the app works fine without a worker.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.register("./sw.js").catch((error: unknown) => {
    console.warn("Service worker registration failed; the app won't work offline.", error);
  });
}
