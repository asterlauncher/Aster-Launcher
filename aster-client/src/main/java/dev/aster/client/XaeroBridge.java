package dev.aster.client;

import java.lang.reflect.Field;
import java.lang.reflect.Method;

/**
 * Keeps launcher-managed Xaero visibility in sync without introducing a hard
 * compile-time dependency on Xaero's implementation classes.
 */
final class XaeroBridge {
    private static Field hudModInstanceField;
    private static Method getSettingsMethod;
    private static Method getMinimapMethod;
    private static Object toggleMapFunction;
    private static Method togglePressMethod;
    private static Method toggleReleaseMethod;
    private static boolean reflectionReady;

    private XaeroBridge() {
    }

    static void syncMinimapVisibility(boolean requestedVisible) {
        try {
            prepareReflection();
            Object hudMod = hudModInstanceField.get(null);
            if (hudMod == null) {
                return;
            }

            Object settings = getSettingsMethod.invoke(hudMod);
            if (settings == null) {
                return;
            }

            boolean currentlyVisible = (Boolean) getMinimapMethod.invoke(settings);
            if (currentlyVisible == requestedVisible) {
                return;
            }

            togglePressMethod.invoke(toggleMapFunction);
            toggleReleaseMethod.invoke(toggleMapFunction);
        } catch (ReflectiveOperationException | LinkageError ignored) {
            // Xaero is optional and may not have finished initializing yet.
        }
    }

    private static void prepareReflection() throws ReflectiveOperationException {
        if (reflectionReady) {
            return;
        }

        Class<?> hudModClass = Class.forName("xaero.common.HudMod");
        Class<?> settingsClass = Class.forName("xaero.common.settings.ModSettings");
        Class<?> functionsClass = Class.forName(
            "xaero.hud.minimap.controls.key.function.MinimapKeyMappingFunctions"
        );

        hudModInstanceField = hudModClass.getField("INSTANCE");
        getSettingsMethod = hudModClass.getMethod("getSettings");
        getMinimapMethod = settingsClass.getMethod("getMinimap");
        toggleMapFunction = functionsClass.getField("TOGGLE_MAP").get(null);
        togglePressMethod = toggleMapFunction.getClass().getMethod("onPress");
        toggleReleaseMethod = toggleMapFunction.getClass().getMethod("onRelease");
        reflectionReady = true;
    }
}
