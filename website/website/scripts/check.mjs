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
    ["/", "All your mods."],
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
  assert.ok(home.includes("In development"));
  assert.ok(home.includes("ambient-pixels"));
  assert.ok(home.includes("Scroll to explore"));
  assert.ok(home.includes("Everything<br>together."));
  assert.ok(home.includes("Built around<br>the way you play."));
  assert.ok(home.includes("scrollbar-width:none"));
  const siteScript = await (await site.fetch(new Request("https://aster.test/site.js"))).text();
  assert.ok(siteScript.includes("scrollVelocity"));
  assert.ok(siteScript.includes("densityProgress"));
  assert.ok(siteScript.includes('addEventListener("pointermove"'));
  assert.ok(home.includes("/aster-core-loop.mp4"));
  assert.ok(home.includes("more than one game"));
  assert.ok(!home.includes("DOWNLOAD 0.7.9"));
  assert.ok(!home.includes("Minecraft.otf"));
  assert.ok(!home.includes("launcher-preview.png"));
  assert.ok(!home.includes('href="/download"'));
  assert.ok(!home.includes('href="/changelog"'));

  for (const path of ["/download", "/changelog"]) {
    const response = await site.fetch(new Request(`https://aster.test${path}`));
    assert.equal(response.status, 410, path);
    assert.match(await response.text(), /Nothing to download yet/);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }

  assert.equal((await site.fetch(new Request("https://aster.test/not-found"))).status, 404);
  assert.equal(externalRequests, 0, "The rebranding website must not resolve GitHub releases");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Redesigned website routes and retired launcher downloads passed.");
