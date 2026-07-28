# Aster Social setup

Aster Launcher 0.5.0 stores friends and chat in the existing Supabase project.
Before testing it with multiple launchers:

1. Open the Supabase project.
2. Keep **Allow anonymous sign-ins** enabled under Authentication.
3. Open the SQL editor.
4. Paste and run the complete [`supabase/social.sql`](../supabase/social.sql)
   file once. Run the updated file again after installing a build that adds
   chat attachments; it safely upgrades the existing tables and creates the
   private `chat-attachments` bucket.
5. Start the native launcher with the existing `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` values.
6. Sign in to Minecraft, open **Your Friends**, and let every test player do
   the same once. Their Minecraft names then become searchable.

## Security model

- Supabase creates one persistent anonymous identity per launcher installation.
- The active Minecraft profile ID and name are attached to that identity.
- Row-level security limits requests, friendships, and messages to their
  participants.
- Friend state transitions use server-side database functions.
- Messages are limited to 500 characters.
- Screenshots and modpack archives live in a private Storage bucket.
- Storage policies only allow friendship members to read a chat attachment.
- Upload paths bind the friendship and sender IDs, and all selected files are
  validated again by the native launcher before upload.
- Screenshots support PNG, JPG, JPEG, and WebP up to 12 MB. Modpacks support
  ZIP and MRPACK archives up to 250 MB. The Supabase project may enforce a
  lower plan-wide upload limit.

For closed-alpha testing this is functional and isolates normal launcher users.
Before a broad public release, add a server-side identity verification step
that validates each Minecraft session with Microsoft/Minecraft before binding
the Minecraft profile to the Supabase identity. This prevents a modified client
from attempting to claim another Minecraft name.
