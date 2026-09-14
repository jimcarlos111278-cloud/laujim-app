package com.laujim.callguard;

import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.ContactsContract;
import android.telecom.Call;
import android.telecom.CallAudioState;
import android.view.View;
import android.view.WindowManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class InCallActivity extends Activity implements CallManager.CallListener {
    private TextView tvAptBadge;
    private TextView tvAvatar;
    private ImageView ivAvatar;
    private TextView tvCallerName;
    private TextView tvPhoneNumber;
    private TextView tvCallStatus;
    private Button btnMute;
    private Button btnSpeaker;
    private Button btnKeypadToggle;
    private Button btnHangup;
    private Button btnAnswer;
    private Button btnReject;
    private LinearLayout layoutIncomingActions;
    private LinearLayout layoutActiveControls;

    private boolean isMuted = false;
    private boolean isSpeakerOn = false;
    private long callConnectTime = 0L;
    private final Handler timerHandler = new Handler(Looper.getMainLooper());
    private final Runnable timerRunnable = new Runnable() {
        @Override
        public void run() {
            if (callConnectTime > 0L) {
                long elapsed = (SystemClock.elapsedRealtime() - callConnectTime) / 1000L;
                long mins = elapsed / 60L;
                long secs = elapsed % 60L;
                tvCallStatus.setText(String.format("En llamada · %02d:%02d", mins, secs));
                timerHandler.postDelayed(this, 1000L);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            );
        }

        setContentView(R.layout.activity_in_call);

        View root = findViewById(R.id.rootInCall);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            Insets insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(v.getPaddingLeft(), insets.top, v.getPaddingRight(), insets.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        tvAptBadge = findViewById(R.id.tvAptBadge);
        tvAvatar = findViewById(R.id.tvAvatar);
        ivAvatar = findViewById(R.id.ivAvatar);
        tvCallerName = findViewById(R.id.tvCallerName);
        tvPhoneNumber = findViewById(R.id.tvPhoneNumber);
        tvCallStatus = findViewById(R.id.tvCallStatus);
        btnMute = findViewById(R.id.btnMute);
        btnSpeaker = findViewById(R.id.btnSpeaker);
        btnKeypadToggle = findViewById(R.id.btnKeypadToggle);
        btnHangup = findViewById(R.id.btnHangup);
        btnAnswer = findViewById(R.id.btnAnswer);
        btnReject = findViewById(R.id.btnReject);
        layoutIncomingActions = findViewById(R.id.layoutIncomingActions);
        layoutActiveControls = findViewById(R.id.layoutActiveControls);

        btnHangup.setOnClickListener(v -> CallManager.disconnect());
        btnAnswer.setOnClickListener(v -> CallManager.answer());
        btnReject.setOnClickListener(v -> CallManager.reject());

        btnMute.setOnClickListener(v -> {
            isMuted = !isMuted;
            CallManager.setMuted(isMuted);
            btnMute.setText(isMuted ? "🔇" : "🎙️");
            btnMute.setBackgroundColor(isMuted ? 0xFFDC2626 : 0xFF1E293B);
        });

        btnSpeaker.setOnClickListener(v -> {
            isSpeakerOn = !isSpeakerOn;
            CallManager.toggleSpeaker(isSpeakerOn);
            btnSpeaker.setBackgroundColor(isSpeakerOn ? 0xFF16A34A : 0xFF1E293B);
        });

        CallManager.registerListener(this);
        updateUI(CallManager.getCall());
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        timerHandler.removeCallbacks(timerRunnable);
        CallManager.unregisterListener(this);
    }

    private void updateUI(Call call) {
        if (call == null) {
            finish();
            return;
        }

        String rawNumber = "";
        if (call.getDetails() != null && call.getDetails().getHandle() != null) {
            rawNumber = call.getDetails().getHandle().getSchemeSpecificPart();
        }

        tvPhoneNumber.setText(rawNumber);
        resolveCallerInfo(rawNumber);

        int state = call.getState();
        if (state == Call.STATE_RINGING) {
            tvCallStatus.setText("Llamada entrante...");
            tvCallStatus.setTextColor(0xFF34D399);
            layoutIncomingActions.setVisibility(View.VISIBLE);
            btnHangup.setVisibility(View.GONE);
            layoutActiveControls.setVisibility(View.GONE);
        } else if (state == Call.STATE_ACTIVE) {
            if (callConnectTime == 0L) {
                callConnectTime = SystemClock.elapsedRealtime();
                timerHandler.post(timerRunnable);
            }
            tvCallStatus.setTextColor(0xFF38BDF8);
            layoutIncomingActions.setVisibility(View.GONE);
            btnHangup.setVisibility(View.VISIBLE);
            layoutActiveControls.setVisibility(View.VISIBLE);
        } else if (state == Call.STATE_DIALING || state == Call.STATE_CONNECTING) {
            tvCallStatus.setText("Marcando...");
            tvCallStatus.setTextColor(0xFFFBBF24);
            layoutIncomingActions.setVisibility(View.GONE);
            btnHangup.setVisibility(View.VISIBLE);
            layoutActiveControls.setVisibility(View.VISIBLE);
        } else if (state == Call.STATE_DISCONNECTED || state == Call.STATE_DISCONNECTING) {
            timerHandler.removeCallbacks(timerRunnable);
            tvCallStatus.setText("Llamada finalizada");
            tvCallStatus.setTextColor(0xFFEF4444);
            new Handler(Looper.getMainLooper()).postDelayed(this::finish, 800L);
        }
    }

    private void resolveCallerInfo(String rawNumber) {
        if (rawNumber == null || rawNumber.isEmpty()) {
            tvCallerName.setText("Desconocido");
            tvAvatar.setText("?");
            return;
        }

        String norm = CallGuardStore.normalize(rawNumber);
        JSONObject tenant = CallGuardStore.getTenantByPhone(this, norm);
        if (tenant != null) {
            String name = tenant.optString("name", "Inquilino Laujim");
            String apt = tenant.optString("apartment", "");
            tvCallerName.setText(name);
            tvAptBadge.setText("🏢 Apto " + apt + " · Laujim");
            tvAptBadge.setVisibility(View.VISIBLE);
            if (!name.isEmpty()) {
                tvAvatar.setText(name.substring(0, 1).toUpperCase());
            }
            return;
        }

        // Contact Lookup from Phone Agenda
        String contactName = getContactName(this, rawNumber);
        if (contactName != null && !contactName.isEmpty()) {
            tvCallerName.setText(contactName);
            tvAptBadge.setText("📱 Contacto Telefónico");
            tvAptBadge.setVisibility(View.VISIBLE);
            tvAvatar.setText(contactName.substring(0, 1).toUpperCase());
            return;
        }

        // Show temporary state while looking up
        tvCallerName.setText(rawNumber);
        tvAptBadge.setText("🔍 Identificando llamada...");
        tvAptBadge.setVisibility(View.VISIBLE);
        tvAvatar.setText("#");

        // Server-side lookup (Truecaller, spam DB, carrier, WhatsApp avatar)
        final String lookupNumber = norm;
        new Thread(() -> {
            try {
                String server = CallGuardStore.getServerUrl(InCallActivity.this);
                URL url = new URL(server + "/api/callguard/lookup?phone=" + lookupNumber);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);

                if (conn.getResponseCode() == 200) {
                    BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                    br.close();

                    JSONObject result = new JSONObject(sb.toString());
                    final String name = result.optString("name", rawNumber);
                    final String badge = result.optString("badge", "📞 Llamada");
                    final boolean isSpam = result.optBoolean("isSpam", false);
                    final int spamScore = result.optInt("spamScore", 0);
                    final String avatarUrlStr = result.optString("avatarUrl", null);

                    // Download avatar bitmap if available
                    final Bitmap avatarBitmap;
                    if (avatarUrlStr != null && !avatarUrlStr.isEmpty()) {
                        Bitmap tmp = null;
                        try {
                            InputStream imgStream = new URL(avatarUrlStr).openStream();
                            tmp = BitmapFactory.decodeStream(imgStream);
                            imgStream.close();
                        } catch (Exception ignored) {}
                        avatarBitmap = tmp;
                    } else {
                        avatarBitmap = null;
                    }

                    runOnUiThread(() -> {
                        tvCallerName.setText(name);
                        tvAptBadge.setText(badge);
                        tvAptBadge.setVisibility(View.VISIBLE);

                        if (isSpam) {
                            tvAptBadge.setBackgroundColor(0x33EF4444);
                            tvCallerName.setTextColor(0xFFEF4444);
                        }

                        if (avatarBitmap != null) {
                            ivAvatar.setImageBitmap(avatarBitmap);
                            ivAvatar.setVisibility(View.VISIBLE);
                            tvAvatar.setVisibility(View.GONE);
                        } else if (!name.isEmpty() && !name.equals(rawNumber)) {
                            tvAvatar.setText(name.substring(0, 1).toUpperCase());
                        }
                    });
                }
            } catch (Exception ignored) {
                // Keep the default display on failure
            }
        }).start();
    }

    private String getContactName(Context context, String phone) {
        if (checkSelfPermission(android.Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return null;
        Cursor cursor = null;
        try {
            Uri uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(phone));
            cursor = context.getContentResolver().query(uri, new String[]{ContactsContract.PhoneLookup.DISPLAY_NAME}, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getString(cursor.getColumnIndexOrThrow(ContactsContract.PhoneLookup.DISPLAY_NAME));
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        return null;
    }

    @Override
    public void onCallChanged(Call call) {
        runOnUiThread(() -> updateUI(call));
    }

    @Override
    public void onCallRemoved(Call call) {
        runOnUiThread(() -> {
            timerHandler.removeCallbacks(timerRunnable);
            tvCallStatus.setText("Llamada finalizada");
            new Handler(Looper.getMainLooper()).postDelayed(this::finish, 600L);
        });
    }

    @Override
    public void onAudioStateChanged(CallAudioState audioState) {
        if (audioState == null) return;
        runOnUiThread(() -> {
            isMuted = audioState.isMuted();
            btnMute.setText(isMuted ? "🔇" : "🎙️");
            btnMute.setBackgroundColor(isMuted ? 0xFFDC2626 : 0xFF1E293B);

            isSpeakerOn = (audioState.getRoute() == CallAudioState.ROUTE_SPEAKER);
            btnSpeaker.setBackgroundColor(isSpeakerOn ? 0xFF16A34A : 0xFF1E293B);
        });
    }
}
