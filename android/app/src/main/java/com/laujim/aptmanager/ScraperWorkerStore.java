package com.laujim.aptmanager;

import android.content.Context;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** Private device configuration for the local Android portal worker. */
final class ScraperWorkerStore {
    private static final String PREFS = "laujim_scraper_worker";

    private ScraperWorkerStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void configure(
        Context context,
        String serverUrl,
        String token,
        String deviceId,
        int intervalHours,
        String startAt,
        String timezone
    ) {
        prefs(context).edit()
            .putString("serverUrl", serverUrl)
            .putString("token", token)
            .putString("deviceId", deviceId)
            .putString("mode", "local-webview")
            .putInt("intervalHours", clampHours(intervalHours))
            .putString("startAt", normalizeStartAt(startAt))
            .putString("timezone", normalizeTimezone(timezone))
            .apply();
    }

    static String serverUrl(Context context) { return prefs(context).getString("serverUrl", ""); }
    static String token(Context context) { return prefs(context).getString("token", ""); }
    static String deviceId(Context context) { return prefs(context).getString("deviceId", "android-laujim"); }
    static String mode(Context context) { return prefs(context).getString("mode", "local-webview"); }
    static int intervalHours(Context context) { return clampHours(prefs(context).getInt("intervalHours", 1)); }
    static String startAt(Context context) { return normalizeStartAt(prefs(context).getString("startAt", "07:00")); }
    static String timezone(Context context) { return normalizeTimezone(prefs(context).getString("timezone", "America/Bogota")); }
    static boolean enabled(Context context) { return prefs(context).getBoolean("enabled", false); }
    static void setEnabled(Context context, boolean enabled) { prefs(context).edit().putBoolean("enabled", enabled).apply(); }
    static void setIntervalHours(Context context, int hours) { prefs(context).edit().putInt("intervalHours", clampHours(hours)).apply(); }

    static boolean setSchedule(Context context, int hours, String startAt, String timezone) {
        int normalizedHours = clampHours(hours);
        String normalizedStart = normalizeStartAt(startAt);
        String normalizedTimezone = normalizeTimezone(timezone);
        boolean changed = intervalHours(context) != normalizedHours
            || !startAt(context).equals(normalizedStart)
            || !timezone(context).equals(normalizedTimezone);
        prefs(context).edit()
            .putInt("intervalHours", normalizedHours)
            .putString("startAt", normalizedStart)
            .putString("timezone", normalizedTimezone)
            .apply();
        return changed;
    }

    static void setRunState(Context context, String state, String error) {
        prefs(context).edit()
            .putString("lastState", state == null ? "" : state)
            .putString("lastError", error == null ? "" : error)
            .putString("lastRunAt", new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(new Date()))
            .apply();
    }

    static String lastState(Context context) { return prefs(context).getString("lastState", "idle"); }
    static String lastError(Context context) { return prefs(context).getString("lastError", ""); }
    static String lastRunAt(Context context) { return prefs(context).getString("lastRunAt", ""); }
    static String currentProvider(Context context) { return prefs(context).getString("currentProvider", ""); }
    static void setCurrentProvider(Context context, String provider) { prefs(context).edit().putString("currentProvider", provider == null ? "" : provider).apply(); }

    static void setNextRunAt(Context context, long value, String mode, String reason) {
        prefs(context).edit()
            .putLong("nextRunAt", Math.max(0L, value))
            .putString("scheduleMode", mode == null ? "" : mode)
            .putString("scheduleReason", reason == null ? "" : reason)
            .apply();
    }

    static long nextRunAt(Context context) { return prefs(context).getLong("nextRunAt", 0L); }
    static String scheduleMode(Context context) { return prefs(context).getString("scheduleMode", ""); }
    static String scheduleReason(Context context) { return prefs(context).getString("scheduleReason", ""); }

