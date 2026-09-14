package com.laujim.callguard;

import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;

public class CallGuardBridge {
    private final MainActivity activity;

    public CallGuardBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String getStatus() {
        JSONObject obj = new JSONObject();
        try {
            Context ctx = activity;
            obj.put("enabled", CallGuardStore.isEnabled(ctx));
            obj.put("serverUrl", CallGuardStore.getServerUrl(ctx));
            obj.put("allowedCount", CallGuardStore.getAllowedNumbers(ctx).size());
            obj.put("lastSync", CallGuardStore.getLastSyncTime(ctx));
            obj.put("allowContacts", CallGuardStore.allowContacts(ctx));
            obj.put("allowDelivery", CallGuardStore.allowDelivery(ctx));
            obj.put("allowBanks", CallGuardStore.allowBanks(ctx));

            boolean roleGranted = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                RoleManager rm = (RoleManager) ctx.getSystemService(Context.ROLE_SERVICE);
                roleGranted = rm != null && rm.isRoleHeld(RoleManager.ROLE_CALL_SCREENING);
            }
            obj.put("roleGranted", roleGranted);
        } catch (Exception ignored) {}
        return obj.toString();
    }

    @JavascriptInterface
    public void requestRole() {
        activity.runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                RoleManager rm = (RoleManager) activity.getSystemService(Context.ROLE_SERVICE);
                if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
                    activity.startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING), 1001);
                }
            }
        });
    }

    @JavascriptInterface
    public String syncWithServer() {
        try {
            String server = CallGuardStore.getServerUrl(activity);
            URL url = new URL(server + "/api/callguard/tenants");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("x-auth-token", CallGuardStore.getAuthToken(activity));
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);

            if (conn.getResponseCode() == 200) {
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close();

                JSONObject res = new JSONObject(sb.toString());
                JSONArray tenants = res.optJSONArray("tenants");
                Set<String> nums = new HashSet<>();
                if (tenants != null) {
                    for (int i = 0; i < tenants.length(); i++) {
                        JSONObject t = tenants.getJSONObject(i);
                        nums.add(t.optString("phone"));
                    }
                }
                CallGuardStore.saveAllowedNumbers(activity, nums);
                return "{\"ok\":true,\"count\":" + nums.size() + "}";
            }
            return "{\"ok\":false,\"error\":\"HTTP " + conn.getResponseCode() + "\"}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    @JavascriptInterface
    public String getBlockedCalls() {
        return CallGuardStore.getBlockedCallsJson(activity);
    }

    @JavascriptInterface
    public void clearBlockedCalls() {
        CallGuardStore.clearBlockedCalls(activity);
    }

    @JavascriptInterface
    public void callNumber(String number) {
        activity.runOnUiThread(() -> {
            Intent intent = new Intent(Intent.ACTION_DIAL);
            intent.setData(Uri.parse("tel:" + Uri.encode(number)));
            activity.startActivity(intent);
        });
    }

    @JavascriptInterface
    public void openWhatsApp(String number) {
        activity.runOnUiThread(() -> {
            String norm = CallGuardStore.normalize(number);
            String full = norm.startsWith("57") ? norm : ("57" + norm);
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/" + full));
            activity.startActivity(intent);
        });
    }

    @JavascriptInterface
    public void authorizeNumber(String number) {
        Set<String> set = CallGuardStore.getAllowedNumbers(activity);
        set.add(CallGuardStore.normalize(number));
        CallGuardStore.saveAllowedNumbers(activity, set);
    }
}
