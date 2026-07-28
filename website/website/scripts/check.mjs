import assert from "node:assert/strict";
import site from "../worker/index.js";

const pages = [
  ["/", "EVERYTHING YOU NEED."],
  ["/changelog", "Closed Alpha Quality Update"],
  ["/privacy", "Datenschutzhinweise"],
  ["/legal", "asterlauncher@gmail.com"],
];

for (const [path, expectedText] of pages) {
  const response = await site.fetch(new Request(`https://aster.test${path}`));
  const html = await response.text();
  assert.equal(response.status, 200, `${path} should return 200`);
  assert.match(
    html,
    new RegExp(expectedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${path} should include its primary content`,
  );
  assert.ok(
    response.headers.get("content-security-policy"),
    `${path} should include a content security policy`,
  );
}

const missing = await site.fetch(new Request("https://aster.test/not-found"));
assert.equal(missing.status, 404);

const changelog = await site.fetch(
  new Request("https://aster.test/changelog"),
);
const changelogHtml = await changelog.text();
assert.match(changelogHtml, /0\.4\.8/);
assert.match(changelogHtml, /CLOSED ALPHA QUALITY UPDATE/);
assert.match(changelogHtml, /0\.4\.7/);
assert.match(changelogHtml, /CLOSED ALPHA FOUNDATION UPDATE/);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.startsWith("https://api.github.com/")) {
    return Response.json([
      {
        tag_name: "app-v0.4.8",
        assets: [
          {
            name: "Aster Launcher_0.4.8_x64-setup.exe",
            browser_download_url:
              "https://github.com/asterlauncher/Aster-Launcher/releases/download/app-v0.4.8/Aster.Launcher_0.4.8_x64-setup.exe",
          },
        ],
      },
    ]);
  }
  if (url.startsWith("https://github.com/")) {
    return new Response("mock-installer", {
      headers: {
        "content-length": "14",
        "content-type": "application/octet-stream",
      },
    });
  }
  return originalFetch(input);
};
const download = await site.fetch(new Request("https://aster.test/download"));
globalThis.fetch = originalFetch;
assert.equal(download.status, 200);
assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);
assert.equal(await download.text(), "mock-installer");

console.log("All Aster Launcher website routes passed.");
