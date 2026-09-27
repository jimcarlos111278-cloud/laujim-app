package com.laujim.callguard;

import android.Manifest;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.provider.CallLog;
import android.provider.ContactsContract;
import android.telecom.TelecomManager;
import android.webkit.JavascriptInterface;
import androidx.core.content.ContextCompat;
import com.laujim.callguard.data.AllowedNumberEntity;
import com.laujim.callguard.data.BlockedCallEntity;
import com.laujim.callguard.data.CallGuardDatabase;
import com.laujim.callguard.data.ColombiaPhoneNormalizer;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
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
            obj.put("roleGranted", hasScreeningRole());
            obj.put("isDefaultDialer", hasDialerRole());
        } catch (Exception ignored) {}
        return obj.toString();
    }

    @JavascriptInterface
    public boolean hasDialerRole() {
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
    public boolean isDefaultDialer() {
        return hasDialerRole();
    }

    @JavascriptInterface
    public boolean hasScreeningRole() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager rm = (RoleManager) activity.getSystemService(Context.ROLE_SERVICE);
            return rm != null && rm.isRoleHeld(RoleManager.ROLE_CALL_SCREENING);
        }
        return true;
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
    public boolean placeCall(String number) {
        if (number == null || number.trim().isEmpty()) return false;
        String e164 = ColombiaPhoneNormalizer.toE164(number);
        if (e164 == null) e164 = number.trim();

        final String target = e164;
        activity.runOnUiThread(() -> {
            Uri uri = Uri.fromParts("tel", target, null);
            if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
                activity.requestPermissions(new String[]{Manifest.permission.CALL_PHONE}, 3001);
                return;
            }

            TelecomManager tm = (TelecomManager) activity.getSystemService(Context.TELECOM_SERVICE);
            if (hasDialerRole() && tm != null) {
                try {
                    Bundle extras = new Bundle();
                    extras.putBoolean(TelecomManager.EXTRA_START_CALL_WITH_SPEAKERPHONE, false);
                    tm.placeCall(uri, extras);
                    return;
                } catch (SecurityException ignored) {}
            }

            Intent callIntent = new Intent(Intent.ACTION_CALL, uri);
            callIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(callIntent);
        });
        return true;
    }

    @JavascriptInterface
    public void callNumber(String number) {
        placeCall(number);
    }

    @JavascriptInterface
    public boolean endCall() {
        return CallManager.disconnect();
    }

    @JavascriptInterface
    public boolean setMuted(boolean muted) {
        return CallManager.setMuted(muted);
    }

    @JavascriptInterface
    public boolean sendDtmf(String digit) {
        if (digit != null && digit.length() >= 1) {
            return CallManager.playDtmf(digit.charAt(0));
        }
        return false;
    }

    @JavascriptInterface
    public void toggleSpeaker(boolean enable) {
        CallManager.toggleSpeaker(enable);
    }

    @JavascriptInterface
    public void hapticTap() {
        try {
            Vibrator v = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(25, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(25);
                }
            }
        } catch (Exception ignored) {}
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

                List<AllowedNumberEntity> toSave = new ArrayList<>();
                long now = System.currentTimeMillis();

                while (cursor.moveToNext()) {
                    String rawNum = numIdx >= 0 ? cursor.getString(numIdx) : "";
                    String name = nameIdx >= 0 ? cursor.getString(nameIdx) : "";
                    String photo = photoIdx >= 0 ? cursor.getString(photoIdx) : null;
                    String norm = ColombiaPhoneNormalizer.toE164(rawNum);
                    if (norm == null) norm = CallGuardStore.normalize(rawNum);
                    if (norm.isEmpty() || seen.contains(norm)) continue;
                    seen.add(norm);

                    JSONObject contact = new JSONObject();
                    contact.put("name", (name != null && !name.trim().isEmpty()) ? name.trim() : norm);
                    contact.put("phone", norm);
                    contact.put("rawPhone", rawNum);
                    contact.put("isLocal", true);
                    if (photo != null) contact.put("photo", photo);
                    arr.put(contact);

                    toSave.add(new AllowedNumberEntity(norm, "CONTACT", name, null, true, now));
                }

                // Guardar en segundo plano en Room para screening inmediato
                new Thread(() -> {
                    try {
                        CallGuardDatabase.getInstance(activity).allowedNumberDao().upsertAll(toSave);
                    } catch (Exception ignored) {}
                }).start();
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        return arr.toString();
    }

    @JavascriptInterface
    public String getBlockedCalls() {
        try {
            List<BlockedCallEntity> list = CallGuardDatabase.getInstance(activity).blockedCallDao().getAllBlocked();
            if (list != null && !list.isEmpty()) {
                JSONArray arr = new JSONArray();
                for (BlockedCallEntity b : list) {
                    JSONObject obj = new JSONObject();
                    obj.put("id", b.eventId);
                    obj.put("phone", b.phoneE164);
                    obj.put("reason", b.reason);
                    obj.put("timestamp", b.blockedAt);
                    obj.put("status", b.lookupStatus);
                    obj.put("possibleName", b.possibleName);
                    obj.put("category", b.category);
                    obj.put("spamScore", b.spamScore);
                    obj.put("reportCount", b.reportCount);
                    obj.put("location", b.location);
                    obj.put("avatarUrl", b.avatarUrl);
                    arr.put(obj);
                }
                return arr.toString();
            }
        } catch (Exception ignored) {}
        return CallGuardStore.getBlockedCallsJson(activity);
    }

    @JavascriptInterface
    public void clearBlockedCalls() {
        new Thread(() -> {
            try {
                List<BlockedCallEntity> list = CallGuardDatabase.getInstance(activity).blockedCallDao().getAllBlocked();
                if (list != null) {
                    for (BlockedCallEntity b : list) {
                        CallGuardDatabase.getInstance(activity).blockedCallDao().delete(b.eventId);
                    }
                }
            } catch (Exception ignored) {}
        }).start();
        CallGuardStore.clearBlockedCalls(activity);
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
                List<AllowedNumberEntity> entities = new ArrayList<>();
                long now = System.currentTimeMillis();

                if (tenants != null) {
                    for (int i = 0; i < tenants.length(); i++) {
                        JSONObject t = tenants.getJSONObject(i);
                        String rawPhone = t.optString("phone");
                        String norm = ColombiaPhoneNormalizer.toE164(rawPhone);
                        if (norm == null) norm = CallGuardStore.normalize(rawPhone);
                        if (!norm.isEmpty()) {
                            nums.add(norm);
                            String name = t.optString("name", "Residente Laujim");
                            String apt = t.optString("apartment", "");
                            entities.add(new AllowedNumberEntity(norm, "LAUJIM", name, apt, true, now));
                        }
                    }
                    CallGuardStore.saveTenantsData(activity, tenants.toString());
                }
                CallGuardStore.saveAllowedNumbers(activity, nums);

                new Thread(() -> {
                    try {
                        CallGuardDatabase.getInstance(activity).allowedNumberDao().upsertAll(entities);
                    } catch (Exception ignored) {}
                }).start();

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
        String norm = ColombiaPhoneNormalizer.toE164(number);
        if (norm == null) norm = CallGuardStore.normalize(number);
        if (norm.isEmpty()) return;

        final String finalNorm = norm;
        Set<String> set = CallGuardStore.getAllowedNumbers(activity);
        set.add(finalNorm);
        CallGuardStore.saveAllowedNumbers(activity, set);

        new Thread(() -> {
            try {
                AllowedNumberEntity entity = new AllowedNumberEntity(finalNorm, "WHITELIST", "Número autorizado", null, true, System.currentTimeMillis());
                CallGuardDatabase.getInstance(activity).allowedNumberDao().upsert(entity);
            } catch (Exception ignored) {}
        }).start();
    }

    @JavascriptInterface
    public void blockNumber(String number) {
        String norm = ColombiaPhoneNormalizer.toE164(number);
        if (norm == null) norm = CallGuardStore.normalize(number);
        if (norm.isEmpty()) return;

        final String finalNorm = norm;
        CallGuardStore.removeAllowedNumber(activity, finalNorm);

        new Thread(() -> {
            try {
                CallGuardDatabase.getInstance(activity).allowedNumberDao().deleteByPhone(finalNorm);
            } catch (Exception ignored) {}
        }).start();
    }

    @JavascriptInterface
    public boolean isNumberAuthorized(String number) {
        String norm = ColombiaPhoneNormalizer.toE164(number);
        if (norm == null) norm = CallGuardStore.normalize(number);
        if (norm.isEmpty()) return false;
        return CallGuardStore.getAllowedNumbers(activity).contains(norm);
    }

    @JavascriptInterface
    public void copyToClipboard(String text) {
        activity.runOnUiThread(() -> {
            try {
                ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = ClipData.newPlainText("CallGuard Phone", text);
                if (clipboard != null) {
                    clipboard.setPrimaryClip(clip);
                }
            } catch (Exception ignored) {}
        });
    }

    @JavascriptInterface
    public String getDeviceCallLog() {
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
            activity.runOnUiThread(() -> {
                activity.requestPermissions(new String[]{Manifest.permission.READ_CALL_LOG}, 4002);
            });
            return "[]";
        }

        JSONArray arr = new JSONArray();
        android.database.Cursor cursor = null;
        try {
            android.content.ContentResolver cr = activity.getContentResolver();
            String[] projection = new String[]{
                CallLog.Calls.NUMBER,
                CallLog.Calls.CACHED_NAME,
                CallLog.Calls.TYPE,
                CallLog.Calls.DATE,
                CallLog.Calls.DURATION
            };
            cursor = cr.query(
                CallLog.Calls.CONTENT_URI,
                projection,
                null,
                null,
                CallLog.Calls.DATE + " DESC LIMIT 60"
            );

            if (cursor != null) {
                int numIdx = cursor.getColumnIndex(CallLog.Calls.NUMBER);
                int nameIdx = cursor.getColumnIndex(CallLog.Calls.CACHED_NAME);
                int typeIdx = cursor.getColumnIndex(CallLog.Calls.TYPE);
                int dateIdx = cursor.getColumnIndex(CallLog.Calls.DATE);
                int durIdx = cursor.getColumnIndex(CallLog.Calls.DURATION);

                while (cursor.moveToNext()) {
                    String rawNum = numIdx >= 0 ? cursor.getString(numIdx) : "";
                    String name = nameIdx >= 0 ? cursor.getString(nameIdx) : "";
                    int type = typeIdx >= 0 ? cursor.getInt(typeIdx) : 0;
                    long date = dateIdx >= 0 ? cursor.getLong(dateIdx) : 0L;
                    long dur = durIdx >= 0 ? cursor.getLong(durIdx) : 0L;

                    String typeStr = "unknown";
                    if (type == CallLog.Calls.INCOMING_TYPE) typeStr = "incoming";
                    else if (type == CallLog.Calls.OUTGOING_TYPE) typeStr = "outgoing";
                    else if (type == CallLog.Calls.MISSED_TYPE || type == CallLog.Calls.REJECTED_TYPE) typeStr = "missed";

                    JSONObject obj = new JSONObject();
                    obj.put("number", rawNum);
                    obj.put("name", (name != null && !name.trim().isEmpty()) ? name.trim() : rawNum);
                    obj.put("type", typeStr);
                    obj.put("date", date);
                    obj.put("duration", dur);
                    arr.put(obj);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        return arr.toString();
    }
}
