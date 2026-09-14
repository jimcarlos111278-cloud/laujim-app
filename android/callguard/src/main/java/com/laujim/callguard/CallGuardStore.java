package com.laujim.callguard;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

public final class CallGuardStore {
    private static final String PREFS = "laujim_callguard_prefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_AUTH_TOKEN = "auth_token";
    private static final String KEY_ALLOWED_NUMBERS = "allowed_numbers";
    private static final String KEY_BLOCKED_CALLS = "blocked_calls_json";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_ALLOW_CONTACTS = "allow_contacts";
    private static final String KEY_ALLOW_DELIVERY = "allow_delivery";
    private static final String KEY_ALLOW_BANKS = "allow_banks";
    private static final String KEY_LAST_SYNC = "last_sync_time";

    public static final String DEFAULT_SERVER = "https://conjunto-residendial-laujim.duckdns.org";
    public static final String DEFAULT_TOKEN = "laujim-2026-secret";

    private CallGuardStore() {}

    public static String normalize(String phone) {
        if (phone == null) return "";
        String digits = phone.replaceAll("\\D", "");
        if (digits.startsWith("57") && digits.length() == 12) return digits.substring(2);
        if (digits.startsWith("0") && digits.length() == 11) return digits.substring(1);
        return digits;
    }

    public static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String getServerUrl(Context context) {
        return prefs(context).getString(KEY_SERVER_URL, DEFAULT_SERVER);
    }

    public static void setServerUrl(Context context, String url) {
        prefs(context).edit().putString(KEY_SERVER_URL, url).apply();
    }

    public static String getAuthToken(Context context) {
        return prefs(context).getString(KEY_AUTH_TOKEN, DEFAULT_TOKEN);
    }

    public static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(KEY_ENABLED, true);
    }

    public static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    public static boolean allowContacts(Context context) {
        return prefs(context).getBoolean(KEY_ALLOW_CONTACTS, true);
    }

    public static boolean allowDelivery(Context context) {
        return prefs(context).getBoolean(KEY_ALLOW_DELIVERY, true);
    }

    public static boolean allowBanks(Context context) {
        return prefs(context).getBoolean(KEY_ALLOW_BANKS, true);
    }

    public static void saveAllowedNumbers(Context context, Set<String> numbers) {
        Set<String> normalized = new HashSet<>();
        for (String n : numbers) {
            String val = normalize(n);
            if (!val.isEmpty()) normalized.add(val);
        }
        prefs(context).edit()
            .putStringSet(KEY_ALLOWED_NUMBERS, normalized)
            .putLong(KEY_LAST_SYNC, System.currentTimeMillis())
            .apply();
    }

    public static Set<String> getAllowedNumbers(Context context) {
        Set<String> set = prefs(context).getStringSet(KEY_ALLOWED_NUMBERS, Collections.emptySet());
        return set == null ? Collections.emptySet() : new HashSet<>(set);
    }

    public static long getLastSyncTime(Context context) {
        return prefs(context).getLong(KEY_LAST_SYNC, 0L);
    }

    public static boolean isAllowed(Context context, String phone) {
        if (!isEnabled(context)) return true;
        String norm = normalize(phone);
        if (norm.isEmpty()) return false;

        // 1. Inquilinos autorizados en BD
        if (getAllowedNumbers(context).contains(norm)) return true;

        // 2. Contactos de la agenda
        if (allowContacts(context) && isInContacts(context, phone)) return true;

        // 3. Whitelist Domicilios
        if (allowDelivery(context)) {
            String[] deliveryPatterns = {"6013163535", "6017700200", "6015115115", "6014868000", "6015605000", "6017441111", "6013289000"};
            for (String p : deliveryPatterns) {
                if (norm.contains(p) || p.contains(norm)) return true;
            }
        }

        // 4. Whitelist Bancos
        if (allowBanks(context)) {
            String[] bankPatterns = {"6013430000", "6045109000", "6053618888", "6013383838", "6014010101", "6013820000", "6015878000"};
            for (String p : bankPatterns) {
                if (norm.contains(p) || p.contains(norm)) return true;
            }
        }

        return false;
    }

    public static boolean isInContacts(Context context, String phone) {
        if (context.checkSelfPermission(android.Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return false;
        Cursor cursor = null;
        try {
            Uri uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(phone));
            cursor = context.getContentResolver().query(uri, new String[]{ContactsContract.PhoneLookup._ID}, null, null, null);
            return cursor != null && cursor.moveToFirst();
        } catch (Exception e) {
            return false;
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    public static synchronized void recordBlockedCall(Context context, String phone, String name, String reason, String category) {
        try {
            String currentJson = prefs(context).getString(KEY_BLOCKED_CALLS, "[]");
            JSONArray arr = new JSONArray(currentJson);

            JSONObject item = new JSONObject();
            item.put("phone", normalize(phone));
            item.put("rawPhone", phone);
            item.put("name", name != null ? name : "Número Desconocido");
            item.put("reason", reason != null ? reason : "Llamada bloqueada por CallGuard");
            item.put("category", category != null ? category : "unknown");
            item.put("timestamp", System.currentTimeMillis());
            
            String norm = normalize(phone);
            boolean isMobile = norm.startsWith("3") && norm.length() == 10;
            item.put("hasWhatsApp", isMobile);

            JSONArray updated = new JSONArray();
            updated.put(item);
            for (int i = 0; i < Math.min(arr.length(), 99); i++) {
                updated.put(arr.get(i));
            }

            prefs(context).edit().putString(KEY_BLOCKED_CALLS, updated.toString()).apply();
        } catch (Exception ignored) {}
    }

    public static String getBlockedCallsJson(Context context) {
        return prefs(context).getString(KEY_BLOCKED_CALLS, "[]");
    }

    public static void clearBlockedCalls(Context context) {
        prefs(context).edit().putString(KEY_BLOCKED_CALLS, "[]").apply();
    }
}
