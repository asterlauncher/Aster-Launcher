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
    ["/", "ONE PLACE."],
    ["/privacy", "Datenschutzhinweise"],
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
  assert.ok(home.includes("NO PUBLIC BUILD AVAILABLE"));
  assert.ok(!home.includes("DOWNLOAD 0.7.9"));
  assert.ok(!home.includes('href="/download"'));
  assert.ok(!home.includes('href="/changelog"'));

  for (const path of ["/download", "/changelog"]) {
    const response = await site.fetch(new Request(`https://aster.test${path}`));
    assert.equal(response.status, 410, path);
    assert.match(await response.text(), /No public Aster Launcher version/);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }

  assert.equal((await site.fetch(new Request("https://aster.test/not-found"))).status, 404);
  assert.equal(externalRequests, 0, "The rebranding website must not resolve GitHub releases");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Rebranding website routes and retired launcher downloads passed.");
