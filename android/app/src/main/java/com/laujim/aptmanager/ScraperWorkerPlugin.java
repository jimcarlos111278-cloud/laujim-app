package com.laujim.aptmanager;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

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
        Integer hours = call.getInt("intervalHours", 1);
        String startAt = call.getString("startAt", "07:00");
        String timezone = call.getString("timezone", "America/Bogota");
        if (serverUrl == null || serverUrl.trim().isEmpty() || token == null || token.trim().isEmpty()) {
            call.reject("URL y token del worker son obligatorios.");
            return;
        }
        ScraperWorkerStore.configure(
            getContext(),
            serverUrl.trim(),
            token.trim(),
            deviceId == null || deviceId.trim().isEmpty() ? "android-laujim" : deviceId.trim(),
            hours == null ? 1 : hours,
            startAt,
            timezone
        );
        if (ScraperWorkerStore.enabled(getContext())) {
            ScraperWorkerSchedule.scheduleAll(getContext(), "native-config-updated");
            MarketplaceWorkerSchedule.schedule(getContext());
        }
        call.resolve(status());
    }

    @PluginMethod
    public void start(PluginCall call) {
        ScraperWorkerStore.setEnabled(getContext(), true);
        ScraperWorkerSchedule.scheduleAll(getContext(), "worker-started");
        MarketplaceWorkerSchedule.schedule(getContext());
        if (!ScraperWorkerDispatcher.dispatch(getContext(), "manual-start", true)) {
            call.reject(ScraperWorkerStore.lastError(getContext()));
            return;
        }
        call.resolve(status());
    }

    @PluginMethod
    public void runNow(PluginCall call) {
        boolean wasEnabled = ScraperWorkerStore.enabled(getContext());
        ScraperWorkerStore.setEnabled(getContext(), true);
        if (!wasEnabled) ScraperWorkerSchedule.scheduleAll(getContext(), "worker-started");
        else ScraperWorkerSchedule.scheduleNextAlarm(getContext(), "manual-run");
        if (!ScraperWorkerDispatcher.dispatch(getContext(), "manual-run", true)) {
            call.reject(ScraperWorkerStore.lastError(getContext()));
            return;
        }
        call.resolve(status());
    }

    @PluginMethod
    public void runGasAccountNow(PluginCall call) {
        String accountId = call.getString("accountId", "");
        if (accountId == null || !accountId.trim().toLowerCase().matches("gas-\\d+")) {
            call.reject("Cuenta de Gases inválida. Usa un identificador como gas-1 o gas-2.");
            return;
        }
        ScraperWorkerStore.setEnabled(getContext(), true);
        if (!ScraperWorkerDispatcher.dispatchGasAccount(getContext(), "manual-gas-account", accountId, true)) {
            call.reject(ScraperWorkerStore.lastError(getContext()));
            return;
        }
        call.resolve(status());
    }

    @PluginMethod
    public void reschedule(PluginCall call) {
        if (ScraperWorkerStore.enabled(getContext())) {
            ScraperWorkerSchedule.scheduleAll(getContext(), "manual-reschedule");
        }
        call.resolve(status());
    }

    @PluginMethod
    public void requestExactAlarmPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !ScraperWorkerSchedule.canScheduleExactAlarms(getContext())) {
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                    .setData(Uri.parse("package:" + getContext().getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                ScraperWorkerStore.setSchedulerEvent(getContext(), "exact_permission_requested", "settings", "Se abrió el permiso de alarmas y recordatorios.");
            } catch (RuntimeException error) {
                call.reject("No se pudo abrir el permiso de alarmas exactas: " + error.getMessage());
                return;
            }
        }
        call.resolve(status());
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(status());
        } catch (RuntimeException error) {
            call.reject("No se pudieron abrir los ajustes de batería: " + error.getMessage());
        }
    }

    @PluginMethod
    public void openPortal(PluginCall call) {
        String provider = call.getString("provider", "air-e");
        Intent intent = new Intent(getContext(), PortalBrowserActivity.class)
            .putExtra(PortalBrowserActivity.EXTRA_PROVIDER, provider)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("No se pudo abrir el portal: " + error.getMessage());
        }
    }

    @PluginMethod
    public void getInstalledVersion(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("supported", true);
            result.put("version", info.versionName == null ? "0.0.0" : info.versionName);
            result.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode);
            call.resolve(result);
        } catch (PackageManager.NameNotFoundException error) {
            call.reject("No se pudo leer la versión instalada: " + error.getMessage());
        }
    }

    @PluginMethod
    public void openMarketplace(PluginCall call) {
        Intent intent = new Intent(getContext(), MarketplaceBrowserActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("No se pudo abrir Facebook Marketplace: " + error.getMessage());
        }
    }

    @PluginMethod
    public void runMarketplaceNow(PluginCall call) {
        if (!MarketplaceWorkerDispatcher.dispatch(getContext(), "manual-marketplace", true)) {
            call.reject(ScraperWorkerStore.marketplaceLastError(getContext()));
            return;
        }
        call.resolve(status());
    }

    @PluginMethod
    public void clearPortalCookies(PluginCall call) {
        android.webkit.CookieManager cookies = android.webkit.CookieManager.getInstance();
        cookies.removeAllCookies(value -> cookies.flush());
        android.webkit.WebStorage.getInstance().deleteAllData();
        PortalSessionVault.clear(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        ScraperWorkerStore.setEnabled(getContext(), false);
        ScraperWorkerSchedule.cancel(getContext());
        MarketplaceWorkerSchedule.cancel(getContext());
        getContext().stopService(new Intent(getContext(), ScraperWorkerService.class));
        getContext().stopService(new Intent(getContext(), MarketplaceWorkerService.class));
        call.resolve(status());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        if (ScraperWorkerStore.enabled(getContext())) {
            long nextRunAt = ScraperWorkerStore.nextRunAt(getContext());
            boolean exactUpgrade = ScraperWorkerSchedule.canScheduleExactAlarms(getContext())
                && !"exact+workmanager".equals(ScraperWorkerStore.scheduleMode(getContext()));
            boolean missedSchedule = nextRunAt > 0L && nextRunAt < System.currentTimeMillis() - 60_000L;
            if (exactUpgrade) ScraperWorkerSchedule.scheduleAll(getContext(), "exact-permission-detected");
            else if (missedSchedule) ScraperWorkerSchedule.scheduleAll(getContext(), "scheduler-recovery");
        }
        call.resolve(status());
    }

    private JSObject status() {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("enabled", ScraperWorkerStore.enabled(context));
        result.put("intervalHours", ScraperWorkerStore.intervalHours(context));
        result.put("startAt", ScraperWorkerStore.startAt(context));
        result.put("timezone", ScraperWorkerStore.timezone(context));
        result.put("deviceId", ScraperWorkerStore.deviceId(context));
        result.put("mode", ScraperWorkerStore.mode(context));
        result.put("currentProvider", ScraperWorkerStore.currentProvider(context));
        result.put("lastState", ScraperWorkerStore.lastState(context));
        result.put("lastError", ScraperWorkerStore.lastError(context));
        result.put("lastRunAt", ScraperWorkerStore.lastRunAt(context));
        result.put("nextRunAt", ScraperWorkerStore.iso(ScraperWorkerStore.nextRunAt(context)));
        result.put("scheduleMode", ScraperWorkerStore.scheduleMode(context));
        result.put("scheduleReason", ScraperWorkerStore.scheduleReason(context));
        result.put("exactAlarmAllowed", ScraperWorkerSchedule.canScheduleExactAlarms(context));
        result.put("lastSchedulerEvent", ScraperWorkerStore.lastSchedulerEvent(context));
        result.put("lastSchedulerMessage", ScraperWorkerStore.lastSchedulerMessage(context));
        result.put("lastSchedulerEventAt", ScraperWorkerStore.iso(ScraperWorkerStore.lastSchedulerEventAt(context)));
        result.put("lastTriggerSource", ScraperWorkerStore.lastTriggerSource(context));
        result.put("lastAlarmAt", ScraperWorkerStore.iso(ScraperWorkerStore.lastAlarmAt(context)));
        result.put("lastWorkManagerAt", ScraperWorkerStore.iso(ScraperWorkerStore.lastWorkManagerAt(context)));
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        result.put("batteryOptimizationExempt", power != null && power.isIgnoringBatteryOptimizations(context.getPackageName()));
        result.put("marketplaceLastState", ScraperWorkerStore.marketplaceLastState(context));
        result.put("marketplaceLastError", ScraperWorkerStore.marketplaceLastError(context));
        result.put("marketplaceLastRunAt", ScraperWorkerStore.marketplaceLastRunAt(context));
        result.put("marketplaceLastJobId", ScraperWorkerStore.marketplaceLastJobId(context));
        result.put("marketplaceNextCheckAt", ScraperWorkerStore.iso(ScraperWorkerStore.marketplaceNextCheckAt(context)));
        return result;
    }
}
