package com.laujim.aptmanager;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.RemoteInput;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class NotificationActionReceiver extends BroadcastReceiver {
    public static final String ACTION_REPLY = "com.laujim.aptmanager.NOTIFICATION_REPLY";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_REPLY.equals(intent.getAction())) return;
        android.os.Bundle remoteInput = RemoteInput.getResultsFromIntent(intent);
        CharSequence reply = remoteInput == null ? null : remoteInput.getCharSequence(BackgroundNotificationService.EXTRA_REPLY_TEXT);
        if (reply == null || reply.toString().trim().isEmpty()) return;
        final BroadcastReceiver.PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        final int notificationId = intent.getIntExtra(BackgroundNotificationService.EXTRA_NOTIFICATION_ID, 0);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        executor.execute(() -> {
            try {
                android.content.SharedPreferences prefs = app.getSharedPreferences(BackgroundNotificationService.PREFS, Context.MODE_PRIVATE);
                String server = prefs.getString("serverUrl", "");
                String token = prefs.getString("token", "");
                int conversationId = intent.getIntExtra(BackgroundNotificationService.EXTRA_CONVERSATION_ID, 0);
                JSONObject payload = new JSONObject().put("conversationId", conversationId).put("text", reply.toString().trim());
                post(server + "/whatsapp/cloud/quick-reply", token, payload.toString());
                NotificationManager manager = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager != null && notificationId > 0) manager.cancel(notificationId);
            } catch (Exception ignored) {
                // The message remains in the notification tray so the user can
                // open the conversation and retry after a network failure.
            } finally {
                executor.shutdown();
                pending.finish();
            }
        });
    }

    private static void post(String endpoint, String token, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(8_000);
        connection.setReadTimeout(12_000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("x-auth-token", token);
        try (OutputStream output = connection.getOutputStream()) { output.write(body.getBytes(StandardCharsets.UTF_8)); }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        if (stream != null) try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) { while (reader.readLine() != null) {} }
        connection.disconnect();
        if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
    }
}
