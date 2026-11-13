import { setImmediate } from "node:timers/promises";
import type { FileFinderApi, FileItem, Score } from "@ff-labs/fff-node";

const NATIVE_PAGE_SIZE = 200;

export function isStrongFindMatch(file: string, score: Score | undefined, pattern: string): boolean {
  const terms = pattern.trim().split(/\s+/).filter((term) => term && !/[*?[{]/.test(term));
  if (terms.length === 0) return true;
  const lower = file.toLowerCase();
  if (terms.every((term) => lower.includes(term.toLowerCase()))) return true;
  // Use match quality, not bonuses for recent access or a frequently used file.
  const threshold = terms.join("").length * 14;
  return (score?.baseScore ?? 0) >= threshold;
}

export async function collectFindPage(
  picker: Pick<FileFinderApi, "fileSearch">,
  query: string,
  pattern: string,
  limit: number,
  offset = 0,
  signal?: AbortSignal,
): Promise<{
  items: FileItem[];
  totalCandidates: number;
  totalFiles: number;
  filteredCount: number;
  nextOffset?: number;
}> {
  const items: FileItem[] = [];
  let filteredCount = 0;
  while (true) {
    if (signal?.aborted) throw new Error("Operation aborted");
    // In the C API, pageIndex is a result offset, not a page number.
    const response = picker.fileSearch(query, { pageIndex: offset, pageSize: NATIVE_PAGE_SIZE });
    if (!response.ok) throw new Error(response.error);
    const result = response.value;
    const counts = { totalCandidates: result.totalMatched, totalFiles: result.totalFiles };
    for (let i = 0; i < result.items.length; i++) {
      const item = result.items[i];
      if (!isStrongFindMatch(item.relativePath, result.scores[i], pattern)) {
        filteredCount++;
        continue;
      }
      // Leave the lookahead result unconsumed for the next page.
      if (items.length === limit) {
        return { items, ...counts, filteredCount, nextOffset: offset + i };
      }
      items.push(item);
    }
    offset += result.items.length;
    if (offset >= result.totalMatched || result.items.length === 0) {
      return { items, ...counts, filteredCount };
    }
    await setImmediate(undefined, { signal });
  }
}
