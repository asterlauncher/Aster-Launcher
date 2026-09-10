# Aster Social setup

Aster Launcher 0.7.0 stores Aster accounts, friends and chat in the existing Supabase project.
Before testing it with multiple launchers:

1. Open the Supabase project.
2. Keep the **Email** provider enabled under Authentication. Choose whether
   email confirmation is required for your test group. Keep **Allow anonymous
   sign-ins** enabled during the 0.7.0 migration window so existing closed-alpha
   installations can upgrade their old identity in place.
3. Open the SQL editor.
4. Paste and run only the complete
   [`supabase/social.sql`](../supabase/social.sql) file. It is the canonical
   all-in-one backend setup for Auth compatibility, Presence, Social, Chat,
   Gifts and Aster Credits. Re-run that same file after a backend update.
   The migration is repeatable: it keeps friendships, messages, wallets and
   gifts while upgrading functions, policies and private storage.
5. Start the native launcher with the existing `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` values.
6. Register or sign in through the account menu in Aster's top bar, then open
   **Your Friends** once. Aster names then become searchable. Microsoft sign-in
   remains separate under Minecraft -> Manage Account.

## Shared Worlds

Shared Worlds has one additional, repeatable migration:

1. Open **Supabase -> SQL Editor -> New query**.
2. Paste and run the complete
   [`supabase/shared-worlds.sql`](../supabase/shared-worlds.sql) file once.
3. Confirm that the private `shared-worlds` Storage bucket and the
   `shared_worlds`, `shared_world_members`, `shared_world_revisions`, and
   `shared_world_host_leases` tables exist.
4. Restart Aster and open **Your Friends -> Shared Worlds**.

Shared Worlds only permits existing Aster friends. Owners can grant **Play**,
**Can host**, or **Manage** access. A short server-side lease guarantees that
only one friend can host a world at a time. Aster creates a revision before
sharing, verifies and restores it into a staging folder, backs up any existing
local copy, and publishes a new encrypted revision automatically after hosting
stops. The world archive never replaces a local save before its structure and
integrity have been validated.

## Security model

- Supabase Auth owns email/password credentials; the launcher stores only its
  refreshable session, encrypted with Windows DPAPI in native builds.
- Existing anonymous closed-alpha identities are upgraded instead of replaced,
  preserving the same auth UUID and every row attached to it.
- Aster names containing underscores are searched literally through a
  restricted database function.
- If Windows loses an unused anonymous identity during an upgrade, its inactive
  profile can be reclaimed after two minutes. Friends, requests, messages,
  Aster Credits, gifts, Shared Worlds, and BTD6 submissions move atomically to
  the restored identity instead of permanently blocking the Minecraft account.
- A genuinely active second launcher remains protected: recovery is refused
  while the previous profile heartbeat is newer than two minutes.
- Microsoft/Minecraft credentials are not attached to the Aster login and are
  only used for Minecraft ownership, profile, skin, and launching.
- Row-level security limits requests, friendships, and messages to their
  participants.
- Friend state transitions use server-side database functions.
- Messages are limited to 500 characters.
- Screenshots and modpack archives live in a private Storage bucket.
- Storage policies only allow friendship members to read a chat attachment.
- Shared-world archives live in a separate private bucket and are encrypted
  locally before upload. Database policies restrict metadata and signed upload
  URLs to the owner and explicitly selected friends.
- Shared-world host leases expire automatically if a launcher disappears, so a
  crashed host cannot permanently lock the world.
- Upload paths bind the friendship and sender IDs, and all selected files are
  validated again by the native launcher before upload.
- Screenshots support PNG, JPG, JPEG, and WebP up to 12 MB. Modpacks support
  ZIP and MRPACK archives up to 250 MB. The Supabase project may enforce a
  lower plan-wide upload limit.

For closed-alpha testing this keeps game ownership and launcher community
identity independent. Before a broad public release, add abuse controls such as
email rate limits, username-change rules, moderation audit logs, and verified
ownership for the permanent `synoi` administrator identity.
