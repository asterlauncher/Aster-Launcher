# Aster Launcher 0.7.9 - Unified Minecraft Hero

Version 0.7.9 extends the Minecraft hero artwork and shade across the complete
feature row, including behind the account card. The account controls stay clear
on a lightly translucent, blurred surface.

## Previous release

# Aster Launcher 0.7.8 - Clean Sidebar Logo

Version 0.7.8 removes the small game-status square from the shared Aster logo
in the sidebar. It is now gone consistently across every tab and game view.

## Previous release

# Aster Launcher 0.7.7 - Compact Game Library

Version 0.7.7 tightens the scalable game library into a smaller window and
removes its content filters, footer status strip and redundant eyebrow label.
Search, scrolling and active-game states remain available for large libraries.

## Previous release

# Aster Launcher 0.7.6 - Scalable Game Library

Version 0.7.6 replaces the compact game selector with a full, searchable and
filterable library designed to remain clear as Aster grows to hundreds of games.
Existing games keep their isolated profiles, mods and files, while unfinished
game workspaces remain hidden.

The previous 0.7.5 release redesigned the BTD6 modded-launch warning with Aster's compact
purple panels, clearer safety cards and a cleaner confirmation state. The
required acknowledgement and fresh DLL scan still run before every launch.

## Previous release

# Aster Launcher 0.7.4 - Upcoming Games Hidden

Version 0.7.4 temporarily hides Sprocket and Battlefront II from the game
selector while keeping their existing pages, services and native support intact.

## Previous release

# Aster Launcher 0.7.3 - Creator Mod Updates

Version 0.7.3 adds an Update button beside Install for a creator's own approved
BTD6 mods. The existing metadata is prefilled, a replacement DLL is rescanned,
and an optional replacement icon can be selected. Updated mods return to the
private moderation queue before the new version becomes public.

## Previous release

# Aster Launcher 0.7.2 - Owner Name Update

Version 0.7.2 changes the protected Aster owner identity from `synoi_` to
`synoi`. The launcher UI, BTD6 moderation copy, and repeatable Supabase admin
setup now use the same name.

## Previous release

# Aster Launcher 0.7.1 - Existing Email Recovery

Version 0.7.1 repairs registration when Supabase reports that an email already
exists. The launcher now attempts to restore that account with the entered
password, updates its Aster name, and signs in without making the player switch
forms manually. If email confirmation is still pending, Aster requests a new
confirmation email and explains the exact next step.

## Previous release

# Aster Launcher 0.7.0 - Separate Aster Accounts

Version 0.7.0 introduces Aster accounts with email and password. The account in
the top bar now owns Aster-wide features such as friends, chat, Credits,
community mods, shared modpacks, and shared worlds. Microsoft authentication is
kept separate and is only used by Minecraft for ownership, profile, skin, and
launching the game.

Existing anonymous Aster Social identities are upgraded in place during
registration, preserving their UUID and therefore their friends, messages,
gifts, submissions, and shared content. Sessions continue to be encrypted with
Windows DPAPI in the native launcher. Supabase handles password storage and
reset emails; Aster never stores raw passwords.

## Previous release

# Aster Launcher 0.6.8 - BTD6 Browser Cleanup

Version 0.6.8 removes the Community and Managing cards from the BTD6 sidebar,
keeps its runtime tool buttons, makes BTD6 Status collapsible, and adds a
working All mods / Your mods catalog filter.

## Previous release

# Aster Launcher 0.6.7 - BTD6 Catalog Polish

Version 0.6.7 adds the uploader's Minecraft name above each community mod,
shows the public mod title separately from its gray DLL filename inside a
modpack, and removes the redundant Aster Game Support label from BTD6 Home.

## Previous release

# Aster Launcher 0.6.6 - BTD6 Approval Settings

Version 0.6.6 moves the owner-only BTD6 community approval queue out of the
Minecraft settings and into the Bloons TD 6 settings. The moderation section
remains visible only to the verified `synoi` owner account.

