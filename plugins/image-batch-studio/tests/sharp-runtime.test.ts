import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import runtimeConfig from "../scripts/sharp-runtime-targets.json";
import {
  selectSharpRuntimeTarget,
  sharpRuntimeStatus,
  verifyRuntimeIntegrity
} from "../src/preload/sharp-runtime";

describe("dynamic Sharp runtime", () => {
  it("selects an exact operating system and architecture target", () => {
    expect(selectSharpRuntimeTarget(runtimeConfig, "darwin", "arm64")?.arch).toBe("arm64");
    expect(selectSharpRuntimeTarget(runtimeConfig, "win32", "x64")?.platform).toBe("win32");
    expect(selectSharpRuntimeTarget(runtimeConfig, "linux", "x64")).toBeUndefined();
  });

  it("verifies package bytes against SHA-512 integrity", () => {
    const payload = Buffer.from("trusted-runtime");
    const integrity = `sha512-${crypto.createHash("sha512").update(payload).digest("base64")}`;

    expect(verifyRuntimeIntegrity(payload, integrity)).toBe(true);
    expect(verifyRuntimeIntegrity(Buffer.from("changed-runtime"), integrity)).toBe(false);
    expect(verifyRuntimeIntegrity(payload, "invalid")).toBe(false);
  });

  it("reports the development Sharp runtime as ready", async () => {
    const status = await sharpRuntimeStatus();

    expect(status.state).toBe("ready");
    expect(status.version).toBe(runtimeConfig.sharpVersion);
  });
});
