import { build } from "esbuild";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
const dest = "public/review-assets";
await mkdir(dest, { recursive: true });
for (const f of ["model.json", "group1-shard1of1.bin"])
  await copyFile(
    "node_modules/@spotify/basic-pitch/model/" + f,
    dest + "/" + f,
  );
for (const f of [
  "tfjs-backend-wasm.wasm",
  "tfjs-backend-wasm-simd.wasm",
  "tfjs-backend-wasm-threaded-simd.wasm",
])
  await copyFile(
    "node_modules/@tensorflow/tfjs-backend-wasm/dist/" + f,
    dest + "/" + f,
  );
await copyFile(
  "node_modules/@spotify/basic-pitch/LICENSE",
  dest + "/LICENSE-basic-pitch.txt",
);
await copyFile(
  "research/licenses/LICENSE-tensorflow.txt",
  dest + "/LICENSE-tensorflow.txt",
);
await writeFile(
  dest + "/NOTICE.txt",
  "Spotify Basic Pitch 1.0.1 — Copyright 2022 Spotify AB — Apache-2.0.\nTensorFlow.js 3.21.0 — Copyright Google LLC — Apache-2.0.\nBundled from official npm packages; inference wrapper by Zhiyin.\n",
);
await build({
  entryPoints: ["lib/review-worker.mjs"],
  outfile: dest + "/worker.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  minify: true,
  legalComments: "linked",
});

await copyFile(
  "node_modules/@spotify/basic-pitch/model/group1-shard1of1.bin",
  dest + "/weights.data",
);
