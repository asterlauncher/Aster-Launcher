import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "server"), { recursive: true });
await mkdir(resolve(dist, ".openai"), { recursive: true });

const source = await readFile(resolve(root, "worker", "index.js"), "utf8");
const font = await readFile(resolve(root, "assets", "Minecraft.otf"));
const icon = await readFile(resolve(root, "assets", "aster-icon.png"));
const preview = await readFile(resolve(root, "assets", "launcher-preview.png"));
const bundledSource = source.replace(
  '/*__FONT_DATA__*/ ""',
  JSON.stringify(font.toString("base64")),
).replace(
  '/*__ICON_DATA__*/ ""',
  JSON.stringify(icon.toString("base64")),
).replace(
  '/*__PREVIEW_DATA__*/ ""',
  JSON.stringify(preview.toString("base64")),
);

await writeFile(resolve(dist, "server", "index.js"), bundledSource);
await cp(
  resolve(root, ".openai", "hosting.json"),
  resolve(dist, ".openai", "hosting.json"),
);

console.log("Aster Launcher website built successfully.");
