# Aster Launcher version history

## 0.7.9 — Unified Minecraft Hero

- Extended the Minecraft background across the entire feature row.
- Added the same artwork behind the account card and removed the black split.
- Kept account controls readable with a translucent blurred panel.

## 0.7.8 — Clean Sidebar Logo

- Removed the small game-status square below the Aster logo.
- Applied the change to the shared sidebar so every tab stays consistent.

## 0.7.7 — Compact Game Library

- Reduced the game library window and card dimensions.
- Removed the All games, Modpacks and Mods filter buttons.
- Removed the footer status strip and redundant Aster Library eyebrow.
- Preserved search, scrolling and active-game states.

## 0.7.6 — Scalable Game Library

- Replaced the fixed game list with a responsive card grid.
- Added game search and Mods/Modpacks filters.
- Added active-game, readiness, count and empty-result states.
- Preserved the hidden Sprocket and Battlefront II workspaces.

## 0.7.5 — BTD6 Safety Dialog Refresh

- Reworked the modded-launch warning to match Aster's compact purple interface.
- Kept the risk explanation, repeat confirmation and pre-launch security scan intact.

## 0.7.4 — Upcoming Games Hidden

- Temporarily hides Sprocket and Battlefront II from the game selector.
- Keeps both implementations intact so they can be enabled again when ready.

## 0.7.3 — Creator Mod Updates

- Mod creators now see an Update button beside Install on their own approved BTD6 mods.
- Replacement DLLs are rescanned and returned to pending moderation before publication.
- Existing icons are retained unless the creator deliberately chooses a replacement.

## 0.7.2 — Owner Name Update

- Changed the protected owner identity from `synoi_` to `synoi` across the launcher and Supabase setup.

## 0.7.1 — Existing Email Recovery

- Registration now restores an already-created Aster account when the same password is entered.
- Pending accounts receive a fresh confirmation email and a useful status message.
- Wrong-password duplicate registrations automatically switch back to the Sign in view.

## 0.7.0 — Separate Aster Accounts

- Added native Aster email/password authentication and separated it from Minecraft Microsoft authentication.
- Migrates the existing anonymous Social identity in place so community data remains intact.
- Aster-wide social, Credits, BTD6 catalog and sharing features now use the Aster account shown in the top bar.

## 0.6.8 — BTD6 Browser Cleanup

- Removed the Community information and Managing cards from the right sidebar.
- Made the BTD6 Status panel properly collapsible.
- Added All mods and Your mods filtering to the catalog filter button.

## 0.6.7 — BTD6 Catalog Polish

- Added a compact gray creator name above BTD6 community mod titles.
- Uses the catalog mod name in white and keeps the physical DLL name gray in packs.
- Removed the Aster Game Support kicker from the BTD6 home artwork.

## 0.6.6 — BTD6 Approval Settings

- Removed BTD6 mod approval from the Minecraft settings.
- Added the same owner-only approval and deletion queue to BTD6 settings.
- Kept launcher settings available alongside BTD6 moderation.

## 0.6.5 — BTD6 Add File Fix

- Enforced the green BTD6 Install and Installed button styling.
- Fixed the refresh race that removed a newly imported local DLL from its pack.
- Refreshes the physical DLL inventory before committing pack membership.

## 0.6.4 — Pack-Specific Install Status

- Replaced Manage with a green Install action in the BTD6 community catalog.
- Shows Installed only when the exact mod version belongs to the selected pack.
- Recalculates the button independently whenever the target modpack changes.

## 0.6.3 — BTD6 Modpack Management

- Added a Minecraft-style BTD6 modpack creation dialog with custom icons.
- Changed community installation into per-modpack management.
- Limited each pack manager to the DLLs actually contained in that pack.
- Removed redundant community metadata and pack membership controls.
- Added safer disabled-first DLL downloads and duplicate-file cleanup.

## 0.6.2 — Social Session Recovery

- Added automatic recovery for Minecraft profiles left on an inactive anonymous
  Social identity.
- Preserved Social, gift, Shared World, owner, and BTD6 community data during
  identity migration.
- Kept active-session collision protection and UUID-based ownership checks.

## 0.5.5 — Aster Host

- Added local dedicated world hosting for Vanilla and Fabric instances.
- Added mod synchronization, LAN connection details, modpack sharing, and free tunnel guidance.
- Added reliable startup detection, stop controls, and host crash reporting.

## 0.5.4 — Reliable In-Launcher Updates

- Fixed Windows updates silently running the NSIS installer outside update mode.
- Relaunches the installed launcher only after the update installer finishes.
- Persists installer failures across restart so the launcher can show the real
  error instead of appearing to do nothing.
- Retains the secure Social session and player-search fixes from 0.5.3.

## 0.5.3 — Secure Social Session Hotfix

