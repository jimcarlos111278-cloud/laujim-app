package com.laujim.callguard;

import android.os.Build;
import android.telecom.Call;
import android.telecom.CallScreeningService;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class CallGuardScreeningService extends CallScreeningService {
    @Override
    public void onScreenCall(Call.Details callDetails) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            && callDetails.getCallDirection() != Call.Details.DIRECTION_INCOMING) {
            return;
        }

        String phone = callDetails.getHandle() == null ? "" : callDetails.getHandle().getSchemeSpecificPart();
        boolean allowed = CallGuardStore.isAllowed(this, phone);
        CallResponse.Builder response = new CallResponse.Builder();

        if (!allowed) {
            // Rechazo silencioso sin timbrar ni notificar al usuario
            response.setDisallowCall(true);
            response.setRejectCall(true);
            response.setSkipNotification(true);
            response.setSkipCallLog(false);

            String reason = "Número desconocido no registrado en Laujim";
            String category = "unknown";
            String norm = CallGuardStore.normalize(phone);

            if (norm.startsWith("320987") || norm.startsWith("310999") || norm.startsWith("301666") || norm.length() < 10) {
                reason = "Sospecha de Fraude / Extorsión (Lista Negra)";
                category = "fraud";
            }

            CallGuardStore.recordBlockedCall(this, phone, "Número no registrado", reason, category);
            reportBlockedCallAsync(norm, reason, category);
        }

        respondToCall(callDetails, response.build());
    }

    private void reportBlockedCallAsync(String phone, String reason, String category) {
        new Thread(() -> {
            try {
                String serverUrl = CallGuardStore.getServerUrl(this);
                URL url = new URL(serverUrl + "/api/callguard/blocked-calls");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("x-auth-token", CallGuardStore.getAuthToken(this));
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.setDoOutput(true);

                String payload = "{\"phone\":\"" + phone + "\",\"reason\":\"" + reason + "\",\"category\":\"" + category + "\",\"hasWhatsApp\":true}";
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload.getBytes(StandardCharsets.UTF_8));
                }
                conn.getResponseCode();
                conn.disconnect();
            } catch (Exception ignored) {}
        }).start();
    }
}
