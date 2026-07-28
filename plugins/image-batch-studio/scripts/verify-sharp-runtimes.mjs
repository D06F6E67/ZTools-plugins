import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const imgModules = path.join(root, "dist", "preload", "node_modules", "@img");
const manifest = JSON.parse(await fs.readFile(path.join(root, "dist", "plugin.json"), "utf8"));
const runtimeConfig = JSON.parse(
  await fs.readFile(path.join(root, "scripts", "sharp-runtime-targets.json"), "utf8")
);

async function containsArtifact(directory, extension) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory() && (await containsArtifact(entryPath, extension))) return true;
    if (entry.isFile() && entry.name.endsWith(extension)) return true;
  }
  return false;
}

const missing = [];
const sharpPackage = JSON.parse(
  await fs.readFile(path.join(root, "dist", "preload", "node_modules", "sharp", "package.json"), "utf8")
);
if (sharpPackage.version !== runtimeConfig.sharpVersion) {
  missing.push(`sharp version ${sharpPackage.version} (expected ${runtimeConfig.sharpVersion})`);
}
for (const target of runtimeConfig.targets) {
  for (const runtimePackage of target.packages) {
    const packageDirectory = path.join(imgModules, runtimePackage.name);
    try {
      const packageJson = JSON.parse(await fs.readFile(path.join(packageDirectory, "package.json"), "utf8"));
      if (!packageJson.os?.includes(target.os) || !packageJson.cpu?.includes(target.cpu)) {
        missing.push(`${runtimePackage.name} metadata for ${target.os}/${target.cpu}`);
        continue;
      }
      for (const extension of runtimePackage.artifacts) {
        if (!(await containsArtifact(packageDirectory, extension))) {
          missing.push(`${runtimePackage.name} ${extension}`);
        }
      }
    } catch {
      missing.push(runtimePackage.name);
    }
  }
}

if (missing.length > 0) {
  throw new Error(`Missing Sharp runtime artifacts: ${missing.join(", ")}`);
}

for (const platform of ["darwin", "win32"]) {
  if (!manifest.platform?.includes(platform)) {
    throw new Error(`plugin.json must enable ${platform}`);
  }
}

for (const extension of [".node", ".dll", ".dylib"]) {
  if (!manifest.unpack?.includes(extension)) {
    throw new Error(`plugin.json unpack must include ${extension} native artifacts`);
  }
}

if (!manifest.unpack.includes("preload/node_modules")) {
  throw new Error("plugin.json unpack must target preload/node_modules");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      targets: runtimeConfig.targets.map((target) => `${target.os}/${target.cpu}`),
      unpack: manifest.unpack
    },
    null,
    2
  )
);
