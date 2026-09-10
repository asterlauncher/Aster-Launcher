import assert from "node:assert/strict";
import site from "../worker/index.js";

const repository = "https://github.com/asterlauncher/Aster-Launcher";
const api = "https://api.github.com/repos/asterlauncher/Aster-Launcher/releases";
const manifestUrl = `${repository}/releases/latest/download/aster-update.json`;
function release(version, overrides = {}) {
  const tag = `app-v${version}`;
  return {
    tag_name: tag, name: `Aster Launcher ${version}`, body: `Release notes for ${version}`,
    draft: false, prerelease: false,
    assets: [{ name: `Aster.Launcher_${version}_x64-setup.exe`, browser_download_url: `${repository}/releases/download/${tag}/Aster.Launcher_${version}_x64-setup.exe` }],
    ...overrides,
  };
}

function manifest(version, overrides = {}) {
  const tag = `app-v${version}`;
  return {
    version,
    name: `Aster Launcher ${version}`,
    description: `Release notes for ${version}`,
    publishedAt: "2026-09-10T19:58:48.201Z",
    url: `${repository}/releases/download/${tag}/Aster.Launcher_${version}_x64-setup.exe`,
    sha256: "0".repeat(64),
    signature: "signature",
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;
let latest = release("0.7.9");
let latestManifest = manifest("0.7.9");
let history = [release("0.5.4"), latest];
let apiFails = false;
let manifestFails = false;
const downloaded = [];
const requests = [];
globalThis.fetch = async (input) => {
  const url = String(input);
  requests.push(url);
  if (url === manifestUrl) {
    if (manifestFails) return new Response("Service unavailable", { status: 503 });
    return Response.json(latestManifest);
  }
  if (url.startsWith(api)) {
    if (apiFails) return new Response("Service unavailable", { status: 503 });
    return Response.json(url === `${api}/latest` ? latest : history);
  }
  if (url.startsWith(`${repository}/releases/download/`)) {
    downloaded.push(url);
    return new Response("mock-installer", { headers: { "content-length": "14", "content-type": "application/octet-stream" } });
  }
  throw new Error(`Unexpected network request: ${url}`);
};

try {
  for (const [path, content] of [
    ["/", "EVERYTHING YOU NEED."], ["/changelog", "Published Aster Launcher releases"],
    ["/privacy", "Datenschutzhinweise"], ["/legal", "asterlauncher@gmail.com"],
  ]) {
    const response = await site.fetch(new Request(`https://aster.test${path}`));
    const html = await response.text();
    assert.equal(response.status, 200, path);
    assert.ok(html.includes(content), path);
    assert.ok(response.headers.get("content-security-policy"), path);
    assert.ok(html.includes(`href="https://asterlauncher.com${path}"`), path);
  }
  assert.equal((await site.fetch(new Request("https://aster.test/not-found"))).status, 404);

  // Use GitHub's current release instead of the website's old version.
  const home = await (await site.fetch(new Request("https://aster.test/"))).text();
  assert.ok(home.includes("DOWNLOAD 0.7.9"));
  assert.ok(!home.includes("0.5.4"));
  const download = await site.fetch(new Request("https://aster.test/download"));
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /0\.7\.9_x64-setup\.exe/);
  assert.match(download.headers.get("cache-control"), /no-store/);
  assert.equal(await download.text(), "mock-installer");
  assert.ok(downloaded.at(-1).includes("/app-v0.7.9/"));

  // Pick up the next publication without changing the website source.
  latest = release("0.8.0");
  latestManifest = manifest("0.8.0");
  assert.ok((await (await site.fetch(new Request("https://aster.test/"))).text()).includes("DOWNLOAD 0.8.0"));
  await site.fetch(new Request("https://aster.test/download"));
  assert.ok(downloaded.at(-1).includes("/app-v0.8.0/"));

  // A current MSI must take priority over an older EXE.
  latestManifest = manifest("0.8.0", {
    url: `${repository}/releases/download/app-v0.8.0/Aster.Launcher_0.8.0_x64_en-US.msi`,
  });
  assert.match((await site.fetch(new Request("https://aster.test/download"))).headers.get("content-disposition"), /0\.8\.0_x64_en-US\.msi/);

  // Escape release text and exclude unpublished versions from public history.
  latest = release("0.8.0", { name: '<script>alert("title")</script>', body: '<img src=x onerror="alert(1)">' });
  latestManifest = manifest("0.8.0");
  history = [latest, release("0.9.0", { prerelease: true }), release("1.0.0", { draft: true }), release("0.5.4")];
  const changelog = await (await site.fetch(new Request("https://aster.test/changelog"))).text();
  assert.ok(changelog.includes("&lt;script&gt;"));
  assert.ok(changelog.includes("&lt;img"));
  assert.ok(!changelog.includes('<img src=x'));
  assert.ok(!changelog.includes("0.9.0"));
  assert.ok(!changelog.includes("1.0.0"));
  assert.equal((changelog.match(/<small>CURRENT<\/small>/g) ?? []).length, 1);
  assert.ok(changelog.includes("0.5.4"));

  // Missing, incompatible or untrusted installers must not return an older build.
  for (const invalid of [
    manifest("0.8.0", { url: `${repository}/releases/download/app-v0.8.0/arm64-setup.exe` }),
    manifest("0.8.0", { url: "https://github.com/someone/another-project/releases/download/app-v0.8.0/Aster_0.8.0_x64-setup.exe" }),
    manifest("0.8.0", { url: `${repository}/releases/download/app-v0.7.9/Aster_0.8.0_x64-setup.exe` }),
  ]) {
    latestManifest = invalid;
    latest = release("0.8.0", { assets: [] });
    const before = downloaded.length;
    assert.equal((await site.fetch(new Request("https://aster.test/download"))).status, 503);
    assert.equal(downloaded.length, before);
  }

  apiFails = true;
  latestManifest = manifest("0.8.0");
  assert.equal((await site.fetch(new Request("https://aster.test/"))).status, 200);
  assert.ok((await (await site.fetch(new Request("https://aster.test/changelog"))).text()).includes("VERSION 0.8.0"));
  assert.equal((await site.fetch(new Request("https://aster.test/download"))).status, 200);
  manifestFails = true;
  assert.equal((await site.fetch(new Request("https://aster.test/download"))).status, 503);
  requests.length = 0;
  await site.fetch(new Request("https://aster.test/privacy"));
  assert.equal(requests.length, 0, "Informational pages work independently of GitHub");
} finally {
  globalThis.fetch = originalFetch;
}
console.log("Website routes, current releases, downloads and failure handling passed.");
