package dev.aster.client;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import net.minecraft.class_310;
import net.minecraft.class_332;
import net.minecraft.class_746;

final class AsterHud {
    private static final DateTimeFormatter CLOCK_FORMAT = DateTimeFormatter.ofPattern("HH:mm");

    private AsterHud() {
    }

    static void render(class_332 context, float tickDelta) {
        class_310 client = class_310.method_1551();
        class_746 player = client.field_1724;
        if (player == null || client.field_1687 == null) {
            return;
        }

        List<String> lines = new ArrayList<>();
        if (AsterModule.COORDINATES.isEnabled()) {
            lines.add(String.format(
                Locale.ROOT,
                "XYZ  %.1f  %.1f  %.1f",
                player.method_23317(),
                player.method_23318(),
                player.method_23321()
            ));
        }
        if (AsterModule.FPS_COUNTER.isEnabled()) {
            lines.add(client.method_47599() + " FPS");
        }
        if (AsterModule.CLOCK.isEnabled()) {
            lines.add("TIME  " + LocalTime.now().format(CLOCK_FORMAT));
        }
        if (AsterModule.SPRINT_STATUS.isEnabled()) {
            lines.add(player.method_5624() ? "SPRINTING" : "WALKING");
        }
        if (AsterModule.DIRECTION.isEnabled()) {
            lines.add("FACING  " + directionFor(player.method_36454()));
        }
        if (lines.isEmpty()) {
            return;
        }

        int y = 7;
        int screenWidth = client.method_22683().method_4486();
        for (String line : lines) {
            int width = client.field_1772.method_1727(line);
            int x = Math.max(7, screenWidth - width - 11);
            context.method_25294(x - 3, y - 2, x + width + 4, y + 11, 0xB0100C16);
            context.method_25294(x - 3, y - 2, x - 1, y + 11, 0xFF9C55D9);
            context.method_51433(client.field_1772, line, x, y, 0xFFF4ECFF, true);
            y += 15;
        }
    }

    private static String directionFor(float yaw) {
        int index = Math.floorMod((int) Math.floor((yaw / 90.0F) + 0.5F), 4);
        return switch (index) {
            case 0 -> "SOUTH";
            case 1 -> "WEST";
            case 2 -> "NORTH";
            default -> "EAST";
        };
    }
}
