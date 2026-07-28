# Aster Launcher

Aster Launcher is a native Windows launcher for Minecraft: Java Edition with
Microsoft sign-in, isolated game instances, mod and modpack discovery, and
signed in-launcher updates.

> Aster Launcher is currently in closed alpha. Minecraft: Java Edition must be
> owned separately.

## Current release

**0.5.1 — Social Sharing & Public Build Fix**

The original interface prototype has grown into a functional launcher with
Microsoft, Xbox, and Minecraft authentication; Vanilla, Fabric, and Forge
instances; real game launching; Modrinth and CurseForge discovery; supported
required dependency installation; modpack import and export; download and
notification centers; live launcher presence; signed updates; and the first
Aster Social release with friends, requests, private chat, screenshots, and
direct modpack sharing. Version 0.5.1 also includes the public Microsoft and
Supabase client configuration required by installed tester builds.

See the complete [version history](docs/VERSION_HISTORY.md) for every release
from 0.1.0 through 0.5.1.

## Development

Requirements:

- Windows 10 or 11
- Node.js 22
- Rust stable
- Microsoft Edge WebView2

```powershell
npm install
npm run tauri -- dev
```

Run the checks:

```powershell
npm test
npm run build
```

## Releases and updates

Release tags use the format `app-v0.5.1`. GitHub Actions builds the Windows
installer and attaches a signed `aster-update.json` manifest. Existing launcher
installations only accept update manifests signed by Aster's embedded Ed25519
update key and installers whose SHA-256 hash matches the manifest.

## Legal

Aster Launcher is an independent third-party launcher. It is not an official
Minecraft product and is not approved by or associated with Mojang or
Microsoft.

Contact: [asterlauncher@gmail.com](mailto:asterlauncher@gmail.com)
