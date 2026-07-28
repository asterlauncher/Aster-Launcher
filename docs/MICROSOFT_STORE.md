# Microsoft Store packaging

Aster Launcher is registered in Partner Center as:

- Package identity name: `AsterLauncher.AsterLauncher`
- Publisher: `CN=C299727D-7324-4B0C-A9D1-E1E71AA1D889`
- Publisher display name: `Aster Launcher`
- Store ID: `9N32DGVLVRTF`

These values are fixed by Microsoft and are mirrored in
`src-tauri/msix/AppxManifest.template.xml`.

## Build the Store package

From the repository root on Windows:

```powershell
npm run store:msix
```

The script builds the release executable and creates:

```text
dist/store/AsterLauncher_<version>_x64.msix
```

The package is intentionally unsigned. It is intended for upload to Partner
Center, where Microsoft signs the certified package. Do not distribute the
unsigned file directly to testers.

The three-part Tauri version is converted to the required four-part MSIX
version. For example, launcher version `0.4.7` becomes MSIX version
`0.4.7.0`.

## Partner Center

For closed-alpha distribution, configure the first submission as:

- Pricing: Free
- Audience: Private audience
- Architecture: x64

Add testers using the email address attached to each tester's Microsoft
account. Upload the generated `.msix` file in the submission's **Packages**
section.

Store-installed builds use Microsoft Store servicing and do not run Aster's
external NSIS updater.
