package com.laujim.aptmanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Android foreground coordinator. It wakes on the configured interval and
 * asks Render to run the existing portal scrapers. No portal password is
 * copied to the phone and the browser work remains on the authenticated
 * Browserless/Render runtime.
 */
public class ScraperWorkerService extends Service {
    public static final String ACTION_RUN = "com.laujim.aptmanager.SCRAPER_WORKER_RUN";
    private static final String CHANNEL_ID = "laujim_scraper_worker";
    private static final int NOTIFICATION_ID = 31778;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 35_000;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private ExecutorService executor;

    @Override
    public void onCreate() {
        super.onCreate();
        executor = Executors.newSingleThreadExecutor();
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, notification("Worker Android preparado"));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!ScraperWorkerStore.enabled(this)) {
            stopSelfResult(startId);
            return START_NOT_STICKY;
        }
        if (running.compareAndSet(false, true)) {
            executor.execute(() -> runRemoteScrape(startId));
        }
        return START_NOT_STICKY;
    }

    private void runRemoteScrape(int startId) {
        int nextHours = ScraperWorkerStore.intervalHours(this);
        try {
            String server = trimServer(ScraperWorkerStore.serverUrl(this));
            String token = ScraperWorkerStore.token(this);
            String deviceId = ScraperWorkerStore.deviceId(this);
            if (server.isEmpty() || token.isEmpty() || deviceId.isEmpty()) {
                throw new IllegalStateException("Falta configurar URL, token o dispositivo.");
            }

            ScraperWorkerStore.setRunState(this, "connecting", "");
            updateNotification("Conectando con Laujim…");

            HttpResult configResult = request(server + "/worker/v1/config", "GET", token, deviceId, null);
            if (configResult.status < 200 || configResult.status >= 300) {
                throw new IllegalStateException("Render respondió HTTP " + configResult.status + ".");
            }
            JSONObject config = parseObject(configResult.body);
            JSONObject schedule = config.optJSONObject("schedule");
            if (schedule != null) {
                nextHours = ScraperWorkerStore.clampHours(schedule.optInt("intervalHours", nextHours));
                ScraperWorkerStore.setIntervalHours(this, nextHours);
            }

            JSONObject registration = new JSONObject()
                .put("deviceId", deviceId)
                .put("platform", "android")
                .put("runtime", "laujim-apk")
                .put("appVersion", "2.5.0")
                .put("providers", schedule == null ? new JSONArray() : schedule.optJSONArray("providers"))
                .put("replaceExisting", false);
            HttpResult registerResult = request(server + "/worker/v1/register", "POST", token, deviceId, registration.toString());
            if (registerResult.status < 200 || registerResult.status >= 300) {
                throw new IllegalStateException("No se pudo registrar el worker (HTTP " + registerResult.status + ").");
            }

            JSONObject runBody = new JSONObject()
                .put("deviceId", deviceId)
                .put("platform", "android")
                .put("runtime", "laujim-apk")
                .put("appVersion", "2.5.0")
                .put("runId", "android-" + UUID.randomUUID());
            if (schedule != null && schedule.optJSONArray("providers") != null) {
                runBody.put("providers", schedule.optJSONArray("providers"));
            }
            updateNotification("Ejecutando Air-e, Triple A y Gases…");
            ScraperWorkerStore.setRunState(this, "running", "");
            HttpResult runResult = request(server + "/worker/v1/run", "POST", token, deviceId, runBody.toString());
            if (runResult.status < 200 || runResult.status >= 300) {
                throw new IllegalStateException("No se pudo iniciar la consulta (HTTP " + runResult.status + ").");
            }

            ScraperWorkerStore.setRunState(this, "accepted", "");
            updateNotification("Consulta aceptada; Render está leyendo los portales.");
        } catch (Exception error) {
            String message = error.getMessage() == null ? "Error desconocido" : error.getMessage();
            ScraperWorkerStore.setRunState(this, "error", message);
            updateNotification("Error del worker: " + message);
        } finally {
            running.set(false);
            if (ScraperWorkerStore.enabled(this)) {
                ScraperWorkerAlarm.scheduleNext(this, nextHours * 60L * 60L * 1000L);
            }
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelfResult(startId);
        }
    }

    private HttpResult request(String url, String method, String token, String deviceId, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("X-Worker-Token", token);
        connection.setRequestProperty("X-Worker-Id", deviceId);
        if (body != null) {
            connection.setDoOutput(true);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 400 ? connection.getInputStream() : connection.getErrorStream();
        String response = readBody(stream);
        connection.disconnect();
        return new HttpResult(status, response);
    }

    private String readBody(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder value = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null && value.length() < 1_000_000) value.append(line);
        }
        return value.toString();
    }

    private JSONObject parseObject(String body) throws JSONException {
        return new JSONObject(body == null ? "{}" : body);
    }

    private String trimServer(String value) {
        String result = value == null ? "" : value.trim();
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        if (result.endsWith("/api")) result = result.substring(0, result.length() - 4);
        return result;
    }

    private Notification notification(String message) {
        Intent launch = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            this, 31779, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle("Laujim · Worker scraper")
            .setContentText(message)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void updateNotification(String message) {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, notification(message));
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Worker scraper de Laujim", NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Estado de las consultas programadas de servicios públicos.");
        manager.createNotificationChannel(channel);
    }

    @Override
    public void onDestroy() {
        if (executor != null) executor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private static final class HttpResult {
        final int status;
        final String body;
        HttpResult(int status, String body) { this.status = status; this.body = body; }
    }
}
