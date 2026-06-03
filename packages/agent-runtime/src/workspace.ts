import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function findWorkspaceRoot(start = process.cwd()) {
  let cursor = start;
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(resolve(cursor, "pnpm-workspace.yaml"))) return cursor;
    const parent = resolve(cursor, "..");
    if (parent === cursor) break;
    cursor = parent;
  }
  return start;
}
