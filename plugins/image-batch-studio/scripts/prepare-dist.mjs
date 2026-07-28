import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const preloadDir = path.join(dist, "preload");
const sharedDir = path.join(dist, "shared");
const runtimeDir = path.join(root, "scripts", "runtime");
const runtimeConfig = JSON.parse(
  await fs.readFile(path.join(root, "scripts", "sharp-runtime-targets.json"), "utf8")
);
const [primaryTarget, ...additionalTargets] = runtimeConfig.targets;
const runtimePackage = JSON.parse(await fs.readFile(path.join(runtimeDir, "package.json"), "utf8"));
const runtimeDependencies = runtimePackage.dependencies;
if (runtimeDependencies.sharp !== runtimeConfig.sharpVersion) {
  throw new Error("Sharp runtime version must match scripts/sharp-runtime-targets.json");
}
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function npmCi(directory, target) {
  execFileSync(npmCommand, [
    "ci",
    "--omit=dev",
    "--include=optional",
    `--os=${target.os}`,
    `--cpu=${target.cpu}`,
    "--no-audit",
    "--no-fund"
  ], {
    cwd: directory,
    stdio: "inherit"
  });
}

async function copyRuntimeManifest(directory) {
  await fs.copyFile(path.join(runtimeDir, "package.json"), path.join(directory, "package.json"));
  await fs.copyFile(path.join(runtimeDir, "package-lock.json"), path.join(directory, "package-lock.json"));
}

async function installSharpRuntime(target) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `ztools-sharp-${target.os}-${target.cpu}-`));
  try {
    await copyRuntimeManifest(tempDir);
    npmCi(tempDir, target);

    const sourceImgDir = path.join(tempDir, "node_modules", "@img");
    const targetImgDir = path.join(preloadDir, "node_modules", "@img");

    await fs.mkdir(targetImgDir, { recursive: true });
    for (const runtimePackage of target.packages) {
      const sourcePackage = path.join(sourceImgDir, runtimePackage.name);
      await fs.access(sourcePackage);
      await fs.cp(sourcePackage, path.join(targetImgDir, runtimePackage.name), {
        recursive: true,
        force: true
      });
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function installAdditionalSharpRuntimes() {
  for (const target of additionalTargets) {
    await installSharpRuntime(target);
  }
}

await fs.mkdir(preloadDir, { recursive: true });
await fs.mkdir(sharedDir, { recursive: true });
const pluginConfig = JSON.parse(await fs.readFile(path.join(root, "plugin.json"), "utf8"));
delete pluginConfig.development;
await fs.writeFile(path.join(dist, "plugin.json"), `${JSON.stringify(pluginConfig, null, 2)}\n`);
await fs.copyFile(path.join(root, "logo.svg"), path.join(dist, "logo.svg"));
await fs.copyFile(path.join(root, "cover.png"), path.join(dist, "cover.png"));
await copyRuntimeManifest(preloadDir);
await fs.writeFile(path.join(sharedDir, "package.json"), '{"type":"commonjs"}\n');

npmCi(preloadDir, primaryTarget);
await installAdditionalSharpRuntimes();
