import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import site from "../worker/index.js";

const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const iconPath = resolve(import.meta.dirname, "..", "assets", "aster-icon.png");
const videoPath = resolve(import.meta.dirname, "..", "assets", "aster-core-loop.mp4");

async function sendFile(incoming, outgoing, path, contentType) {
  const file = await readFile(path);
  const range = incoming.headers.range;
  outgoing.setHeader("content-type", contentType);
  outgoing.setHeader("accept-ranges", "bytes");

  if (range) {
    const size = (await stat(path)).size;
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0;
      const end = match[2] ? Math.min(Number.parseInt(match[2], 10), size - 1) : size - 1;
      outgoing.statusCode = 206;
      outgoing.setHeader("content-range", `bytes ${start}-${end}/${size}`);
      outgoing.setHeader("content-length", end - start + 1);
      outgoing.end(file.subarray(start, end + 1));
      return;
    }
  }

  outgoing.statusCode = 200;
  outgoing.setHeader("content-length", file.length);
  outgoing.end(file);
}

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
    if (requestUrl.pathname === "/aster-icon.png") {
      await sendFile(incoming, outgoing, iconPath, "image/png");
      return;
    }
    if (requestUrl.pathname === "/aster-core-loop.mp4") {
      await sendFile(incoming, outgoing, videoPath, "video/mp4");
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
