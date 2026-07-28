# Microsoft authentication setup

Aster Launcher is a public native client. It uses the system browser,
OAuth 2.0 Authorization Code with PKCE (S256), a random state value, and a
temporary loopback callback. It has no client secret and never receives the
Microsoft password.

## 1. Register the application

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/).
2. Go to **Identity → Applications → App registrations** and select
   **New registration**.
3. Use a name such as `Aster Launcher (development)`.
4. Under **Supported account types**, choose **Personal Microsoft accounts
   only**. Xbox and Minecraft consumer accounts use this tenant. If the
   registration is also intended for work/school users, choose the option
   that includes both organizational directories and personal Microsoft
   accounts; the launcher itself still authenticates against the `consumers`
   endpoint.
5. Leave the initial redirect URI empty and create the registration.
6. Copy the **Application (client) ID** from the overview page. Do not copy
   the object ID or directory ID.

## 2. Configure the native-client redirect

1. In the app registration, open **Authentication**.
2. Select **Add a platform → Mobile and desktop applications**.
3. Add this custom redirect URI:

   ```text
   http://localhost/auth/callback
   ```

4. Enable **Allow public client flows** if the portal shows that setting,
   then save.

At runtime the launcher binds only to `127.0.0.1` on an available ephemeral
port and sends a URI such as
`http://localhost:49152/auth/callback`. Microsoft ignores the port when
matching loopback redirects for native applications, but the scheme, host,
and `/auth/callback` path must match the registered value.

If the portal UI refuses a custom HTTP loopback URI, add it through the app
registration manifest under the native/public-client redirect URI collection.
Do not register a fixed port and do not use HTTPS for the local listener.

Do not create or configure a client secret. A desktop binary cannot protect
one, and PKCE is the required protection for this flow.

## 3. Configure the local project

From the repository root, copy `.env.example` to `.env`:

```powershell
Copy-Item .env.example .env
```

Set the application ID:

```dotenv
VITE_MICROSOFT_CLIENT_ID=00000000-0000-0000-0000-000000000000
```

The ID is public application metadata, not a secret. Never place a client
secret, access token, refresh token, authorization code, or XSTS token in
this file.

The Rust build script reads the value from `.env` for both development and
bundled builds. Restart the Tauri process after changing it.

## 4. Run and test in development

Install dependencies and launch the native application:

```powershell
npm install
npm run tauri dev
```

Then:

1. Select **Sign In** or **Manage Account**.
2. Confirm the default system browser opens a Microsoft sign-in page.
3. Sign in with a personal Microsoft account that owns Minecraft Java
   Edition.
4. Confirm the browser reports that sign-in completed and the launcher shows
   the real Minecraft username and active skin.
5. Close and reopen the launcher. The account should restore from Windows
   Credential Manager and refresh automatically when its Minecraft access
   token expires.
6. Select **Log out** and confirm the launcher returns to the grayscale
   default skin. The secure credential and cached private skin are removed.

The callback listener expires after five minutes. Cancelling the browser
prompt or letting the callback time out produces a safe UI error and stores
nothing.

## 5. Test a bundled build

Build the installer/executable with the same `.env` present:

```powershell
npm run tauri build
```

Install or run the generated Windows bundle from `src-tauri/target/release/bundle`.
Repeat the development checklist. Browser authentication must return to the
currently running bundled launcher; no development server is involved.

The client ID is compiled into that build. Rebuilding is required after
changing it.

## Minecraft Services application approval

An Entra registration alone may not be enough for a newly created launcher.
Microsoft/Xbox currently restricts Minecraft Services access to approved
application registrations. If
`https://api.minecraftservices.com/authentication/login_with_xbox` returns
HTTP 403 with an invalid-app-registration message, request access through
Microsoft's Minecraft/Xbox application-registration process referenced at
[aka.ms/AppRegInfo](https://aka.ms/AppRegInfo).

Until Microsoft approves the application ID, the Microsoft and Xbox stages
can succeed while the Minecraft Services token exchange is rejected. This
cannot be bypassed safely or by borrowing another launcher's client ID.

## Secure storage and troubleshooting

- Refresh and Minecraft tokens are stored by the Rust backend through the
  operating-system keyring (Windows Credential Manager), under service
  `dev.aster.launcher.authentication`.
- Tokens never enter React state, browser storage, console output, or normal
  application logs.
- A callback-listener error usually means local security software blocked the
  temporary loopback port.
- A restricted-account error usually requires correcting Xbox privacy, age,
  region, or family settings.
- A not-owned error means the selected Microsoft account does not have a
  Minecraft Java entitlement.
- Skin download failure does not cancel authentication; the launcher uses its
  bundled Steve fallback.

Official references:

- [Microsoft identity platform OAuth 2.0 authorization code flow](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Redirect URI restrictions and loopback applications](https://learn.microsoft.com/entra/identity-platform/reply-url)
- [Xbox services sign-in for title websites](https://learn.microsoft.com/gaming/gdk/docs/services/fundamentals/identity/signin/silentsignin-web)
