import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const productionRoots = ["apps", "packages"];
const allowedPetdexAssets = new Set(["chaossprite-default.png", "noir-webling.webp"]);
const bannedPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bmockOwnerName\b/, reason: "固定用户名不能进入 main" },
  { pattern: /\bmockFriends\b/, reason: "mock 好友列表不能进入 main" },
  { pattern: /\bloadTokenUsageSnapshot\b/, reason: "Token 用量不能读本地快照" },
  { pattern: /\bloadRuntimeStatsOverride\b/, reason: "运行统计不能读覆盖快照" },
  { pattern: /\bPET_TOKEN_USAGE_SNAPSHOT_PATH\b/, reason: "main 不能依赖 Token 快照环境变量" },
  { pattern: /\bPET_RUNTIME_STATS_PATH\b/, reason: "main 不能依赖运行统计快照环境变量" },
  { pattern: /\bdemoMusicFileName\b/, reason: "快捷播放器不能预设演示音乐" },
  { pattern: /\bdemoVideoFileName\b/, reason: "快捷播放器不能预设演示视频" },
  { pattern: /周杰伦|黑暗蜘蛛侠|白桃|Doraemon|Spider-Man|Bai Tao|Jay Chou/i, reason: "main 不能内置演示人物或媒体名称" },
];

const failures: string[] = [];
const petdexDir = join(root, "apps/desktop/src/assets/petdex");
const petdexAssets = existsSync(petdexDir) ? readdirSync(petdexDir).filter((file) => [".png", ".webp"].includes(extname(file))) : [];

for (const asset of petdexAssets) {
  if (!allowedPetdexAssets.has(asset)) {
    failures.push(`Petdex 多余预设资源：${relative(root, join(petdexDir, asset))}`);
  }
}

for (const asset of allowedPetdexAssets) {
  if (!petdexAssets.includes(asset)) {
    failures.push(`Petdex 缺少主线预设资源：${relative(root, join(petdexDir, asset))}`);
  }
}

for (const file of walkProductionFiles()) {
  const content = readFileSync(file, "utf8");
  for (const banned of bannedPatterns) {
    if (banned.pattern.test(content)) {
      failures.push(`${relative(root, file)}：${banned.reason}`);
    }
  }
}

if (failures.length) {
  console.error(["main 数据策略检查失败：", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exit(1);
}

console.log("main 数据策略检查通过：无 mock/快照数据入口，Petdex 仅保留 2 个预设。");

function* walkProductionFiles() {
  for (const productionRoot of productionRoots) {
    const fullRoot = join(root, productionRoot);
    if (!existsSync(fullRoot)) continue;
    yield* walk(fullRoot);
  }
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["dist", "node_modules", "target", "gen"].includes(entry.name)) continue;
      yield* walk(fullPath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (/\.test\.[cm]?[tj]sx?$/.test(entry.name)) continue;
    if (!/\.(ts|tsx|js|jsx|json|md)$/.test(entry.name)) continue;
    yield fullPath;
  }
}
