import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import runtimeConfig from "../scripts/sharp-runtime-targets.json";
import { getZToolsRoots } from "../scripts/ztools-data-paths.mjs";

describe("Windows support", () => {
  it("publishes the plugin for macOS and Windows with native artifacts unpacked", async () => {
    const manifest = JSON.parse(await fs.readFile(new URL("../plugin.json", import.meta.url), "utf8"));

    expect(manifest.platform).toEqual(expect.arrayContaining(["darwin", "win32"]));
    expect(manifest.unpack).toContain("preload/node_modules");
    expect(manifest.unpack).toContain(".node");
    expect(manifest.unpack).toContain(".dll");
    expect(manifest.unpack).toContain(".dylib");
  });

  it("packages Sharp runtimes for Windows x64 and ARM64", () => {
    const targets = runtimeConfig.targets.map((target) => `${target.os}/${target.cpu}`);

    expect(targets).toEqual(expect.arrayContaining(["win32/x64", "win32/arm64"]));
    for (const target of runtimeConfig.targets.filter((item) => item.os === "win32")) {
      expect(target.packages.some((runtimePackage) => runtimePackage.artifacts.includes(".node"))).toBe(true);
      expect(target.packages.some((runtimePackage) => runtimePackage.artifacts.includes(".dll"))).toBe(true);
    }
  });

  it("keeps the packaged Sharp version aligned with the application dependency", async () => {
    const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));

    expect(runtimeConfig.sharpVersion).toBe(packageJson.dependencies.sharp);
  });

  it("resolves legacy Windows data under APPDATA", () => {
    const roots = getZToolsRoots({
      platform: "win32",
      home: "C:\\Users\\tester",
      env: { APPDATA: "D:\\Profiles\\tester\\Roaming" }
    });

    expect(roots.modernRoot).toBe("C:\\Users\\tester\\.ztools");
    expect(roots.legacyRoot).toBe("D:\\Profiles\\tester\\Roaming\\ZTools");
  });

  it("falls back to the standard roaming profile when APPDATA is absent", () => {
    const roots = getZToolsRoots({ platform: "win32", home: "C:\\Users\\tester", env: {} });

    expect(roots.legacyRoot).toBe("C:\\Users\\tester\\AppData\\Roaming\\ZTools");
  });
});
