import assert from "node:assert/strict";
import site from "../worker/index.js";

const originalFetch = globalThis.fetch;
let externalRequests = 0;
globalThis.fetch = async () => {
  externalRequests += 1;
  throw new Error("The rebranding website must not fetch a published launcher release.");
};

try {
  for (const [path, content] of [
    ["/", "Your mods."],
    ["/privacy", "How the Aster website"],
    ["/legal", "asterlauncher@gmail.com"],
  ]) {
    const response = await site.fetch(new Request(`https://aster.test${path}`));
    const html = await response.text();
    assert.equal(response.status, 200, path);
    assert.ok(html.includes(content), path);
    assert.ok(response.headers.get("content-security-policy"), path);
    assert.ok(html.includes(`href="https://asterlauncher.com${path}"`), path);
  }

  const home = await (await site.fetch(new Request("https://aster.test/"))).text();
  assert.ok(home.includes("Download for Windows"));
  assert.ok(home.includes("VERSION 0.8.0 · WINDOWS 64-BIT"));
  assert.ok(home.includes('href="/downloads/Aster-Launcher-0.8.0-Windows-x64-Setup.exe"'));
  assert.ok(!home.includes("In development"));
  assert.ok(!home.includes("no download yet"));
  assert.ok(home.includes("ambient-pixels"));
  assert.ok(home.includes("Scroll to explore"));
  assert.ok(home.includes("Pick a game.<br>Add your mods."));
  assert.ok(home.includes("Ready when<br>you are."));
  assert.ok(!home.includes("Built around"));
  assert.ok(!home.includes("taking shape"));
  assert.ok(home.includes("scrollbar-width:none"));
  const siteScript = await (await site.fetch(new Request("https://aster.test/site.js"))).text();
  assert.ok(siteScript.includes("scrollVelocity"));
  assert.ok(siteScript.includes("densityProgress"));
  assert.ok(siteScript.includes('addEventListener("pointermove"'));
  assert.ok(home.includes("/aster-core-loop.mp4"));
  assert.ok(home.includes("Manage your games, mods and profiles"));
  assert.ok(!home.includes("DOWNLOAD 0.7.9"));
  assert.ok(!home.includes("Minecraft.otf"));
  assert.ok(!home.includes("launcher-preview.png"));
  assert.ok(!home.includes('href="/changelog"'));

  const download = await site.fetch(new Request("https://aster.test/download"));
  assert.equal(download.status, 302);
  assert.equal(
    download.headers.get("location"),
    "https://aster.test/downloads/Aster-Launcher-0.8.0-Windows-x64-Setup.exe",
  );
  assert.equal((await site.fetch(new Request("https://aster.test/changelog"))).status, 404);

  assert.equal((await site.fetch(new Request("https://aster.test/not-found"))).status, 404);
  assert.equal(externalRequests, 0, "The rebranding website must not resolve GitHub releases");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Website routes and Aster 0.8.0 download passed.");
