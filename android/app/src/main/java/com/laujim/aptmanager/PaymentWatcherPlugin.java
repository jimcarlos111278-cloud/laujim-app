package com.laujim.aptmanager;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

/** Configures the explicit Android notification-access bridge for payment events. */
@CapacitorPlugin(name = "PaymentWatcher")
public class PaymentWatcherPlugin extends Plugin {
    @PluginMethod public void configure(PluginCall call) {
        String serverUrl = call.getString("serverUrl", "");
        String token = call.getString("token", "");
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        if (serverUrl.trim().isEmpty() || token.trim().isEmpty()) { call.reject("El servidor y la sesión son obligatorios."); return; }
        getContext().getSharedPreferences(PaymentNotificationListenerService.PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("enabled", enabled).putString("serverUrl", serverUrl.replaceAll("/+$", "")).putString("token", token).apply();
        call.resolve(status());
    }

    @PluginMethod public void stop(PluginCall call) {
        getContext().getSharedPreferences(PaymentNotificationListenerService.PREFS, Context.MODE_PRIVATE).edit().putBoolean("enabled", false).remove("token").apply();
        call.resolve(status());
    }

    @PluginMethod public void openAccessSettings(PluginCall call) {
        try { getContext().startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); call.resolve(status()); }
        catch (Exception error) { call.reject("No se pudo abrir la configuración de acceso a notificaciones.", error); }
    }

    @PluginMethod public void getStatus(PluginCall call) { call.resolve(status()); }

    private JSObject status() {
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("enabled", getContext().getSharedPreferences(PaymentNotificationListenerService.PREFS, Context.MODE_PRIVATE).getBoolean("enabled", false));
        result.put("accessGranted", isAccessGranted());
        result.put("serverConfigured", !getContext().getSharedPreferences(PaymentNotificationListenerService.PREFS, Context.MODE_PRIVATE).getString("serverUrl", "").isEmpty());
        return result;
    }

    private boolean isAccessGranted() {
        String enabled = Settings.Secure.getString(getContext().getContentResolver(), "enabled_notification_listeners");
        return enabled != null && enabled.contains(new ComponentName(getContext(), PaymentNotificationListenerService.class).flattenToString());
    }
}
