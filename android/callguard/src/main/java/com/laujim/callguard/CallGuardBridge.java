package com.laujim.callguard;

import android.Manifest;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.ContactsContract;
import android.telecom.TelecomManager;
import android.webkit.JavascriptInterface;
import androidx.core.content.ContextCompat;
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
            obj.put("isDefaultDialer", isDefaultDialer());
        } catch (Exception ignored) {}
        return obj.toString();
    }

    @JavascriptInterface
    public boolean isDefaultDialer() {
        Context ctx = activity;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager rm = (RoleManager) ctx.getSystemService(Context.ROLE_SERVICE);
            return rm != null && rm.isRoleHeld(RoleManager.ROLE_DIALER);
        } else {
            TelecomManager tm = (TelecomManager) ctx.getSystemService(Context.TELECOM_SERVICE);
            return tm != null && ctx.getPackageName().equals(tm.getDefaultDialerPackage());
        }
    }

    @JavascriptInterface
    public void requestDefaultDialer() {
        activity.runOnUiThread(() -> {
            boolean handled = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                RoleManager rm = (RoleManager) activity.getSystemService(Context.ROLE_SERVICE);
                if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_DIALER)) {
                    try {
                        activity.startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_DIALER), 2001);
                        handled = true;
                    } catch (Exception ignored) {}
                }
            }
            if (!handled) {
                TelecomManager tm = (TelecomManager) activity.getSystemService(Context.TELECOM_SERVICE);
                if (tm != null && !activity.getPackageName().equals(tm.getDefaultDialerPackage())) {
                    try {
                        Intent intent = new Intent(TelecomManager.ACTION_CHANGE_DEFAULT_DIALER);
                        intent.putExtra(TelecomManager.EXTRA_CHANGE_DEFAULT_DIALER_PACKAGE_NAME, activity.getPackageName());
                        activity.startActivityForResult(intent, 2001);
                        handled = true;
                    } catch (Exception ignored) {}
                }
            }
            if (!handled) {
                openDefaultAppsSettings();
            }
        });
    }

    @JavascriptInterface
    public void openDefaultAppsSettings() {
        activity.runOnUiThread(() -> {
            try {
                Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
                activity.startActivity(intent);
            } catch (Exception e) {
                try {
                    Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.parse("package:" + activity.getPackageName()));
                    activity.startActivity(intent);
                } catch (Exception ignored) {}
            }
        });
    }

    @JavascriptInterface
    public String getDeviceContacts() {
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            activity.runOnUiThread(() -> {
                activity.requestPermissions(new String[]{Manifest.permission.READ_CONTACTS}, 4001);
            });
            return "[]";
        }

        JSONArray arr = new JSONArray();
        android.database.Cursor cursor = null;
        try {
            android.content.ContentResolver cr = activity.getContentResolver();
            String[] projection = new String[]{
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER,
                ContactsContract.CommonDataKinds.Phone.PHOTO_THUMBNAIL_URI
            };
            cursor = cr.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                null,
                null,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
            );

            if (cursor != null) {
                Set<String> seen = new HashSet<>();
                int nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                int numIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                int photoIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.PHOTO_THUMBNAIL_URI);

                while (cursor.moveToNext()) {
                    String rawNum = numIdx >= 0 ? cursor.getString(numIdx) : "";
                    String name = nameIdx >= 0 ? cursor.getString(nameIdx) : "";
                    String photo = photoIdx >= 0 ? cursor.getString(photoIdx) : null;
                    String norm = CallGuardStore.normalize(rawNum);
                    if (norm.isEmpty() || seen.contains(norm)) continue;
                    seen.add(norm);

                    JSONObject contact = new JSONObject();
                    contact.put("name", (name != null && !name.trim().isEmpty()) ? name.trim() : norm);
                    contact.put("phone", norm);
                    contact.put("rawPhone", rawNum);
                    contact.put("isLocal", true);
                    if (photo != null) contact.put("photo", photo);
                    arr.put(contact);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        return arr.toString();
    }

    @JavascriptInterface
    public String lookupNumber(String number) {
        if (number == null || number.trim().isEmpty()) return "{}";
        try {
            String server = CallGuardStore.getServerUrl(activity);
            String norm = CallGuardStore.normalize(number);
            URL url = new URL(server + "/api/callguard/lookup?phone=" + norm);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("x-auth-token", CallGuardStore.getAuthToken(activity));
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(4000);

            if (conn.getResponseCode() == 200) {
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close();
                return sb.toString();
            }
            return "{\"ok\":false,\"status\":" + conn.getResponseCode() + "}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
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
                    CallGuardStore.saveTenantsData(activity, tenants.toString());
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
    public String getTenants() {
        return CallGuardStore.getTenantsData(activity);
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
            if (number == null || number.trim().isEmpty()) return;
            String clean = number.trim();
            Uri uri = Uri.fromParts("tel", clean, null);

            if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
                activity.requestPermissions(new String[]{Manifest.permission.CALL_PHONE}, 3001);
                return;
            }

            TelecomManager tm = (TelecomManager) activity.getSystemService(Context.TELECOM_SERVICE);
            if (isDefaultDialer() && tm != null) {
                try {
                    Bundle extras = new Bundle();
                    extras.putBoolean(TelecomManager.EXTRA_START_CALL_WITH_SPEAKERPHONE, false);
                    tm.placeCall(uri, extras);
                    return;
                } catch (SecurityException ignored) {}
            }

            // Fallback: direct CALL intent (stays in call stack, does NOT open external dialer pad)
            Intent callIntent = new Intent(Intent.ACTION_CALL, uri);
            callIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(callIntent);
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
