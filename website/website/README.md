# Aster Launcher website

Cloudflare Worker for the Aster Launcher website at **https://asterlauncher.com**.

## Local development

Requires Node.js 22 or newer. The active website uses native JavaScript and has no runtime package dependencies.

```powershell
npm run dev
npm test
npm run build
```

The server prints its local URL. Edit `worker/index.js`; `scripts/build.mjs` bundles the existing font and images into `dist/server/index.js`. The old starter files under `app/` are not the active website entrypoint.

## Public versions

There is no public launcher version during the rebrand. The website does not resolve GitHub releases, list version history or serve an installer. Both `/download` and `/changelog` return HTTP 410 until the newly branded launcher is ready.

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
