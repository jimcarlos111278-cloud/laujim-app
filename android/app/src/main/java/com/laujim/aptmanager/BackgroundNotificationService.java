package com.laujim.aptmanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Polls the authenticated Laujim inbox while Android keeps the app closed.
 * A foreground service is intentional: Android otherwise suspends a WebView
 * and cannot promise real-time notifications without Firebase credentials.
 */
public class BackgroundNotificationService extends Service {
    public static final String ACTION_OPEN_WHATSAPP = "com.laujim.aptmanager.OPEN_WHATSAPP";
    public static final String EXTRA_CONVERSATION_ID = "conversationId";
    public static final String EXTRA_NOTIFICATION_ID = "notificationId";
    public static final String EXTRA_REPLY_TEXT = "replyText";
    public static final String PREFS = "laujim_background_notifications";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_SERVER_URL = "serverUrl";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_WHATSAPP = "whatsapp";
    private static final String KEY_SCRAPER = "scraper";
    private static final String KEY_FACEBOOK = "facebook";
    private static final String KEY_PAYMENTS = "payments";
    private static final String KEY_SOUND = "sound";
    private static final String KEY_LAST_SEEN = "lastSeenAt";
    private static final String KEY_LAST_EVENT = "lastEventAt";
    private static final String SERVICE_CHANNEL = "laujim_background_service";
    private static final String MESSAGE_CHANNEL = "laujim_whatsapp_messages";
    private static final int SERVICE_NOTIFICATION_ID = 31880;
    private static final int MESSAGE_NOTIFICATION_BASE = 31900;
    private static final long POLL_SECONDS = 20L;
    private static volatile boolean serviceRunning;
    private ScheduledExecutorService executor;

    public static void configure(Context context, String serverUrl, String token, boolean whatsapp, boolean scraper, boolean facebook, boolean payments, boolean sound) {
        android.content.SharedPreferences current = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        android.content.SharedPreferences.Editor editor = current.edit()
            .putBoolean(KEY_ENABLED, true)
            .putString(KEY_SERVER_URL, serverUrl)
            .putString(KEY_TOKEN, token)
            .putBoolean(KEY_WHATSAPP, whatsapp)
            .putBoolean(KEY_SCRAPER, scraper)
            .putBoolean(KEY_FACEBOOK, facebook)
            .putBoolean(KEY_PAYMENTS, payments)
            .putBoolean(KEY_SOUND, sound);
        String cursor = nowIso();
        if (current.getString(KEY_LAST_SEEN, "").isEmpty()) editor.putString(KEY_LAST_SEEN, cursor);
        if (current.getString(KEY_LAST_EVENT, "").isEmpty()) editor.putString(KEY_LAST_EVENT, cursor);
        editor.apply();
        ContextCompat.startForegroundService(context, new Intent(context, BackgroundNotificationService.class));
    }

