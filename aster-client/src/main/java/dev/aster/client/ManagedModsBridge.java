package dev.aster.client;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.HashMap;
import java.util.Map;

import net.minecraft.class_304;
import net.minecraft.class_310;

/**
 * Central runtime adapter registry for launcher-managed third-party modules.
 *
 * A loaded Fabric JAR cannot be removed from the JVM safely. These adapters
 * instead switch each module's observable feature off immediately and restore
 * it when enabled again.
 */
final class ManagedModsBridge {
    private static final Map<String, Boolean> LAST_REQUESTED = new HashMap<>();
    private static final Map<String, Boolean> APPLESKIN_DEFAULTS = new HashMap<>();
    private static Object dynamicLightsModeBeforeDisable;
    private static Boolean betterF3DisabledBeforeAster;

    private ManagedModsBridge() {
    }

    static void sync(AsterRuntimeSettings settings) {
        XaeroBridge.syncMinimapVisibility(settings.minimap());
        syncWorldMap(settings.worldMap());
        syncZoom(settings.zoom());
        syncBetterF3(settings.betterF3());
        syncAppleSkin(settings.appleSkin());
        syncDynamicLights(settings.dynamicLights());
    }

    private static void syncWorldMap(boolean enabled) {
        try {
            Class<?> worldMapClass = Class.forName("xaero.map.WorldMap");
            worldMapClass.getField("pauseRequests").setBoolean(null, !enabled);

            if (!enabled) {
                Class<?> controlsClass = Class.forName("xaero.map.controls.ControlsRegister");
                releaseKey(controlsClass.getField("keyOpenMap").get(null));
                releaseKey(controlsClass.getField("keyOpenSettings").get(null));

                class_310 client = class_310.method_1551();
                if (
                    client.field_1755 != null
                    && client.field_1755.getClass().getName().startsWith("xaero.map.gui.")
                ) {
                    client.method_1507(null);
                }
            }
        } catch (ReflectiveOperationException | LinkageError ignored) {
            // Optional module is absent or still initializing.
        }
    }

    private static void syncZoom(boolean enabled) {
        try {
            Class<?> zoomifyClass = Class.forName("dev.isxander.zoomify.Zoomify");
            if (!enabled) {
                for (String fieldName : new String[] {
                    "zoomKey",
                    "secondaryZoomKey",
                    "scrollZoomIn",
                    "scrollZoomOut"
                }) {
                    Field keyField = zoomifyClass.getDeclaredField(fieldName);
                    keyField.setAccessible(true);
                    releaseKey(keyField.get(null));
                }
                setStaticBoolean(zoomifyClass, "zooming", false);
                setStaticBoolean(zoomifyClass, "secondaryZooming", false);
            }
        } catch (ReflectiveOperationException | LinkageError ignored) {
            // Optional module is absent or still initializing.
        }
    }

    private static void syncBetterF3(boolean enabled) {
        if (unchanged("better_f3", enabled)) {
            return;
        }
        try {
            Class<?> optionsClass = Class.forName("me.cominixo.betterf3.config.GeneralOptions");
            Field disabledField = optionsClass.getField("disableMod");
            if (betterF3DisabledBeforeAster == null) {
                betterF3DisabledBeforeAster = disabledField.getBoolean(null);
            }
            disabledField.setBoolean(
                null,
                enabled ? betterF3DisabledBeforeAster : true
            );
            markApplied("better_f3", enabled);
        } catch (ReflectiveOperationException | LinkageError ignored) {
            // Retry after the mod finishes initialization.
        }
    }

    private static void syncAppleSkin(boolean enabled) {
        if (unchanged("apple_skin", enabled)) {
            return;
        }
        try {
            Class<?> configClass = Class.forName("squeek.appleskin.ModConfig");
            Object config = configClass.getField("INSTANCE").get(null);
            if (config == null) {
                return;
            }

            for (Field field : configClass.getFields()) {
                if (
                    field.getType() != boolean.class
                    || Modifier.isStatic(field.getModifiers())
                ) {
                    continue;
                }
                APPLESKIN_DEFAULTS.putIfAbsent(field.getName(), field.getBoolean(config));
                field.setBoolean(
                    config,
                    enabled && APPLESKIN_DEFAULTS.getOrDefault(field.getName(), true)
                );
            }
            markApplied("apple_skin", enabled);
        } catch (ReflectiveOperationException | LinkageError ignored) {
            // Retry after the mod finishes initialization.
        }
    }

    @SuppressWarnings({ "rawtypes", "unchecked" })
    private static void syncDynamicLights(boolean enabled) {
        if (unchanged("dynamic_lights", enabled)) {
            return;
        }
        try {
            Class<?> modClass = Class.forName("dev.lambdaurora.lambdynlights.LambDynLights");
            Object mod = modClass.getMethod("get").invoke(null);
            if (mod == null) {
                return;
            }

            Object config = modClass.getField("config").get(mod);
            Class<?> configClass = config.getClass();
            Class<?> modeType = Class.forName(
                "dev.lambdaurora.lambdynlights.DynamicLightsMode"
            );
            Method getMode = configClass.getMethod("getDynamicLightsMode");
            Method setMode = configClass.getMethod("setDynamicLightsMode", modeType);
            Object currentMode = getMode.invoke(config);
            Class<? extends Enum> modeClass = (Class<? extends Enum>) currentMode.getClass();
            if (dynamicLightsModeBeforeDisable == null && !"OFF".equals(currentMode.toString())) {
                dynamicLightsModeBeforeDisable = currentMode;
            }
            Object targetMode = enabled
                ? (
                    dynamicLightsModeBeforeDisable != null
                        ? dynamicLightsModeBeforeDisable
                        : Enum.valueOf(modeClass, "FANCY")
                )
                : Enum.valueOf(modeClass, "OFF");
            if (currentMode != targetMode) {
                setMode.invoke(config, targetMode);
                Field refreshField = modClass.getDeclaredField("shouldForceRefresh");
                refreshField.setAccessible(true);
                refreshField.setBoolean(mod, true);
            }
            markApplied("dynamic_lights", enabled);
        } catch (ReflectiveOperationException | LinkageError ignored) {
            // Retry after the mod finishes initialization.
        }
    }

    private static void releaseKey(Object key) {
        if (key instanceof class_304 mapping) {
            mapping.method_23481(false);
        }
    }

    private static void setStaticBoolean(
        Class<?> owner,
        String fieldName,
        boolean value
    ) throws ReflectiveOperationException {
        Field field = owner.getDeclaredField(fieldName);
        field.setAccessible(true);
        field.setBoolean(null, value);
    }

    private static boolean unchanged(String key, boolean requested) {
        return LAST_REQUESTED.get(key) == Boolean.valueOf(requested);
    }

    private static void markApplied(String key, boolean requested) {
        LAST_REQUESTED.put(key, requested);
    }
}
