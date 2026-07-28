import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const processorPath = path.join(root, "dist", "preload", "processor.js");
const requireDist = createRequire(processorPath);
const processor = requireDist(processorPath);
const sharp = requireDist("sharp");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "image-batch-dist-smoke-"));

try {
  const inputPath = path.join(directory, "input.png");
  const outputDirectory = path.join(directory, "out");
  await sharp({
    create: {
      width: 24,
      height: 16,
      channels: 4,
      background: "#26756d"
    }
  })
    .png()
    .toFile(inputPath);

  const [result] = await processor.processImages([inputPath], {
    output: { directory: outputDirectory, namingPattern: "{name}.{ext}", overwrite: false },
    format: { type: "webp", quality: 80 }
  });
  if (!result.ok) throw new Error(result.error);

  const metadata = await sharp(result.outputPath).metadata();
  if (metadata.format !== "webp" || metadata.width !== 24 || metadata.height !== 16) {
    throw new Error(`Unexpected dist output metadata: ${JSON.stringify(metadata)}`);
  }

  console.log(JSON.stringify({ ok: true, platform: process.platform, arch: process.arch }, null, 2));
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
