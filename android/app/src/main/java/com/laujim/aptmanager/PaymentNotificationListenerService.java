package com.laujim.aptmanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads only posted bank notifications after the user explicitly enables
 * Laujim in Android's notification-access settings. It never reads SMS,
 * banking screens, cookies or credentials.
 */
public class PaymentNotificationListenerService extends NotificationListenerService {
    public static final String PREFS = "laujim_payment_watcher";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_SERVER_URL = "serverUrl";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_LAST_FINGERPRINT = "lastFingerprint";
    private static final String CHANNEL = "laujim_payment_events";
    private static final int NOTIFICATION_ID = 32741;
    private static final Pattern MONEY = Pattern.compile("(?:\\$|cop\\s*)\\s*([0-9][0-9.,]*)", Pattern.CASE_INSENSITIVE);
    private static final Pattern REFERENCE = Pattern.compile("(?:referencia|transacci[oó]n|comprobante|operaci[oó]n|id)\\s*[:#-]?\\s*([a-z0-9-]{4,})", Pattern.CASE_INSENSITIVE);
    private static final Pattern PHONE = Pattern.compile("(?:\\+?57\\s*)?3\\d{9}|(?:terminad[oa]\\s+en\\s+)(\\d{3,4})", Pattern.CASE_INSENSITIVE);
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || !isEnabled(this)) return;
        String packageName = sbn.getPackageName() == null ? "" : sbn.getPackageName();
        if (getPackageName().equals(packageName)) return;
        Notification notification = sbn.getNotification();
        if (notification == null || notification.extras == null) return;
        CharSequence titleValue = notification.extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence textValue = notification.extras.getCharSequence(Notification.EXTRA_TEXT);
        String title = titleValue == null ? "" : titleValue.toString().trim();
        String text = textValue == null ? "" : textValue.toString().trim();
        String body = (title + " " + text).replaceAll("\\s+", " ").trim();
        if (!looksLikeIncomingPayment(body)) return;
        Integer amount = extractAmount(body);
        if (amount == null || amount <= 0) return;
        String fingerprint = sha256(packageName + "|" + body + "|" + sbn.getPostTime());
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (fingerprint.equals(prefs.getString(KEY_LAST_FINGERPRINT, ""))) return;
        prefs.edit().putString(KEY_LAST_FINGERPRINT, fingerprint).apply();
        String reference = extractReference(body);
        String identifier = extractPayerIdentifier(body);
        String provider = detectProvider(packageName, body);
        JSONObject payload = new JSONObject();
        try {
            payload.put("eventId", fingerprint);
            payload.put("sourceType", "android_notification");
            payload.put("sourceApp", packageName);
            payload.put("provider", provider);
            payload.put("transferChannel", detectChannel(body));
            payload.put("title", title);
            payload.put("text", body.substring(0, Math.min(body.length(), 800)));
            payload.put("amount", amount);
            payload.put("currency", "COP");
            payload.put("direction", "incoming");
            payload.put("transactionId", reference);
            payload.put("payerIdentifier", identifier);
            payload.put("receivedAt", new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(new java.util.Date(sbn.getPostTime())));
        } catch (Exception ignored) { return; }
        executor.execute(() -> submit(payload, provider, amount));
    }

    private void submit(JSONObject payload, String provider, int amount) {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String server = prefs.getString(KEY_SERVER_URL, "").replaceAll("/+$", "");
        String token = prefs.getString(KEY_TOKEN, "");
        if (TextUtils.isEmpty(server) || TextUtils.isEmpty(token)) return;
        try {
            // The web bridge passes getBase(), which already ends in /api.
            JSONObject response = post(server + "/payments/automation/events", token, payload.toString());
            String status = response.optString("status", "pending_association");
            showResult(provider, amount, status);
        } catch (Exception error) {
            showResult(provider, amount, "error");
        }
    }

    private JSONObject post(String endpoint, String token, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("POST"); connection.setDoOutput(true);
        connection.setConnectTimeout(8_000); connection.setReadTimeout(12_000);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("x-auth-token", token);
        try (OutputStream output = connection.getOutputStream()) { output.write(body.getBytes(StandardCharsets.UTF_8)); }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        String response = read(stream); connection.disconnect();
        if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
        return new JSONObject(response);
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "{}";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line; while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private void showResult(String provider, int amount, String status) {
        createChannel();
        String title = "Pago detectado · " + provider;
        String body = "COP $" + String.format(Locale.US, "%,d", amount).replace(',', '.') +
            ("auto_confirmed".equals(status) ? " · registrado" : " · requiere asociación");
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, NOTIFICATION_ID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_more).setContentTitle(title).setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body)).setAutoCancel(true).setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_HIGH);
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, builder.build());
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Pagos detectados", NotificationManager.IMPORTANCE_HIGH));
    }

    private static boolean isEnabled(Context context) { return context.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_ENABLED, false); }

    private static boolean looksLikeIncomingPayment(String value) {
        String text = value.toLowerCase(Locale.ROOT);
        if (text.matches(".*\\b(enviaste|transferiste|retiro|retiraste|debito|salida|pagaste)\\b.*")) return false;
        return text.matches(".*(recib|transfer|consign|abono|deposit|pago|llave|bre-b|transfiya|movimiento|ingreso|entr[oó]).*");
    }

    private static Integer extractAmount(String value) {
        Matcher matcher = MONEY.matcher(value);
        if (!matcher.find()) return null;
        String raw = matcher.group(1).replace(".", "").replace(",", "");
        try { return Integer.valueOf(raw); } catch (Exception ignored) { return null; }
    }

    private static String extractReference(String value) {
        Matcher matcher = REFERENCE.matcher(value);
        return matcher.find() ? matcher.group(1).substring(0, Math.min(80, matcher.group(1).length())) : null;
    }

    private static String extractPayerIdentifier(String value) {
        Matcher matcher = PHONE.matcher(value);
        if (!matcher.find()) return null;
        String raw = matcher.group();
        String digits = raw.replaceAll("\\D", "");
        return digits.length() >= 4 ? digits.substring(Math.max(0, digits.length() - 10)) : digits;
    }

    private static String detectProvider(String packageName, String text) {
        String value = (packageName + " " + text).toLowerCase(Locale.ROOT);
        if (value.contains("bancolombia")) return "Bancolombia";
        if (value.contains("nequi")) return "Nequi";
        if (value.contains("daviplata") || value.contains("davivienda")) return "Daviplata";
        if (value.contains("transfiya")) return "Transfiya";
        if (value.contains("com.google.android.gm") || value.contains("gmail")) return "Gmail";
        return packageName;
    }

    private static String detectChannel(String text) {
        String value = text.toLowerCase(Locale.ROOT);
        if (value.contains("llave") || value.contains("bre-b") || value.contains("banco a la mano")) return "llave";
        if (value.contains("cuenta") || value.contains("número de cuenta") || value.contains("numero de cuenta")) return "cuenta";
        if (value.contains("otro banco") || value.contains("interbancaria") || value.contains("ach")) return "otro_banco";
        return "no_informado";
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte item : bytes) result.append(String.format(Locale.US, "%02x", item));
            return result.toString();
        } catch (Exception ignored) { return String.valueOf(value.hashCode()); }
    }

    @Override public void onDestroy() { executor.shutdownNow(); super.onDestroy(); }
}