    public static void stop(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, false).remove(KEY_TOKEN).apply();
        context.stopService(new Intent(context, BackgroundNotificationService.class));
    }

    public static void startIfEnabled(Context context) {
        if (enabled(context)) ContextCompat.startForegroundService(context, new Intent(context, BackgroundNotificationService.class));
    }

    public static boolean enabled(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false); }
    public static boolean running() { return serviceRunning; }
    public static String lastSeenAt(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_LAST_SEEN, ""); }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        serviceRunning = true;
        startForeground(SERVICE_NOTIFICATION_ID, serviceNotification());
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(this::poll, 0L, POLL_SECONDS, TimeUnit.SECONDS);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "com.laujim.aptmanager.TEST_NOTIFICATION".equals(intent.getAction())) {
            try {
                JSONObject item = new JSONObject();
                item.put("id", 1234);
                item.put("conversationId", 1);
                item.put("tenantName", "Jim Carlos Varela Gomez");
                item.put("apartmentName", "101");
                item.put("type", "text");
                item.put("text", intent.getStringExtra("text") != null ? intent.getStringExtra("text") : "🔔 ¡Hola! Notificación de WhatsApp Laujim funcionando.");
                showIncoming(item, true);
            } catch (Exception ignored) {}
        }
        return START_STICKY;
    }

    private void poll() {
        if (!enabled(this)) return;
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String server = prefs.getString(KEY_SERVER_URL, "");
        String token = prefs.getString(KEY_TOKEN, "");
        if (server.isEmpty() || token.isEmpty()) return;
        try {
            String since = prefs.getString(KEY_LAST_SEEN, "");
            String endpoint = server + "/whatsapp/cloud/notifications?since=" + URLEncoder.encode(since, "UTF-8");
            JSONObject response = getJson(endpoint, token);
            JSONArray items = response.optJSONArray("items");
            String newest = since;
            if (items != null) {
                for (int i = 0; i < items.length(); i++) {
                    JSONObject item = items.optJSONObject(i);
                    if (item == null) continue;
                    String createdAt = item.optString("createdAt", "");
                    if (createdAt.compareTo(newest) > 0) newest = createdAt;
                    if (prefs.getBoolean(KEY_WHATSAPP, true)) showIncoming(item, prefs.getBoolean(KEY_SOUND, true));
                }
            }
            if (!newest.isEmpty() && newest.compareTo(since) > 0) prefs.edit().putString(KEY_LAST_SEEN, newest).apply();
            pollEvents(prefs);
        } catch (IllegalStateException e) {
            // Handle 401 specifically — token may have expired
            if (e.getMessage() != null && e.getMessage().contains("401")) {
                showAuthExpiredNotification();
            }
            // Other errors (503, network) retry silently on the next cycle
        } catch (Exception ignored) {
            // Network/parse errors retry on the next polling cycle
        }
    }

    private void pollEvents(android.content.SharedPreferences prefs) {
        if (!prefs.getBoolean(KEY_SCRAPER, true) && !prefs.getBoolean(KEY_FACEBOOK, true) && !prefs.getBoolean(KEY_PAYMENTS, true)) return;
        try {
            String since = prefs.getString(KEY_LAST_EVENT, "");
            String server = prefs.getString(KEY_SERVER_URL, "");
            String token = prefs.getString(KEY_TOKEN, "");
            String endpoint = server + "/notifications/events?since=" + URLEncoder.encode(since, "UTF-8");
            JSONObject response = getJson(endpoint, token);
            JSONArray items = response.optJSONArray("items");
            String newest = since;
            if (items != null) {
                for (int i = 0; i < items.length(); i++) {
                    JSONObject item = items.optJSONObject(i);
                    if (item == null) continue;
                    String createdAt = item.optString("createdAt", "");
                    if (createdAt.compareTo(newest) > 0) newest = createdAt;
                    String category = item.optString("category", "scraper");
                    if (shouldShowEvent(item, prefs)) {
                        showEvent(item, prefs.getBoolean(KEY_SOUND, true));
                    }
                }
            }
            if (!newest.isEmpty() && newest.compareTo(since) > 0) prefs.edit().putString(KEY_LAST_EVENT, newest).apply();
        } catch (Exception ignored) {
            // WhatsApp and event streams retry independently on the next cycle.
        }
    }

    private JSONObject getJson(String endpoint, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(8_000);
        connection.setReadTimeout(12_000);
        connection.setRequestProperty("x-auth-token", token);
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        String body = read(stream);
        connection.disconnect();
        if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
        return new JSONObject(body);
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "{}";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private void showIncoming(JSONObject item, boolean sound) {
        int messageId = item.optInt("id", 0);
        int conversationId = item.optInt("conversationId", 0);
        String tenant = item.optString("tenantName", "Inquilino autorizado");
        String apartment = item.optString("apartmentName", "—");
        String type = item.optString("type", "text");
        String body = item.optString("text", "");
        if ("image".equals(type) || "sticker".equals(type)) body = "📷 Foto recibida" + (body.isEmpty() ? "" : ": " + body);
        else if ("video".equals(type)) body = "🎥 Video recibido" + (body.isEmpty() ? "" : ": " + body);
        else if ("audio".equals(type)) body = "🎙 Nota de voz recibida";
        else if (body.isEmpty()) body = "Nuevo mensaje";
        Intent open = new Intent(this, MainActivity.class)
            .setAction(ACTION_OPEN_WHATSAPP)
            .putExtra(EXTRA_CONVERSATION_ID, conversationId)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPending = PendingIntent.getActivity(this, MESSAGE_NOTIFICATION_BASE + messageId, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent reply = new Intent(this, NotificationActionReceiver.class)
            .setAction(NotificationActionReceiver.ACTION_REPLY)
            .putExtra(EXTRA_CONVERSATION_ID, conversationId)
            .putExtra(EXTRA_NOTIFICATION_ID, MESSAGE_NOTIFICATION_BASE + messageId);
        PendingIntent replyPending = PendingIntent.getBroadcast(this, MESSAGE_NOTIFICATION_BASE + messageId, reply, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        RemoteInput input = new RemoteInput.Builder(EXTRA_REPLY_TEXT).setLabel("Responder a " + tenant).build();
        NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(android.R.drawable.ic_menu_send, "Responder", replyPending).addRemoteInput(input).build();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, MESSAGE_CHANNEL)
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setContentTitle(tenant + " · Apto. " + apartment)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openPending)
            .addAction(replyAction)
            .addAction(new NotificationCompat.Action.Builder(android.R.drawable.ic_menu_view, "Abrir WhatsApp", openPending).build());
        if (sound) builder.setDefaults(Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE);
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(MESSAGE_NOTIFICATION_BASE + messageId, builder.build());
    }

    private void showEvent(JSONObject item, boolean sound) {
        String category = item.optString("category", "scraper");
        String title = item.optString("title", "Laujim");
        String body = item.optString("text", "Nuevo evento");
        int notificationId = MESSAGE_NOTIFICATION_BASE + 1000 + Math.abs(item.optString("id", "event").hashCode() % 1000);
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPending = PendingIntent.getActivity(this, notificationId, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, MESSAGE_CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openPending);
        if (sound) builder.setDefaults(Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE);
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(notificationId, builder.build());
    }

    /**
     * Defense in depth for older servers and cached event responses. The
     * server applies the same policy, but the APK must never turn a normal
     * scraper success or a Facebook error into a user-visible alert.
     */
    private boolean shouldShowEvent(JSONObject item, android.content.SharedPreferences prefs) {
        String category = item.optString("category", "scraper").toLowerCase(Locale.ROOT);
        String level = item.optString("level", "").toLowerCase(Locale.ROOT);
        String stage = item.optString("stage", "").toLowerCase(Locale.ROOT);
        String status = item.optString("status", "").toLowerCase(Locale.ROOT);
        String text = item.optString("text", "").toLowerCase(Locale.ROOT);
        if ("facebook".equals(category)) {
            if (!prefs.getBoolean(KEY_FACEBOOK, true)) return false;
            if ("published".equals(status) || "status_published".equals(stage) || "published".equals(stage)) return true;
            return "success".equals(level)
                && (text.contains("publicad") || text.contains("published"))
                && !text.contains("login") && !text.contains("procesando") && !text.contains("processing");
        }
        if ("scraper".equals(category)) {
            if (!prefs.getBoolean(KEY_SCRAPER, true)) return false;
            return "error".equals(level) || "warn".equals(level);
        }
        return "payments".equals(category) && prefs.getBoolean(KEY_PAYMENTS, false);
    }

    private Notification serviceNotification() {
        Intent launch = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, SERVICE_NOTIFICATION_ID, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, SERVICE_CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle("Laujim · Notificaciones activas")
            .setContentText("WhatsApp, scraper y Facebook se revisan en segundo plano")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel service = new NotificationChannel(SERVICE_CHANNEL, "Servicio de notificaciones Laujim", NotificationManager.IMPORTANCE_LOW);
        service.setDescription("Mantiene activas las notificaciones cuando Laujim está cerrada.");
        NotificationChannel messages = new NotificationChannel(MESSAGE_CHANNEL, "Mensajes de WhatsApp", NotificationManager.IMPORTANCE_HIGH);
        messages.setDescription("Mensajes nuevos del bot de Laujim.");
        manager.createNotificationChannel(service);
        manager.createNotificationChannel(messages);
    }

    @Override
    public void onDestroy() {
        serviceRunning = false;
        if (executor != null) executor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        startIfEnabled(this);
        super.onTaskRemoved(rootIntent);
    }

    private static String nowIso() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    private boolean authExpiredShown = false;

    private void showAuthExpiredNotification() {
        if (authExpiredShown) return; // Only show once per service lifecycle
        authExpiredShown = true;
        try {
            Intent openApp = new Intent(this, MainActivity.class);
            openApp.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            android.app.PendingIntent pending = android.app.PendingIntent.getActivity(
                this, 0, openApp, android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE
            );
            Notification notification = new NotificationCompat.Builder(this, MESSAGE_CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("Sesión expirada")
                .setContentText("Abre la app para restaurar las notificaciones")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pending)
                .setAutoCancel(true)
                .build();
            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (manager != null) manager.notify(99999, notification);
        } catch (Exception e) { /* best-effort */ }
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
