package com.laujim.aptmanager;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/** Private on-device archive for SMS accepted by the protected SMS mode. */
final class AuthorizedSmsStore {
    private static final String PREFS = "laujim_authorized_sms";
    private static final String MESSAGES = "messages";
    private static final int MAX_MESSAGES = 150;

    private AuthorizedSmsStore() {}

    static synchronized void add(Context context, String sender, String body, long receivedAt) {
        JSONArray existing = messages(context);
        JSONArray updated = new JSONArray();
        try {
            JSONObject message = new JSONObject();
            message.put("id", receivedAt + "-" + sender);
            message.put("phone", sender == null ? "" : sender);
            message.put("body", body == null ? "" : body);
            message.put("receivedAt", receivedAt);
            updated.put(message);
            for (int index = 0; index < existing.length() && index < MAX_MESSAGES - 1; index++) {
                updated.put(existing.getJSONObject(index));
            }
            prefs(context).edit().putString(MESSAGES, updated.toString()).apply();
        } catch (Exception ignored) {
            // A malformed incoming SMS must not affect receiving later messages.
        }
    }

    static JSONArray messages(Context context) {
        try {
            return new JSONArray(prefs(context).getString(MESSAGES, "[]"));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    static int count(Context context) { return messages(context).length(); }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
