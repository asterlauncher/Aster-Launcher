# Bloons TD 6 support

Aster detects the Steam installation (`app 960090`) and offers two launch paths:

- **Vanilla:** starts without Aster's managed mod runtime.
- **Modded:** scans every enabled DLL, verifies the private runtime and requires a new account-risk acknowledgement before every launch.

## Runtime

Aster uses the BTD6 Mod Helper recommended MelonLoader release (`0.7.2`). The runtime is downloaded from the official LavaGang GitHub release, checked against GitHub's SHA-256 asset digest, scanned with Microsoft Defender and stored under Aster's application data. The bridge files are activated only for the running game session and removed again after the game exits.

The current official `Btd6ModHelper.dll` is downloaded from the `gurrenm3/BTD-Mod-Helper` GitHub release. It receives the same digest and Defender checks.

## Local mod import

Only Windows PE DLLs up to 256 MB are accepted. A selected file is copied to quarantine first, then checked for:

1. a valid PE header and safe size;
2. SHA-256 identity;
3. suspicious process, network and injection capabilities;
4. a clean Microsoft Defender result.

Enabled mods are scanned again immediately before every modded launch. A clean result lowers malware risk but cannot prove that a mod is harmless or allowed by Ninja Kiwi.

## Community submissions

Run [`supabase/btd6-mod-submissions.sql`](../supabase/btd6-mod-submissions.sql) once after the Aster Social SQL. The script creates a private storage bucket and a row-level-secured review queue.

The **Submit mod** action uploads only the exact quarantined copy that passed scanning. The native uploader rechecks its hash and runs Defender again immediately before upload. New submissions remain private with status `pending`; moderation must approve them separately before any future catalog can distribute them.

## Account warning

The warning is intentionally not rememberable. Closing it cancels launch. Even if the UI were bypassed, the native `launch_btd6` command rejects every modded start without a fresh acknowledgement.
