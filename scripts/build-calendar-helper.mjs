import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const platform = process.platform;
const source = resolve(repoRoot, "apps", "desktop", "src-tauri", "native", "calendar-helper", "pet-calendar-helper.swift");
const outputDir = resolve(repoRoot, "apps", "desktop", "src-tauri", "resources", "calendar-helper");
const output = resolve(outputDir, "pet-calendar-helper");
const manifestPath = resolve(outputDir, "manifest.json");
const targetArch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x86_64" : process.arch;
const deploymentTarget = process.env.MACOSX_DEPLOYMENT_TARGET || "13.0";
const bundledXcodeDeveloperDir = "/Applications/Xcode.app/Contents/Developer";
const developerDir = process.env.DEVELOPER_DIR || (existsSync(bundledXcodeDeveloperDir) ? bundledXcodeDeveloperDir : undefined);
const swiftResourceDir = developerDir ? resolve(developerDir, "Toolchains", "XcodeDefault.xctoolchain", "usr", "lib", "swift") : undefined;
const toolEnv = {
  ...process.env,
  ...(developerDir ? { DEVELOPER_DIR: developerDir } : {}),
  MACOSX_DEPLOYMENT_TARGET: deploymentTarget,
};

if (platform !== "darwin") {
  console.log(`[build-calendar-helper] skip ${platform}; EventKit helper is macOS-only.`);
  process.exit(0);
}

const swiftc = spawnSync("xcrun", ["--find", "swiftc"], { cwd: repoRoot, encoding: "utf8", env: toolEnv });
if (swiftc.status !== 0 || !swiftc.stdout.trim()) {
  throw new Error("swiftc not found. Install Xcode command line tools before building the macOS package.");
}
const sdk = spawnSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { cwd: repoRoot, encoding: "utf8", env: toolEnv });
if (sdk.status !== 0 || !sdk.stdout.trim()) {
  throw new Error("macOS SDK not found. Install Xcode before building the macOS package.");
}

mkdirSync(outputDir, { recursive: true });
run(
  swiftc.stdout.trim(),
  [
    source,
    "-O",
    "-target",
    `${targetArch}-apple-macosx${deploymentTarget}`,
    "-sdk",
    sdk.stdout.trim(),
    ...(swiftResourceDir ? ["-resource-dir", swiftResourceDir] : []),
    "-framework",
    "EventKit",
    "-framework",
    "Foundation",
    "-o",
    output,
  ],
  repoRoot,
  toolEnv,
);
chmodSync(output, 0o755);

const probe = spawnSync(output, ["--probe"], { cwd: repoRoot, encoding: "utf8", env: toolEnv });
if (probe.status !== 0) {
  throw new Error(`Calendar helper probe failed:\n${probe.stderr || probe.stdout}`);
}

writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      source: "EventKit",
      binary: "pet-calendar-helper",
      platform,
      arch: process.arch,
      developerDir: developerDir ?? null,
      deploymentTarget,
      sdk: sdk.stdout.trim(),
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

console.log(`[build-calendar-helper] built EventKit helper at ${output}`);

function run(command, args, cwd, env) {
  const child = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (child.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${child.status}`);
  }
}
