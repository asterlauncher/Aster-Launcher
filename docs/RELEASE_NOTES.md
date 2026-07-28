# Aster Launcher 0.5.0 - Aster Social

Version 0.5.0 begins the launcher’s social foundation.

- Add Aster players by their exact Minecraft username.
- Send, accept, decline, and cancel friend requests.
- See which friends currently have Aster Launcher open.
- Open persistent private conversations from the Friends hub.
- Receive launcher notifications for new requests and chat messages.
- Use the redesigned notification center and animated desktop toasts.
- Configure updates, notifications, presence, motion, storage, and privacy in
  the redesigned Aster Control Center.
- Choose 2–24 GB of Minecraft memory; the selected value is passed to Java for
  every game launch.
- Recover launcher updates through GitHub’s Releases API and manual fallback.

The Social database uses persistent anonymous Supabase sessions and strict
row-level access policies. Each launcher only sees its own requests,
friendships, and friendship messages.

This closed-alpha build is available for public testing. Minecraft: Java
Edition must be owned separately, and social features require the Aster
Supabase service to be available.
Cosmetics, Aster Credits, and the Aster Subscription remain previews and are
not available for purchase.
