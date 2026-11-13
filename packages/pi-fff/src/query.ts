import path from "node:path";

export function normalizePathConstraint(
  pathConstraint: string,
  cwd = process.cwd(),
): string | null {
  let trimmed = pathConstraint.trim();
  if (!trimmed) return trimmed;

  if (path.isAbsolute(trimmed)) {
    const relative = path.relative(cwd, trimmed).replaceAll(path.sep, "/");
    if (relative === "") return null;
    if (relative.startsWith("../") || relative === ".." || path.isAbsolute(relative)) {
      throw new Error(
        `Path constraint must be relative to the workspace: ${pathConstraint}`,
      );
    }
    trimmed = relative;
  }

  if (trimmed === "." || trimmed === "./") return null;
  // Strip a leading `./` so `./**/*.rs` and `**/*.rs` behave identically.
  if (trimmed.startsWith("./")) trimmed = trimmed.slice(2);

  // wif we left with the ** it means anything so treat it as a cwd path
  if (trimmed === "**" || trimmed === "**/" || trimmed === "**/*") return null;

  // FFF's glob matcher can treat a hidden directory root glob such as
  // `.agents/**` as empty, while the tool contract says this means "inside
  // this directory". Collapse simple trailing recursive directory globs to the
  // directory-prefix constraint understood by the parser. Keep real file globs
  // such as `src/**/*.ts` unchanged.
  const recursiveDir = trimmed.match(/^(.*)\/\*\*(?:\/\*)?$/);
  if (recursiveDir) {
    const dir = recursiveDir[1];
    if (dir && !/[*?[{]/.test(dir)) return `${dir}/`;
  }

  // Already signals path-constraint syntax to the parser.
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) return trimmed;
  // Globs (`*.ts`, `src/**/*.cc`, `{src,lib}`) are handled by the parser.
  if (/[*?[{]/.test(trimmed)) return trimmed;
  // Filename with extension (`main.rs`, `config.json`) → FilePath constraint.
  const lastSegment = trimmed.split("/").pop() ?? "";
  if (/\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(lastSegment)) return trimmed;
  // Bare directory prefix → append `/` so the parser sees a PathSegment.
  return `${trimmed}/`;
}

// Exclusions are emitted as `!<constraint>` tokens, which the Rust parser
// understands (crates/fff-query-parser/src/parser.rs). We normalize each one
// the same way as the include path so bare dirs become PathSegment excludes.
// Tolerate callers passing already-negated forms like `!src/` by stripping
// the leading `!` before normalizing so we never double-negate (`!!src/`).
export function normalizeExcludes(
  exclude: string | string[] | undefined,
  cwd = process.cwd(),
): string[] {
  if (!exclude) return [];
  const list = Array.isArray(exclude) ? exclude : [exclude];
  const out: string[] = [];
  for (const raw of list) {
    const parts = raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of parts) {
      const stripped = p.startsWith("!") ? p.slice(1) : p;
      const normalized = normalizePathConstraint(stripped, cwd);
      if (normalized) out.push(`!${normalized}`);
    }
  }
  return out;
}

function normalizeFindConstraint(raw: string, cwd: string): string {
  const normalized = normalizePathConstraint(raw.replaceAll("\\", "/"), cwd) ?? "**";
  if (/\s/.test(normalized)) {
    throw new Error("File search constraints cannot contain whitespace. Use a search rooted at that directory.");
  }
  if (/[*?[{]/.test(normalized)) return normalized;
  if (normalized.endsWith("/")) return `${normalized}**`;
  if (!normalized.includes("/")) return `**/${normalized}`;
  const separator = normalized.lastIndexOf("/") + 1;
  // A character class forces the native parser to use an exact glob.
  return `${normalized.slice(0, separator)}[${normalized[separator]}]${normalized.slice(separator + 1)}`;
}

function splitFindExcludes(exclude: string | string[] | undefined): string[] {
  const result: string[] = [];
  for (const raw of typeof exclude === "string" ? [exclude] : exclude ?? []) {
    let depth = 0;
    let token = "";
    for (const char of raw) {
      if (char === "{" || char === "[") depth++;
      if (char === "}" || char === "]") depth--;
      if (depth === 0 && /[,\s]/.test(char)) {
        if (token) result.push(token);
        token = "";
      } else token += char;
    }
    if (token) result.push(token);
  }
  return result;
}

export function buildFindQuery(
  path: string | undefined,
  pattern: string,
  exclude?: string | string[],
  cwd = process.cwd(),
): string {
  const parts: string[] = [];
  if (path) parts.push(normalizeFindConstraint(path, cwd));
  for (const item of splitFindExcludes(exclude)) {
    parts.push(`!${normalizeFindConstraint(item.replace(/^!/, ""), cwd)}`);
  }
  parts.push(pattern.trim() === "*" ? "" : pattern);
  return parts.join(" ");
}

export function buildQuery(
  path: string | undefined,
  pattern: string,
  exclude?: string | string[],
  cwd = process.cwd(),
): string {
  const parts: string[] = [];
  if (path) {
    const pathConstraint = normalizePathConstraint(path, cwd);
    if (pathConstraint) parts.push(pathConstraint);
  }
  parts.push(...normalizeExcludes(exclude, cwd));
  parts.push(pattern);
  return parts.join(" ");
}
