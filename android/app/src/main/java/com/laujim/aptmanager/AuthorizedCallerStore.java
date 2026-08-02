package com.laujim.aptmanager;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

final class AuthorizedCallerStore {
    private static final String PREFS = "laujim_call_screening";
    private static final String ALLOWED_NUMBERS = "allowed_numbers";
    private static final String ENABLED = "enabled";
    private static final String LAST_SYNCED_AT = "last_synced_at";

    private AuthorizedCallerStore() {}

    static String normalize(String phone) {
        if (phone == null) return "";
        String digits = phone.replaceAll("\\D", "");
        if (digits.startsWith("57") && digits.length() == 12) return digits.substring(2);
        if (digits.startsWith("0") && digits.length() == 11) return digits.substring(1);
        return digits;
    }

    static void save(Context context, Set<String> phones) {
        Set<String> normalized = new HashSet<>();
        for (String phone : phones) {
            String value = normalize(phone);
            if (!value.isEmpty()) normalized.add(value);
        }
        prefs(context).edit()
            .putStringSet(ALLOWED_NUMBERS, normalized)
            .putLong(LAST_SYNCED_AT, System.currentTimeMillis())
            .apply();
    }

    static boolean isAllowed(Context context, String phone) {
        if (!isEnabled(context)) return true;
        String value = normalize(phone);
        return !value.isEmpty() && allowed(context).contains(value);
    }

    static Set<String> allowed(Context context) {
        Set<String> saved = prefs(context).getStringSet(ALLOWED_NUMBERS, Collections.emptySet());
        return saved == null ? Collections.emptySet() : new HashSet<>(saved);
    }

    static int count(Context context) { return allowed(context).size(); }
    static boolean isEnabled(Context context) { return prefs(context).getBoolean(ENABLED, false); }
    static void setEnabled(Context context, boolean enabled) { prefs(context).edit().putBoolean(ENABLED, enabled).apply(); }
    static long lastSyncedAt(Context context) { return prefs(context).getLong(LAST_SYNCED_AT, 0); }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
