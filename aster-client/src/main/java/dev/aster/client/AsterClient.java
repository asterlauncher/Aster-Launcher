package dev.aster.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;

public final class AsterClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        AsterModules.load();
        ClientTickEvents.END_CLIENT_TICK.register(client -> AsterModules.reloadIfChanged());
        HudRenderCallback.EVENT.register(AsterHud::render);
    }
}
