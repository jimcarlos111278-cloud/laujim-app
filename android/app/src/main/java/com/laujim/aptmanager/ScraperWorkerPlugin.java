package com.laujim.aptmanager;

import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "ScraperWorker")
public class ScraperWorkerPlugin extends Plugin {
    @PluginMethod
    public void configure(PluginCall call) {
        String serverUrl = call.getString("serverUrl");
        String token = call.getString("token");
        String deviceId = call.getString("deviceId");
        Integer hours = call.getInt("intervalHours", 12);
        if (serverUrl == null || serverUrl.trim().isEmpty() || token == null || token.trim().isEmpty()) {
            call.reject("URL y token del worker son obligatorios.");
            return;
        }
        ScraperWorkerStore.configure(
            getContext(),
            serverUrl.trim(),
            token.trim(),
            deviceId == null || deviceId.trim().isEmpty() ? "android-laujim" : deviceId.trim(),
            hours == null ? 12 : hours
        );
        call.resolve(status());
    }

    @PluginMethod
    public void start(PluginCall call) {
        ScraperWorkerStore.setEnabled(getContext(), true);
        ScraperWorkerAlarm.scheduleNext(getContext(), 12 * 60 * 60 * 1000L);
        try {
            Intent service = new Intent(getContext(), ScraperWorkerService.class)
                .setAction(ScraperWorkerService.ACTION_RUN);
            ContextCompat.startForegroundService(getContext(), service);
            call.resolve(status());
        } catch (RuntimeException error) {
            ScraperWorkerStore.setEnabled(getContext(), false);
            call.reject("No se pudo iniciar el worker Android: " + error.getMessage());
        }
    }

    @PluginMethod
    public void runNow(PluginCall call) {
        ScraperWorkerStore.setEnabled(getContext(), true);
        try {
            Intent service = new Intent(getContext(), ScraperWorkerService.class)
                .setAction(ScraperWorkerService.ACTION_RUN);
            ContextCompat.startForegroundService(getContext(), service);
            call.resolve(status());
        } catch (RuntimeException error) {
            call.reject("No se pudo iniciar la consulta: " + error.getMessage());
        }
    }

    @PluginMethod
    public void openPortal(PluginCall call) {
        String provider = call.getString("provider", "air-e");
        Intent intent = new Intent(getContext(), PortalBrowserActivity.class)
            .putExtra(PortalBrowserActivity.EXTRA_PROVIDER, provider)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("No se pudo abrir el portal: " + error.getMessage());
        }
    }

    @PluginMethod
    public void clearPortalCookies(PluginCall call) {
        android.webkit.CookieManager cookies = android.webkit.CookieManager.getInstance();
        cookies.removeAllCookies(value -> cookies.flush());
        android.webkit.WebStorage.getInstance().deleteAllData();
        call.resolve(status());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        ScraperWorkerStore.setEnabled(getContext(), false);
        ScraperWorkerAlarm.cancel(getContext());
        getContext().stopService(new Intent(getContext(), ScraperWorkerService.class));
        call.resolve(status());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    private JSObject status() {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("enabled", ScraperWorkerStore.enabled(context));
        result.put("intervalHours", ScraperWorkerStore.intervalHours(context));
        result.put("deviceId", ScraperWorkerStore.deviceId(context));
        result.put("mode", ScraperWorkerStore.mode(context));
        result.put("currentProvider", ScraperWorkerStore.currentProvider(context));
        result.put("lastState", ScraperWorkerStore.lastState(context));
        result.put("lastError", ScraperWorkerStore.lastError(context));
        result.put("lastRunAt", ScraperWorkerStore.lastRunAt(context));
        return result;
    }
}
