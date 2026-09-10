package dev.aster.client;

import java.util.Properties;

record AsterRuntimeSettings(
    boolean minimap,
    boolean worldMap,
    boolean zoom,
    boolean betterF3,
    boolean appleSkin,
    boolean dynamicLights
) {
    static AsterRuntimeSettings from(Properties properties, boolean validSchema) {
        return new AsterRuntimeSettings(
            enabled(properties, validSchema, "minimap"),
            enabled(properties, validSchema, "world_map"),
            enabled(properties, validSchema, "zoom"),
            enabled(properties, validSchema, "better_f3"),
            enabled(properties, validSchema, "apple_skin"),
            enabled(properties, validSchema, "dynamic_lights")
        );
    }

    private static boolean enabled(
        Properties properties,
        boolean validSchema,
        String key
    ) {
        return validSchema && Boolean.parseBoolean(properties.getProperty(key, "false"));
    }
}
