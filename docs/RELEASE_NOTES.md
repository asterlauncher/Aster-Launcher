# Aster Launcher 0.5.3 - Secure Social Session Hotfix

Version 0.5.3 makes the repaired Aster Social connection flow available as an
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
