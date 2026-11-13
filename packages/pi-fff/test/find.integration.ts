import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { buildFindQuery } from "../src/query.ts";
import { collectFindPage } from "../src/find.ts";

const { FileFinder } = await import(process.env.FFF_NATIVE_ENTRY
  ? pathToFileURL(path.resolve(process.env.FFF_NATIVE_ENTRY)).href : "@ff-labs/fff-node");

const files = [
  "SKY_DataDisplay/Viewer/cppunit/CurveNameLessComparatorTest.cpp",
  "SKY_DataDisplay/Viewer/cppunit/CurveNameLessComparatorTest.h",
  "SKY_DataDisplay/Viewer/cppunit/main.cpp",
  "SKY_DataDisplay/Viewer/src/main.cpp",
  "SKY_DataDisplay/GraphicHandler/cppunit/main.cpp",
  "SKY_Application/PAKliveSoundPower/.copilot-instructions.md",
  "GMC/MOIMeasurementListGraphicsSetComparator.cpp",
  ".agents/plans/note.md",
  "src/deep/main.ts",
  "src/main.ts",
  "test/main.ts",
  ...Array.from({ length: 207 }, (_, i) => `pages/Viewer${String(i).padStart(3, "0")}.cpp`),
];

async function fixture(t: any) {
  const root = mkdtempSync(path.join(tmpdir(), "fff-find-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of files) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "fixture\n");
  }
  // Tracked hidden files must be present in the native index.
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["-C", root, "add", "."]);
  const opened = FileFinder.create({
    basePath: root, disableWatch: true, disableMmapCache: true,
    disableContentIndexing: true, aiMode: true,
  });
  assert.equal(opened.ok, true, opened.error);
  const finder = opened.value;
  t.after(() => finder.destroy());
  const scan = await finder.waitForScan(10000);
  assert.equal(scan.ok, true, scan.error);
  const progress = finder.getScanProgress();
  assert.equal(progress.ok, true);
  assert.equal(progress.value.isScanning, false);
  return { root, finder };
}

test("native searches enforce directory, filename, glob and exclude filters", async (t) => {
  const { root, finder } = await fixture(t);
  const directory = "SKY_DataDisplay/Viewer/cppunit";
  for (const input of [directory, `${directory}/`, `${directory}/**`, `${directory}/**/*`, path.join(root, directory)]) {
    const result = await collectFindPage(finder, buildFindQuery(input, "", undefined, root), "", 100);
    assert.deepEqual(result.items.map((f) => f.relativePath).sort(), files.filter((f) => f.startsWith(`${directory}/`)).sort());
  }
  for (const [include, exclude, expected] of [
    ["src/main.ts", undefined, ["src/main.ts"]],
    ["main.ts", "test/", ["src/main.ts", "src/deep/main.ts"]],
    ["**/*.ts", ["**/{test,deep}/**"], ["src/main.ts"]],
    ["src/**", "**", []],
    [".agents/**", undefined, [".agents/plans/note.md"]],
  ] as const) {
    const query = buildFindQuery(include, "*", exclude ? [...(typeof exclude === "string" ? [exclude] : exclude)] : undefined, root);
    const result = await collectFindPage(finder, query, "*", 100);
    assert.deepEqual(result.items.map((f) => f.relativePath).sort(), [...expected].sort(), query);
  }
});

test("native scores remove unrelated paths and retain a close spelling", async (t) => {
  const { root, finder } = await fixture(t);
  for (const pattern of ["CurveNameLessComparator", "CurveNameLessComparatr"]) {
    const result = await collectFindPage(finder, buildFindQuery(undefined, pattern, undefined, root), pattern, 100);
    assert.deepEqual(result.items.map((f) => f.relativePath).sort(), files.filter((f) => f.includes("CurveNameLessComparator")).sort());
  }
  const query = buildFindQuery("**/{AGENTS.md,.copilot-instructions.md}", "Viewer", undefined, root);
  assert.equal((await collectFindPage(finder, query, "Viewer", 100)).items.length, 0);
});

test("native pagination returns each file once across multiple native batches", async (t) => {
  const { root, finder } = await fixture(t);
  const query = buildFindQuery("pages/**", "Viewer", undefined, root);
  const found: string[] = [];
  let offset: number | undefined = 0;
  do {
    const result = await collectFindPage(finder, query, "Viewer", 3, offset);
    found.push(...result.items.map((f) => f.relativePath));
    offset = result.nextOffset;
    assert.ok(found.length <= 207);
  } while (offset !== undefined);
  assert.equal(new Set(found).size, found.length);
  assert.deepEqual(found.sort(), files.filter((f) => f.startsWith("pages/")).sort());
  const all = await collectFindPage(finder, query, "Viewer", 300);
  assert.deepEqual(all.items.map((f) => f.relativePath).sort(), found);
});
