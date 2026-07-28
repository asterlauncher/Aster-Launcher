import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import site from "../worker/index.js";

const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const fontPath = resolve(import.meta.dirname, "..", "assets", "Minecraft.otf");
const iconPath = resolve(import.meta.dirname, "..", "assets", "aster-icon.png");
const previewPath = resolve(import.meta.dirname, "..", "assets", "launcher-preview.png");

const server = createServer(async (incoming, outgoing) => {
  try {
    const requestUrl = new URL(
      incoming.url ?? "/",
      `http://${incoming.headers.host ?? `127.0.0.1:${port}`}`,
    );
    const request = new Request(requestUrl, {
      method: incoming.method,
      headers: incoming.headers,
    });
    if (requestUrl.pathname === "/minecraft.otf") {
      outgoing.statusCode = 200;
      outgoing.setHeader("content-type", "font/otf");
      outgoing.setHeader("cache-control", "public, max-age=31536000, immutable");
      outgoing.end(await readFile(fontPath));
      return;
    }
    if (requestUrl.pathname === "/aster-icon.png") {
      outgoing.statusCode = 200;
      outgoing.setHeader("content-type", "image/png");
      outgoing.end(await readFile(iconPath));
      return;
    }
    if (requestUrl.pathname === "/launcher-preview.png") {
      outgoing.statusCode = 200;
      outgoing.setHeader("content-type", "image/png");
      outgoing.end(await readFile(previewPath));
      return;
    }
    const response = await site.fetch(request);

    outgoing.statusCode = response.status;
    for (const [name, value] of response.headers) {
      outgoing.setHeader(name, value);
    }
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.statusCode = 500;
    outgoing.setHeader("content-type", "text/plain; charset=utf-8");
    outgoing.end(error instanceof Error ? error.message : "Unexpected error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local: http://127.0.0.1:${port}`);
});