## Previous release

# Aster Launcher 0.6.5 - BTD6 Add File Fix

Version 0.6.5 makes the BTD6 Install and Installed actions visibly green and
fixes local Add File imports disappearing from their selected modpack while the
launcher refreshes its DLL inventory.

## Previous release

# Aster Launcher 0.6.4 - Pack-Specific Install Status

Version 0.6.4 replaces the BTD6 community Manage action with a clear green
Install button. After the selected version has been added to the currently
selected modpack, that same card reads Installed. Switching modpacks calculates
the state again for that pack instead of treating the DLL as globally installed.

## Previous release

# Aster Launcher 0.6.3 - BTD6 Modpack Management

Version 0.6.3 makes Bloons TD 6 community downloads work through isolated
modpacks instead of one global mod list.

- Adds a Minecraft-style create-modpack dialog with a custom icon, profile
  name, fixed game, and MelonLoader details.
- Replaces Install with Manage and lets the player choose which BTD6 modpack
  receives a community or local DLL.
- Shows only the DLLs that actually belong to the opened modpack.
- Removes the redundant selection and Add/Remove controls from modpack rows.
- Simplifies community cards by removing approval, download, and file-size
  metadata.
- Keeps newly added DLLs disabled until their selected modpack is launched and
  prevents enabled/disabled duplicate files.

## Previous release

# Aster Launcher 0.6.2 - Social Session Recovery

Version 0.6.2 repairs Minecraft profiles that remained attached to a lost
anonymous Aster Social identity while preserving their Social data.

## Previous release

# Aster Launcher 0.5.5 - Aster Host

Version 0.5.5 introduces local world hosting directly from your own PC.

- Host existing Vanilla and Fabric worlds from an Aster instance.
- Synchronize the instance's enabled mods into a hidden dedicated server.
- Configure player slots, memory, and the local server port.
- Copy the LAN address or open the free internet-tunnel setup.
- Export the matching modpack so friends can install the same content.
- Detect early server crashes instead of reporting a false running state.
The launcher now starts the generated NSIS installer in its dedicated update
mode, waits for it to finish, and only then opens the installed application
again. Installer failures survive the restart and are displayed instead of
being hidden.

It also includes every fix from 0.5.3, which makes the repaired Aster Social
connection flow available as an
immutable public patch release.

- Existing valid Social sessions are restored before anonymous sign-in cooldowns are checked.
- Social sessions are encrypted with Windows DPAPI so launcher updates cannot lose them.
- Duplicate profile heartbeats and database requests are reduced.
- Minecraft usernames containing underscores can be searched correctly.
- Player search now uses a safe database function with online-first results.
- Unused stale installer identities can be reclaimed without touching friendships or chats.
- The Friends page now offers an in-place Retry action after connection errors.

Run the updated `supabase/social.sql` migration once in the Supabase SQL editor before testing.

## Previous release

# Aster Launcher 0.5.2 - Social Reliability Hotfix

Version 0.5.2 introduced safer player search, reduced duplicate Social
requests, and added in-place retry handling. Version 0.5.3 supersedes it with
update-safe encrypted session persistence.

## Previous release

# Aster Launcher 0.5.1 - Social Sharing & Public Build Fix

Version 0.5.1 makes the Aster Social foundation ready for external testers.

- Select one of your installed modpacks directly from the chat attachment menu.
- Let Aster export and upload the selected pack without choosing an archive.
- Install a received modpack into My Modpacks with one click.
- Follow received-pack downloads and installation failures in the download
  center.
- Sign in with Microsoft from the public installer without a local `.env`
  developer file.
- Connect to Aster Social and live presence from public tester builds.

Shared modpacks remain private between the two friends and are downloaded
through short-lived signed links. Imported packs retain their included files
and appear as ready instances in My Modpacks.

This closed-alpha build is available for public testing. Minecraft: Java
Edition must be owned separately.
Cosmetics, Aster Credits, and the Aster Subscription remain previews and are
not available for purchase.
