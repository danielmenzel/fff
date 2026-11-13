import { describe, expect, test } from "bun:test";
import type { FileFinderApi, Score } from "@ff-labs/fff-node";
import { collectFindPage, isStrongFindMatch } from "../src/find";
import { buildFindQuery } from "../src/query";

const cwd = process.cwd();

describe("strict find queries", () => {
  test("uses strict globs for directories and files", () => {
    for (const input of ["src", "src/", "src/**", "./src/**/*"]) {
      expect(buildFindQuery(input, "", undefined, cwd)).toBe("src/** ");
    }
    expect(buildFindQuery("main.ts", "", undefined, cwd)).toBe("**/main.ts ");
    expect(buildFindQuery("src/main.ts", "", undefined, cwd)).toBe("src/[m]ain.ts ");
    expect(buildFindQuery(".agents/**", "", undefined, cwd)).toBe(".agents/** ");
  });

  test("preserves glob braces in comma-separated exclusions", () => {
    expect(buildFindQuery("{src,lib}/**", "needle", "test/,**/*.{rs,go},!vendor/")).toBe(
      "{src,lib}/** !test/** !**/*.{rs,go} !vendor/** needle",
    );
    expect(buildFindQuery("**", "*", "**")).toBe("** !** ");
  });

  test("does not turn whitespace in a path into extra search terms", () => {
    expect(() => buildFindQuery("with space/**", "needle")).toThrow("whitespace");
  });
});

describe("find match quality", () => {
  test("uses individual base scores, not ranking bonuses", () => {
    expect(isStrongFindMatch("unrelated.cpp", { baseScore: 20, total: 5000 } as Score, "Viewer")).toBe(false);
    expect(isStrongFindMatch("unrelated.cpp", { baseScore: 20 } as Score, "Viewer **/*.cpp")).toBe(false);
    expect(isStrongFindMatch("CurveNameLessComparatorTest.cpp", { baseScore: 360 } as Score, "CurveNameLessComparatr")).toBe(true);
  });

  test("keeps literal terms in either order and all files in a listing", () => {
    expect(isStrongFindMatch("Viewer/cppunit/main.cpp", undefined, "main Viewer")).toBe(true);
    for (const pattern of ["", "*", "**/*.cpp"]) {
      expect(isStrongFindMatch("Viewer/main.cpp", undefined, pattern)).toBe(true);
    }
  });
});

describe("find page errors", () => {
  test("reports native errors", async () => {
    const picker = { fileSearch: () => ({ ok: false, error: "native failure" }) } as Pick<FileFinderApi, "fileSearch">;
    await expect(collectFindPage(picker, "Viewer", "Viewer", 10)).rejects.toThrow("native failure");
  });

  test("honors cancellation before the first native call", async () => {
    const picker = { fileSearch: () => { throw new Error("must not run"); } };
    await expect(collectFindPage(picker, "Viewer", "Viewer", 10, 0, AbortSignal.abort()))
      .rejects.toThrow("Operation aborted");
  });
});
