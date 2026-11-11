import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAllPrograms, loadCatalogue, loadProgram } from "./load";
import { parseCatalogue } from "./catalogue";

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

describe("loadAllPrograms", () => {
  const catalogue = parseCatalogue(JSON.parse(readFileSync("public/programs.json", "utf-8")));

  /** Serves the real public/ program files, except the ones named in `overrides` (url -> response). */
  function stubProgramFiles(overrides: Record<string, Response> = {}): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => overrides[url] ?? new Response(readFileSync(`public/${url.replace("./", "")}`, "utf-8"))),
    );
  }

  it("loads every listed program file, in catalogue order", async () => {
    stubProgramFiles();

    const loaded = await loadAllPrograms(catalogue);

    expect(loaded.map((item) => item.entry.programId)).toEqual(["explosive-endurance", "steady-strength"]);
    expect(loaded.map((item) => item.outcome.kind)).toEqual(["loaded", "loaded"]);
    expect(loaded[1]?.outcome.kind === "loaded" && loaded[1].outcome.program.name).toBe("Steady Strength");
  });

  it("turns a file that fails to load into a broken entry carrying its error, without stopping the others", async () => {
    stubProgramFiles({ "./steady-strength.json": new Response("{}", { status: 404 }) });

    const loaded = await loadAllPrograms(catalogue);

    expect(loaded[0]?.outcome.kind).toBe("loaded");
    expect(loaded[1]?.outcome).toEqual({ kind: "broken", error: "Could not load ./steady-strength.json: HTTP 404" });
  });

  it("turns a file that does not parse into a broken entry naming the file", async () => {
    stubProgramFiles({ "./program.json": new Response(JSON.stringify({ name: 5 })) });

    const loaded = await loadAllPrograms(catalogue);

    expect(loaded[0]?.outcome.kind).toBe("broken");
    expect(loaded[0]?.outcome.kind === "broken" && loaded[0].outcome.error).toMatch(/^\.\/program\.json: /);
    expect(loaded[1]?.outcome.kind).toBe("loaded");
  });
});