- Added Windows DPAPI backup storage for Social refresh sessions.
- Preserved the same Social identity across installer updates.
- Reduced the anonymous sign-in cooldown to match the server token bucket.
- Retained the 0.5.2 player-search, request-caching, and retry improvements.

## 0.5.2 — Social Reliability Hotfix

- Fixed Social sessions being blocked by a previous anonymous sign-in cooldown.
- Added encrypted Windows storage for Social sessions across launcher updates.
- Reduced unnecessary profile synchronization requests.
- Fixed searches for Minecraft names containing underscores.
- Added safe online-first player search and stale empty-profile recovery.
- Added a Retry action to Social connection errors.

## 0.5.1 — Social Sharing & Public Build Fix

- Added direct selection of owned instances when sharing a modpack in chat.
- Added automatic temporary export and private upload of shared modpacks.
- Added one-click installation of received modpacks into My Modpacks.
- Added download-center progress and clear installation feedback for received
  packs.
- Fixed Microsoft sign-in being unconfigured in public GitHub builds.
- Bundled the public Aster Social and presence configuration for tester builds.

## 0.5.0 — Aster Social

- Added player search by exact Minecraft username, friend requests, online
  presence, and private conversations.
- Added screenshot and modpack attachments with private signed downloads.
- Redesigned notifications, desktop toasts, and the Settings control center.
- Added persistent update, notification, presence, motion, storage, and privacy
  preferences.
- Added configurable Minecraft memory from 2–24 GB and passed the selected
  value to every Java launch.
- Improved signed update discovery and recovery through GitHub Releases.

## 0.4.8 — Closed Alpha Quality Update

- Added current Minecraft releases to instance creation with a live Mojang
  version source and reliable fallback list.
- Refreshed the active account skin automatically.
- Fixed stale launcher-update progress after reopening the app.
- Simplified compact sorting controls and improved related launcher polish.
- Added the matching Aster website, direct installer delivery, current
  launcher preview, and legal information.

## 0.4.7 — Closed Alpha Foundation Update

- Consolidated the complete launcher foundation into a stable closed-alpha
  build.
- Added Microsoft, Xbox, and Minecraft authentication with ownership checks.
- Added real Minecraft launching for Vanilla, Fabric, and Forge instances.
- Added Modrinth and CurseForge discovery and supported required dependencies.
- Added modpack import/export, custom icons, persistent downloads, live
  presence, notifications, and signed launcher updates.
- Improved Forge setup, Windows integration, export reliability, layout, and
  background processes.

## 0.4.6 — Packaging & Distribution

- Prepared Windows installer and Microsoft Store package workflows.
- Added reproducible GitHub Actions release builds.
- Improved taskbar assets and Windows package metadata.

## 0.4.5 — Native Windows Polish

- Introduced the current Aster launcher icon and native window presentation.
- Improved sidebar alignment, responsive sizing, and compact launcher spacing.
- Reduced visible background console windows during launcher operations.

## 0.4.4 — Safety & Live Presence

- Added anonymous live launcher presence counting.
- Added local file safety checks and Microsoft Defender integration.
- Replaced temporary alerts with the persistent notification system.

## 0.4.3 — Downloads & Modpack Sharing

- Added the top-bar download center with progress and queue history.
- Added scrollable download and notification panels.
- Added modpack import and export for sharing player-created instances.

## 0.4.2 — Forge Support

- Added Forge instance creation and loader installation.
- Added diagnostics for incompatible Java, Minecraft, loader, and mod
  combinations.
- Improved Forge crash reporting and launch preparation.

## 0.4.1 — Dependencies & Install State

- Persisted installed content state between discovery sessions.
- Added automatic installation of supported required mod dependencies.
- Added player-selected icons for custom modpacks.
- Improved download state recovery and instance content metadata.

## 0.4.0 — Real Minecraft Launching

- Added Microsoft OAuth with PKCE and secure local account storage.
- Added Xbox/XSTS and Minecraft authentication plus Java Edition ownership
  verification.
- Added Java and Minecraft file preparation and the first real game launch.
- Added the signed in-launcher updater foundation.

## 0.3.0 — Instance Management

- Added player-created Vanilla and Fabric instances.
- Added content, worlds, screenshots, instance-folder, duplicate, and delete
  management.
- Added persistent instance metadata and launcher-ready states.

## 0.2.0 — Mod & Modpack Discovery

- Added Modrinth and CurseForge browsing.
- Added Minecraft-version, loader, category, and sort filters.
- Added release selection, load-more behavior, and installation dialogs.
- Added the account-management and player-preview foundation.

## 0.1.0 — UI Prototype

- Established the original premium dark desktop-launcher design.
- Added Home, My Modpacks, discovery, downloads, accounts, and settings pages.
- Added reusable navigation, modal, notification, loading, empty, installing,
  updating, launching, offline, authentication, Java, failure, and conflict
  states.
