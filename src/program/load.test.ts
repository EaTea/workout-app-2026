import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCatalogue, loadProgram } from "./load";

/** Replaces global fetch with a stub that answers every request with `body` and `status`. */
function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchStub = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadCatalogue", () => {
  it("fetches ./programs.json by default and returns the parsed catalogue", async () => {
    const fetchStub = stubFetch(JSON.parse(readFileSync("public/programs.json", "utf-8")));

    const catalogue = await loadCatalogue();

    expect(fetchStub).toHaveBeenCalledWith("./programs.json");
    expect(catalogue.entries[0]).toEqual({ programId: "explosive-endurance", programUrl: "./program.json" });
  });

  it("throws a clear error when the file is missing", async () => {
    stubFetch({}, 404);

    await expect(loadCatalogue()).rejects.toThrow("Could not load ./programs.json: HTTP 404");
  });

  it("passes the parser's path-style error through", async () => {
    stubFetch({ programs: [] });

    await expect(loadCatalogue()).rejects.toThrow(/^\.\/programs\.json: programs: the list is empty/);
  });
});

describe("loadCatalogue with malformed JSON", () => {
  it("names the file in the syntax error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{ not json", { status: 200 })));

    await expect(loadCatalogue()).rejects.toThrow(/^\.\/programs\.json: /);
  });
});

describe("loadProgram", () => {
  it("loads the program a catalogue entry points at", async () => {
    stubFetch(JSON.parse(readFileSync("public/program.json", "utf-8")));

    const { program } = await loadProgram("./program.json");

    expect(program.days[1]).toBeDefined();
  });

  it("names the file in the HTTP error, once", async () => {
    stubFetch({}, 500);

    await expect(loadProgram("./steady.json")).rejects.toThrow(/^Could not load \.\/steady\.json: HTTP 500$/);
  });

  it("names the file in the syntax error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{ not json", { status: 200 })));

    await expect(loadProgram("./steady.json")).rejects.toThrow(/^\.\/steady\.json: /);
  });

  it("names the file in the parser's error", async () => {
    stubFetch({ name: "broken" });

    await expect(loadProgram("./steady.json")).rejects.toThrow(/^\.\/steady\.json: \S/);
  });
});
