package com.laujim.aptmanager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

/** Bridges the web settings to the native Android notification poller. */
@CapacitorPlugin(name = "BackgroundNotifications")
public class BackgroundNotificationsPlugin extends Plugin {
    @PluginMethod
    public void configure(PluginCall call) {
        String serverUrl = call.getString("serverUrl", "");
        String token = call.getString("token", "");
        boolean whatsapp = Boolean.TRUE.equals(call.getBoolean("whatsapp", true));
        boolean scraper = Boolean.TRUE.equals(call.getBoolean("scraper", true));
        boolean facebook = Boolean.TRUE.equals(call.getBoolean("facebook", true));
        boolean payments = Boolean.TRUE.equals(call.getBoolean("payments", false));
        boolean sound = Boolean.TRUE.equals(call.getBoolean("sound", true));
        if (serverUrl.trim().isEmpty() || token.trim().isEmpty()) {
            call.reject("El servidor y la sesión son obligatorios para las notificaciones.");
            return;
        }
        BackgroundNotificationService.configure(getContext(), serverUrl.trim(), token.trim(), whatsapp, scraper, facebook, payments, sound);
        call.resolve(status());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        BackgroundNotificationService.stop(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    private JSObject status() {
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("enabled", BackgroundNotificationService.enabled(getContext()));
        result.put("running", BackgroundNotificationService.running());
        result.put("lastSeenAt", BackgroundNotificationService.lastSeenAt(getContext()));
        return result;
    }
}
