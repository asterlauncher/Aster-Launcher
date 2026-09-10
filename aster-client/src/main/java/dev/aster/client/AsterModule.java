package dev.aster.client;

enum AsterModule {
    PERFORMANCE(
        "performance",
        "Performance Boost",
        "Protected Aster optimization stack",
        true,
        true
    ),
    SHADERS(
        "shaders",
        "Shader Support",
        "Iris rendering support",
        true,
        true
    ),
    COORDINATES(
        "coordinates",
        "Coordinates",
        "Shows your current position",
        false,
        false
    ),
    FPS_COUNTER(
        "fps_counter",
        "FPS Counter",
        "Displays the current frame rate",
        false,
        false
    ),
    CLOCK(
        "clock",
        "Clock",
        "Shows your local time",
        false,
        false
    ),
    SPRINT_STATUS(
        "sprint_status",
        "Sprint Status",
        "Shows when sprinting is active",
        false,
        false
    ),
    DIRECTION(
        "direction",
        "Direction HUD",
        "Displays the direction you face",
        false,
        false
    );

    final String key;
    final String displayName;
    final String description;
    final boolean defaultEnabled;
    final boolean locked;
    private boolean enabled;

    AsterModule(
        String key,
        String displayName,
        String description,
        boolean defaultEnabled,
        boolean locked
    ) {
        this.key = key;
        this.displayName = displayName;
        this.description = description;
        this.defaultEnabled = defaultEnabled;
        this.locked = locked;
        this.enabled = defaultEnabled;
    }

    boolean isEnabled() {
        return enabled;
    }

    void setEnabled(boolean enabled) {
        this.enabled = locked || enabled;
    }

    void toggle() {
        if (!locked) {
            enabled = !enabled;
            AsterModules.save();
        }
    }
}
