# Aster Launcher website

Cloudflare Worker for the Aster Launcher download site at **https://asterlauncher.com**.

## Local development

Requires Node.js 22 or newer. The active website uses native JavaScript and has no runtime package dependencies.

```powershell
npm run dev
npm test
npm run build
```

The server prints its local URL. Edit `worker/index.js`; `scripts/build.mjs` bundles the existing font and images into `dist/server/index.js`. The old starter files under `app/` are not the active website entrypoint.

## Releases

The homepage and `/download` read GitHub's current published release from `asterlauncher/Aster-Launcher/releases/latest`. The changelog reads published release notes. Drafts and GitHub prereleases are excluded. Publishing a new regular GitHub release with an x64 Windows installer updates the site's version and download without rebuilding the website.

The current release must contain an `*_x64-setup.exe` or an x64 MSI from this repository. Missing installers and GitHub outages return a temporary download error rather than silently delivering an older version. Locally built versions are not public releases until their release and installer have been published on GitHub.

## Cloudflare setup

`wrangler.jsonc` selects the connected Cloudflare account, the `aster-launcher` Worker and the custom domain `asterlauncher.com`. The website was published to this account and the domain attached on 10 September 2026. Cloudflare manages the domain's Worker DNS record and HTTPS certificate. HTTP redirects to HTTPS through the zone's `always_use_https` setting.

The Cloudflare plugin uses its own account connection and was used for this publication. Running Wrangler directly requires a separate Wrangler sign-in; the prior CLI session had expired:

```powershell
npm run cloudflare:login
npm run cloudflare:whoami
npm run cloudflare:check
npm run deploy:cloudflare
```

The deployment command publishes the website and binds the configured custom domain. Cloudflare manages its DNS and HTTPS certificate. Scripts request `wrangler@latest` so they use the current stable CLI. Check changes with `cloudflare:check` before deployment; changes to the Worker compatibility date should be tested too.

The existing `.openai/hosting.json` retains the site's Sites project identity. This publication runs in the user's own Cloudflare account, separately from that Sites project.
