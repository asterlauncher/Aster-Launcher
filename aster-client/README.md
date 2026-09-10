# Aster Client 1.20.1

This is the protected client-side companion mod for the official
`Aster 1.20.1` launcher profile.

It currently:

- provides the protected Aster performance and shader stack;
- renders the launcher-managed HUD modules;
- reloads module settings live while Minecraft is running;
- lets the launcher manage optional map, zoom, debug, food and lighting modules;
- stays hidden from the normal instance-content list.

The sources intentionally compile against Fabric's intermediary Minecraft
names. This lets the launcher build the production JAR from the exact local
Minecraft 1.20.1 runtime without depending on a separate Gradle installation.

Run `build.ps1` after Aster 1.20.1 has been launched once. The script locates
the Mojang Java 17 runtime, Fabric API and the remapped Minecraft client in the
local Aster data directory.
