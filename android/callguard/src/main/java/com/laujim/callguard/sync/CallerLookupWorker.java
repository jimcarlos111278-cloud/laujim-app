package com.laujim.callguard.sync;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import com.laujim.callguard.CallGuardStore;
import com.laujim.callguard.data.CallGuardDatabase;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class CallerLookupWorker extends Worker {
    public CallerLookupWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        String eventId = getInputData().getString("event_id");
        String phoneE164 = getInputData().getString("phone_e164");

        if (phoneE164 == null || phoneE164.trim().isEmpty()) {
            return Result.failure();
        }

        Context ctx = getApplicationContext();
        String serverUrl = CallGuardStore.getServerUrl(ctx);
        String token = CallGuardStore.getAuthToken(ctx);

        if (serverUrl == null || serverUrl.trim().isEmpty()) {
            return Result.retry();
        }

        HttpURLConnection conn = null;
        try {
            URL url = new URL(serverUrl.replaceAll("/+$", "") + "/api/security/caller-id/jobs");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            if (token != null && !token.isEmpty()) {
                conn.setRequestProperty("x-auth-token", token);
            }
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setDoOutput(true);

            JSONObject payload = new JSONObject();
            payload.put("eventId", eventId != null ? eventId : "");
            payload.put("phone", phoneE164);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload.toString().getBytes(StandardCharsets.UTF_8));
            }

            int responseCode = conn.getResponseCode();
            if (responseCode >= 200 && responseCode < 300) {
                StringBuilder response = new StringBuilder();
                try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = br.readLine()) != null) response.append(line);
                }

                JSONObject resObj = new JSONObject(response.toString());
                boolean cached = resObj.optBoolean("cached", false);
                String status = resObj.optString("status", "queued");

                if (cached && eventId != null) {
                    // Si ya estaba en caché, consultar el detalle
                    fetchAndStoreLookupResult(serverUrl, token, eventId, phoneE164);
                }

                return Result.success();
            } else if (responseCode == 400) {
                return Result.failure();
            } else {
                return Result.retry();
            }
        } catch (Exception e) {
            return Result.retry();
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void fetchAndStoreLookupResult(String serverUrl, String token, String eventId, String phone) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(serverUrl.replaceAll("/+$", "") + "/api/security/caller-id/lookup?phone=" + java.net.URLEncoder.encode(phone, "UTF-8"));
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            if (token != null && !token.isEmpty()) {
                conn.setRequestProperty("x-auth-token", token);
            }
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);

            if (conn.getResponseCode() == 200) {
                StringBuilder sb = new StringBuilder();
                try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                    String l;
                    while ((l = br.readLine()) != null) sb.append(l);
                }
                JSONObject item = new JSONObject(sb.toString());
                String status = item.optString("status", "found");
                String name = item.optString("possibleName", null);
                String category = item.optString("category", null);
                Double score = item.has("spamScore") && !item.isNull("spamScore") ? item.optDouble("spamScore") : null;
                Integer reports = item.has("reportCount") && !item.isNull("reportCount") ? item.optInt("reportCount") : null;
                String location = item.optString("location", null);
                String avatar = item.optString("avatarUrl", null);

                CallGuardDatabase.getInstance(getApplicationContext()).blockedCallDao().updateLookup(
                    eventId,
                    status,
                    name,
                    category,
                    score,
                    reports,
                    location,
                    avatar,
                    System.currentTimeMillis()
                );
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
