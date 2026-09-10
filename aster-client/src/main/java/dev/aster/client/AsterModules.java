package dev.aster.client;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Properties;

import net.fabricmc.loader.api.FabricLoader;

final class AsterModules {
    private static final String CONFIG_SCHEMA = "2";
    private static final int RELOAD_INTERVAL_TICKS = 2;
    private static final Path CONFIG_PATH = FabricLoader
        .getInstance()
        .getConfigDir()
        .resolve("aster-client.properties");
    private static long loadedFingerprint = Long.MIN_VALUE;
    private static int ticksUntilReload;
    private static AsterRuntimeSettings runtimeSettings = new AsterRuntimeSettings(
        false,
        false,
        false,
        false,
        false,
        false
    );

    private AsterModules() {
    }

    static void load() {
        Properties properties = new Properties();
        if (Files.isRegularFile(CONFIG_PATH)) {
            try (InputStream input = Files.newInputStream(CONFIG_PATH)) {
                properties.load(input);
            } catch (Exception ignored) {
                // Invalid local preferences fall back to safe defaults.
            }
        }

        boolean currentSchema = CONFIG_SCHEMA.equals(properties.getProperty("schema"));
        for (AsterModule module : AsterModule.values()) {
            if (module.locked) {
                module.setEnabled(true);
                continue;
            }
            module.setEnabled(
                currentSchema
                    && Boolean.parseBoolean(properties.getProperty(module.key, "false"))
            );
        }
        runtimeSettings = AsterRuntimeSettings.from(properties, currentSchema);
        if (!currentSchema) {
            save();
        } else {
            loadedFingerprint = configFingerprint();
        }
    }

    static void reloadIfChanged() {
        if (ticksUntilReload > 0) {
            ticksUntilReload--;
            return;
        }
        ticksUntilReload = RELOAD_INTERVAL_TICKS;

        long fingerprint = configFingerprint();
        if (fingerprint != loadedFingerprint) {
            load();
        }
        ManagedModsBridge.sync(runtimeSettings);
    }

    static void save() {
        Properties properties = new Properties();
        properties.setProperty("schema", CONFIG_SCHEMA);
        for (AsterModule module : AsterModule.values()) {
            if (!module.locked) {
                properties.setProperty(module.key, Boolean.toString(module.isEnabled()));
            }
        }

        try {
            Files.createDirectories(CONFIG_PATH.getParent());
            try (OutputStream output = Files.newOutputStream(CONFIG_PATH)) {
                properties.store(output, "Aster Client 1.20.1");
            }
            loadedFingerprint = configFingerprint();
        } catch (Exception ignored) {
            // A read-only config directory must never prevent Minecraft from running.
        }
    }

    private static long configFingerprint() {
        try {
            if (!Files.isRegularFile(CONFIG_PATH)) {
                return -1L;
            }
            long modified = Files.getLastModifiedTime(CONFIG_PATH).toMillis();
            return (modified * 31L) ^ Arrays.hashCode(Files.readAllBytes(CONFIG_PATH));
        } catch (Exception ignored) {
            return Long.MIN_VALUE;
        }
    }
}
