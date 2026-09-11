import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "server"), { recursive: true });
await mkdir(resolve(dist, "public"), { recursive: true });
await mkdir(resolve(dist, ".openai"), { recursive: true });

await cp(resolve(root, "worker", "index.js"), resolve(dist, "server", "index.js"));
await cp(resolve(root, "assets", "aster-icon.png"), resolve(dist, "public", "aster-icon.png"));
await cp(resolve(root, "assets", "aster-core-loop.mp4"), resolve(dist, "public", "aster-core-loop.mp4"));
await cp(
  resolve(root, ".openai", "hosting.json"),
  resolve(dist, ".openai", "hosting.json"),
);

console.log("Aster Launcher website built successfully.");