    static void setSchedulerEvent(Context context, String event, String source, String message) {
        prefs(context).edit()
            .putString("lastSchedulerEvent", event == null ? "" : event)
            .putString("lastTriggerSource", source == null ? "" : source)
            .putString("lastSchedulerMessage", message == null ? "" : message)
            .putLong("lastSchedulerEventAt", System.currentTimeMillis())
            .apply();
    }

    static String lastSchedulerEvent(Context context) { return prefs(context).getString("lastSchedulerEvent", ""); }
    static String lastTriggerSource(Context context) { return prefs(context).getString("lastTriggerSource", ""); }
    static String lastSchedulerMessage(Context context) { return prefs(context).getString("lastSchedulerMessage", ""); }
    static long lastSchedulerEventAt(Context context) { return prefs(context).getLong("lastSchedulerEventAt", 0L); }

    static void setLastAlarmAt(Context context, long value) { prefs(context).edit().putLong("lastAlarmAt", value).apply(); }
    static long lastAlarmAt(Context context) { return prefs(context).getLong("lastAlarmAt", 0L); }
    static void setLastWorkManagerAt(Context context, long value) { prefs(context).edit().putLong("lastWorkManagerAt", value).apply(); }
    static long lastWorkManagerAt(Context context) { return prefs(context).getLong("lastWorkManagerAt", 0L); }
    static void setLastDispatchAt(Context context, long value) { prefs(context).edit().putLong("lastDispatchAt", value).apply(); }
    static long lastDispatchAt(Context context) { return prefs(context).getLong("lastDispatchAt", 0L); }
    static void setLastDispatchSlotAt(Context context, long value) { prefs(context).edit().putLong("lastDispatchSlotAt", value).apply(); }
    static long lastDispatchSlotAt(Context context) { return prefs(context).getLong("lastDispatchSlotAt", 0L); }

    static void setMarketplaceRunState(Context context, String state, String error, String jobId) {
        prefs(context).edit()
            .putString("marketplaceLastState", state == null ? "" : state)
            .putString("marketplaceLastError", error == null ? "" : error)
            .putString("marketplaceLastJobId", jobId == null ? "" : jobId)
            .putString("marketplaceLastRunAt", new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(new Date()))
            .apply();
    }

    static String marketplaceLastState(Context context) { return prefs(context).getString("marketplaceLastState", "idle"); }
    static String marketplaceLastError(Context context) { return prefs(context).getString("marketplaceLastError", ""); }
    static String marketplaceLastRunAt(Context context) { return prefs(context).getString("marketplaceLastRunAt", ""); }
    static String marketplaceLastJobId(Context context) { return prefs(context).getString("marketplaceLastJobId", ""); }
    static void setMarketplaceLastDispatchAt(Context context, long value) { prefs(context).edit().putLong("marketplaceLastDispatchAt", value).apply(); }
    static long marketplaceLastDispatchAt(Context context) { return prefs(context).getLong("marketplaceLastDispatchAt", 0L); }
    static void setMarketplaceNextCheckAt(Context context, long value) { prefs(context).edit().putLong("marketplaceNextCheckAt", Math.max(0L, value)).apply(); }
    static long marketplaceNextCheckAt(Context context) { return prefs(context).getLong("marketplaceNextCheckAt", 0L); }

    static String iso(long value) {
        if (value <= 0L) return "";
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US);
        return format.format(new Date(value));
    }

    static int clampHours(int hours) {
        return Math.max(1, Math.min(168, hours));
    }

    static String normalizeStartAt(String value) {
        String candidate = value == null ? "" : value.trim();
        return candidate.matches("^([01]\\d|2[0-3]):[0-5]\\d$") ? candidate : "07:00";
    }

    static String normalizeTimezone(String value) {
        String candidate = value == null ? "" : value.trim();
        if (candidate.isEmpty()) return "America/Bogota";
        String[] available = TimeZone.getAvailableIDs();
        for (String id : available) if (id.equals(candidate)) return candidate;
        return "America/Bogota";
    }
}
