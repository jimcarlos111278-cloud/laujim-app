package com.laujim.aptmanager;

import android.content.Context;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Private device configuration for the local Android portal worker. */
final class ScraperWorkerStore {
    private static final String PREFS = "laujim_scraper_worker";

    private ScraperWorkerStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void configure(Context context, String serverUrl, String token, String deviceId, int intervalHours) {
        prefs(context).edit()
            .putString("serverUrl", serverUrl)
            .putString("token", token)
            .putString("deviceId", deviceId)
            .putString("mode", "local-webview")
            .putInt("intervalHours", clampHours(intervalHours))
            .apply();
    }

    static String serverUrl(Context context) { return prefs(context).getString("serverUrl", ""); }
    static String token(Context context) { return prefs(context).getString("token", ""); }
    static String deviceId(Context context) { return prefs(context).getString("deviceId", "android-laujim"); }
    static String mode(Context context) { return prefs(context).getString("mode", "local-webview"); }
    static int intervalHours(Context context) { return clampHours(prefs(context).getInt("intervalHours", 12)); }
    static boolean enabled(Context context) { return prefs(context).getBoolean("enabled", false); }
    static void setEnabled(Context context, boolean enabled) { prefs(context).edit().putBoolean("enabled", enabled).apply(); }
    static void setIntervalHours(Context context, int hours) { prefs(context).edit().putInt("intervalHours", clampHours(hours)).apply(); }

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

    static int clampHours(int hours) {
        return Math.max(1, Math.min(168, hours));
    }
}
