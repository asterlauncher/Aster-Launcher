# Aster Launcher updates

The launcher checks the latest GitHub Release every 15 minutes and whenever
the application becomes active again. Every release manifest is signed with
Ed25519, and the installer is verified with SHA-256 before installation.

## One-time GitHub setup

Create these repository secrets under **Settings → Secrets and variables →
Actions**:

- `ASTER_UPDATE_PRIVATE_KEY`: the complete contents of
  `backups/updater/aster-update-private.pem`

Keep `backups/updater/aster-update-private.pem` private and back it up
securely. If the private key is lost, existing launcher installations cannot
accept future updates signed with another key.

## Publishing an update

1. Update the same semantic version in `package.json`,
   `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Edit `docs/RELEASE_NOTES.md`. The first Markdown heading becomes the
   update name shown in the launcher; the remaining text becomes its
   description.
3. Commit and push the changes.
4. Create and push a matching tag, for example `app-v0.1.1`.
5. GitHub Actions builds the installer and publishes it with the signed
   `aster-update.json` manifest in GitHub Releases.

The notification dropdown will detect the release automatically. Users can
download, verify, install, and restart from the **Update now** button.
