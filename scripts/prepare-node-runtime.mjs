import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const nodeVersion = (process.env.PET_NODE_RUNTIME_VERSION || "25.6.0").replace(/^v/, "");
const platform = process.platform;
const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch;

if (platform !== "darwin") {
  console.log(`[prepare-node-runtime] skip ${platform}; macOS app bundles are built on darwin.`);
  process.exit(0);
}

if (arch !== "arm64" && arch !== "x64") {
  throw new Error(`Unsupported macOS Node runtime architecture: ${arch}`);
}

const distName = `node-v${nodeVersion}-darwin-${arch}`;
const cacheDir = resolve(repoRoot, ".cache", "node-runtime");
const archivePath = join(cacheDir, `${distName}.tar.xz`);
const extractDir = join(cacheDir, distName);
const resourceDir = resolve(repoRoot, "apps", "desktop", "src-tauri", "resources", "node");
const nodeOut = join(resourceDir, "bin", "node");
const manifestPath = join(resourceDir, "manifest.json");

if (isPrepared()) {
  console.log(`[prepare-node-runtime] using cached packaged Node v${nodeVersion} for darwin-${arch}`);
  process.exit(0);
}

mkdirSync(cacheDir, { recursive: true });
mkdirSync(join(resourceDir, "bin"), { recursive: true });

if (!existsSync(archivePath)) {
  const url = `https://nodejs.org/dist/v${nodeVersion}/${distName}.tar.xz`;
  run("curl", ["--fail", "--location", "--show-error", "--output", archivePath, url], repoRoot);
}

if (!existsSync(join(extractDir, "bin", "node"))) {
  rmSync(extractDir, { recursive: true, force: true });
  run("tar", ["-xJf", archivePath, "-C", cacheDir], repoRoot);
}

copyFileSync(join(extractDir, "bin", "node"), nodeOut);
chmodSync(nodeOut, 0o755);

const probe = spawnSync(nodeOut, ["--experimental-sqlite", "-e", "require('node:sqlite'); console.log(process.version)"], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (probe.status !== 0) {
  throw new Error(`Packaged Node runtime failed sqlite probe:\n${probe.stderr || probe.stdout}`);
}

writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      version: nodeVersion,
      platform,
      arch,
      binary: "bin/node",
      sqliteRuntime: "node:sqlite",
      preparedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

console.log(`[prepare-node-runtime] prepared Node ${probe.stdout.trim()} at ${nodeOut}`);

function isPrepared() {
  if (!existsSync(nodeOut) || !existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return manifest.version === nodeVersion && manifest.platform === platform && manifest.arch === arch;
  } catch {
    return false;
  }
}

function run(command, args, cwd) {
  const child = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (child.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${child.status}`);
  }
}
