import {
  createHash,
  createPrivateKey,
  sign,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [
  installerArgument,
  outputArgument = "aster-update.json",
  publishedInstallerUrlArgument,
] =
  process.argv.slice(2);

if (!installerArgument) {
  throw new Error(
    "Usage: node scripts/create-update-manifest.mjs <installer.exe> [output.json]",
  );
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(scriptDirectory, "..");
const installerPath = resolve(installerArgument);
const outputPath = resolve(outputArgument);
const tauriConfig = JSON.parse(
  readFileSync(resolve(workspace, "src-tauri/tauri.conf.json"), "utf8"),
);
const releaseNotes = readFileSync(
  resolve(workspace, "docs/RELEASE_NOTES.md"),
  "utf8",
).replace(/\r\n/g, "\n").trim();
const lines = releaseNotes.split("\n");
const headingIndex = lines.findIndex((line) => /^#{1,3}\s+/.test(line.trim()));
const name =
  headingIndex >= 0
    ? lines[headingIndex].trim().replace(/^#{1,3}\s+/, "")
    : `Aster Launcher ${tauriConfig.version}`;
const description = lines
  .filter((_, index) => index !== headingIndex)
  .join("\n")
  .trim();
const installerBytes = readFileSync(installerPath);
const sha256 = createHash("sha256").update(installerBytes).digest("hex");
const tag = `app-v${tauriConfig.version}`;
const encodedInstaller = encodeURIComponent(basename(installerPath));
const generatedUrl =
  `https://github.com/asterlauncher/Aster-Launcher/` +
  `releases/download/${tag}/${encodedInstaller}`;
const url = publishedInstallerUrlArgument ?? generatedUrl;
const expectedUrlPrefix =
  `https://github.com/asterlauncher/Aster-Launcher/releases/download/${tag}/`;

if (!url.startsWith(expectedUrlPrefix)) {
  throw new Error(
    `The published installer URL must start with ${expectedUrlPrefix}`,
  );
}
const publishedAt = new Date().toISOString();
const privateKeyFallback = resolve(
  workspace,
  "backups/updater/aster-update-private.pem",
);
const privateKeyPem =
  process.env.ASTER_UPDATE_PRIVATE_KEY ??
  (existsSync(privateKeyFallback)
    ? readFileSync(privateKeyFallback, "utf8")
    : null);

if (!privateKeyPem) {
  throw new Error(
    "ASTER_UPDATE_PRIVATE_KEY is missing. Add the GitHub Actions secret first.",
  );
}

const payload = [
  tauriConfig.version,
  name,
  description,
  publishedAt,
  url,
  sha256,
].join("\n");
const signature = sign(
  null,
  Buffer.from(payload),
  createPrivateKey(privateKeyPem),
).toString("base64");
const manifest = {
  version: tauriConfig.version,
  name,
  description,
  publishedAt,
  url,
  sha256,
  signature,
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Created signed update manifest: ${outputPath}`);
