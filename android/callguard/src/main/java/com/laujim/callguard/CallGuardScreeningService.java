package com.laujim.callguard;

import android.os.Build;
import android.telecom.Call;
import android.telecom.CallScreeningService;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.WorkRequest;
import com.laujim.callguard.data.BlockedCallEntity;
import com.laujim.callguard.data.CallGuardDatabase;
import com.laujim.callguard.data.ColombiaPhoneNormalizer;
import com.laujim.callguard.sync.CallerLookupWorker;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class CallGuardScreeningService extends CallScreeningService {
    private final ExecutorService databaseExecutor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService deadlineExecutor = Executors.newSingleThreadScheduledExecutor();

    @Override
    public void onScreenCall(Call.Details details) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && details.getCallDirection() != Call.Details.DIRECTION_INCOMING) {
            return;
        }

        String raw = details.getHandle() == null ? null : details.getHandle().getSchemeSpecificPart();
        String phoneE164 = ColombiaPhoneNormalizer.toE164(raw);

        AtomicBoolean responded = new AtomicBoolean(false);

        // Fail-closed deadline a los 3500ms (Telecom exige < 5000ms)
        Runnable rejectOnDeadline = () -> {
            if (responded.compareAndSet(false, true)) {
                respondToCall(details, rejectedResponse());
                recordBlockedAndEnqueueLookup(phoneE164, phoneE164 == null ? "BLOCKED_PRIVATE" : "BLOCKED_UNKNOWN");
            }
        };

        ScheduledFuture<?> deadline = deadlineExecutor.schedule(rejectOnDeadline, 3500, TimeUnit.MILLISECONDS);

        databaseExecutor.execute(() -> {
            boolean allowed = false;
            if (phoneE164 != null) {
                try {
                    // Consulta Room rápida en tabla indexada
                    allowed = CallGuardDatabase.getInstance(getApplicationContext())
                            .allowedNumberDao()
                            .isAllowedBlocking(phoneE164);
                    // Respaldo en Store SharedPreferences si aún no se ha migrado
                    if (!allowed) {
                        allowed = CallGuardStore.isAllowed(getApplicationContext(), phoneE164);
                    }
                } catch (Exception e) {
                    allowed = false;
                }
            }

            if (!responded.compareAndSet(false, true)) {
                return;
            }

            deadline.cancel(false);

            if (allowed) {
                respondToCall(details, new CallResponse.Builder().build());
            } else {
                respondToCall(details, rejectedResponse());
                recordBlockedAndEnqueueLookup(phoneE164, phoneE164 == null ? "BLOCKED_PRIVATE" : "BLOCKED_UNKNOWN");
            }
        });
    }

    private static CallResponse rejectedResponse() {
        return new CallResponse.Builder()
                .setDisallowCall(true)
                .setRejectCall(true)
                .setSkipCallLog(true)
                .setSkipNotification(true)
                .build();
    }

    private void recordBlockedAndEnqueueLookup(String phoneE164, String reason) {
        String eventId = UUID.randomUUID().toString();
        long now = System.currentTimeMillis();

        // Guardar localmente en Room
        databaseExecutor.execute(() -> {
            try {
                BlockedCallEntity entity = new BlockedCallEntity(
                        eventId,
                        phoneE164,
                        reason,
                        now,
                        "QUEUED"
                    );
                CallGuardDatabase.getInstance(getApplicationContext()).blockedCallDao().insert(entity);
            } catch (Exception ignored) {}
        });

        // Encolar trabajo de enriquecimiento con Truecaller mediante WorkManager
        if (phoneE164 != null) {
            enqueueCallerLookup(eventId, phoneE164);
        }
    }

    private void enqueueCallerLookup(String eventId, String phoneE164) {
        try {
            Data input = new Data.Builder()
                    .putString("event_id", eventId)
                    .putString("phone_e164", phoneE164)
                    .build();

            Constraints constraints = new Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build();

            OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(CallerLookupWorker.class)
                    .setInputData(input)
                    .setConstraints(constraints)
                    .setBackoffCriteria(
                            BackoffPolicy.EXPONENTIAL,
                            WorkRequest.MIN_BACKOFF_MILLIS,
                            TimeUnit.MILLISECONDS)
                    .build();

            String uniqueName = "caller-lookup-" + phoneE164.replace("+", "");
            WorkManager.getInstance(getApplicationContext()).enqueueUniqueWork(
                    uniqueName,
                    ExistingWorkPolicy.KEEP,
                    request
            );
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        databaseExecutor.shutdownNow();
        deadlineExecutor.shutdownNow();
        super.onDestroy();
    }
}
