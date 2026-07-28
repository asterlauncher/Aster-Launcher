# Live launcher presence

Aster Launcher counts open installations using a random local UUID and a
restricted Supabase database function. No Supabase Auth user, Minecraft
username, Microsoft token, skin, or device name is written to the presence
table.

## One-time free setup

1. Create a Supabase Free project at <https://supabase.com/dashboard>.
2. Open **SQL Editor → New query**.
3. Paste and run [`supabase/presence.sql`](../supabase/presence.sql).
4. Open the project's **Connect** dialog or **Settings → API Keys**.
5. Copy the Project URL and the **Publishable key**. Never use a Secret or
   `service_role` key in the launcher.
6. Add these values to the local `.env` file:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
   ```

7. Rebuild the launcher:

   ```powershell
   npm.cmd run tauri build
   ```

## How counting works

- A launcher creates one random local UUID and sends a heartbeat every 30
  seconds.
- The database stores one row per running launcher installation.
- A launcher is counted while its last heartbeat is less than 90 seconds old.
- A clean app shutdown removes its row immediately when possible.
- Crashed, disconnected, or forcibly closed launchers expire automatically.
- No Supabase Auth account is created, so presence does not consume monthly
  active Auth users.
- The SQL revokes direct table access. Clients can only call the two narrowly
  scoped presence functions.

The Supabase publishable key is intentionally public and is suitable for
desktop apps. Do not put a Supabase Secret or `service_role` key in `.env`,
source code, an executable, or an installer.
