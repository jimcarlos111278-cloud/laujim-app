package com.laujim.aptmanager;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.Calendar;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

/**
 * One shared schedule for Air-e, Triple A and Gases del Caribe.
 *
 * WorkManager is the durable scheduler that survives process/device restarts.
 * A one-shot AlarmManager alarm is kept as a punctual wake-up path. Both use
 * the same PendingIntent/unique-work identities and the dispatcher suppresses
 * duplicates when Android delivers them close together.
 */
final class ScraperWorkerSchedule {
    private static final int REQUEST_CODE = 31777;
    private static final String PERIODIC_WORK_NAME = "laujim-utilities-periodic";
    private static final String PERIODIC_WORK_TAG = "laujim-utilities";
    private static final long MIN_DELAY_MS = 15_000L;
    private static final long MIN_WORK_INTERVAL_MS = 15L * 60L * 1000L;

    private ScraperWorkerSchedule() {}

    static void scheduleAll(Context context, String reason) {
        Context app = context.getApplicationContext();
        if (!ScraperWorkerStore.enabled(app)) {
            cancel(app);
            return;
        }
        long nextAt = calculateNextRunAt(app, System.currentTimeMillis());
        scheduleAlarmAt(app, nextAt, reason);
        boolean workScheduled = schedulePeriodicWork(app, nextAt, reason);
        boolean exact = canScheduleExactAlarms(app);
        if (!workScheduled) {
            ScraperWorkerStore.setNextRunAt(app, nextAt, exact ? "exact-only" : "inexact-only", reason);
        }
        ScraperWorkerStore.setSchedulerEvent(
            app,
            workScheduled ? "scheduled" : "workmanager_schedule_failed",
            "scheduler",
            workScheduled
                ? (exact ? "Alarma exacta y respaldo WorkManager programados." : "Alarma flexible y respaldo WorkManager programados.")
                : "La alarma quedó activa, pero Android no aceptó el respaldo WorkManager."
        );
    }

    static void scheduleNextAlarm(Context context, String reason) {
        Context app = context.getApplicationContext();
        if (!ScraperWorkerStore.enabled(app)) return;
        scheduleAlarmAt(app, calculateNextRunAt(app, System.currentTimeMillis()), reason);
    }

    static void cancel(Context context) {
        Context app = context.getApplicationContext();
        AlarmManager alarms = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(pendingIntent(app));
        WorkManager.getInstance(app).cancelUniqueWork(PERIODIC_WORK_NAME);
        ScraperWorkerStore.setNextRunAt(app, 0L, "disabled", "worker-disabled");
    }

    static boolean canScheduleExactAlarms(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return alarms != null && alarms.canScheduleExactAlarms();
    }

    static long calculateNextRunAt(Context context, long now) {
        return calculateNextRunAt(
            now,
            ScraperWorkerStore.intervalHours(context),
            ScraperWorkerStore.startAt(context),
            ScraperWorkerStore.timezone(context)
        );
    }

    static long calculateCurrentSlotAt(Context context, long now) {
        return calculateCurrentSlotAt(
            now,
            ScraperWorkerStore.intervalHours(context),
            ScraperWorkerStore.startAt(context),
            ScraperWorkerStore.timezone(context)
        );
    }

    static long calculateCurrentSlotAt(long now, int requestedIntervalHours, String requestedStartAt, String requestedTimezone) {
        long intervalMs = ScraperWorkerStore.clampHours(requestedIntervalHours) * 60L * 60L * 1000L;
        return calculateNextRunAt(now, requestedIntervalHours, requestedStartAt, requestedTimezone) - intervalMs;
    }

    static long calculateNextRunAt(long now, int requestedIntervalHours, String requestedStartAt, String requestedTimezone) {
        int intervalHours = ScraperWorkerStore.clampHours(requestedIntervalHours);
        long intervalMs = intervalHours * 60L * 60L * 1000L;
        String[] time = ScraperWorkerStore.normalizeStartAt(requestedStartAt).split(":");
        int hour = Integer.parseInt(time[0]);
        int minute = Integer.parseInt(time[1]);
        TimeZone zone = TimeZone.getTimeZone(ScraperWorkerStore.normalizeTimezone(requestedTimezone));

        Calendar anchor = Calendar.getInstance(zone);
        anchor.setTimeInMillis(now);
        anchor.set(Calendar.HOUR_OF_DAY, hour);
        anchor.set(Calendar.MINUTE, minute);
        anchor.set(Calendar.SECOND, 0);
        anchor.set(Calendar.MILLISECOND, 0);
        if (anchor.getTimeInMillis() > now) anchor.add(Calendar.DAY_OF_MONTH, -1);

        long anchorAt = anchor.getTimeInMillis();
        long completedIntervals = Math.max(0L, (now - anchorAt) / intervalMs);
        long nextAt = anchorAt + (completedIntervals + 1L) * intervalMs;
        while (nextAt <= now + MIN_DELAY_MS) nextAt += intervalMs;
        return nextAt;
    }

    private static PendingIntent pendingIntent(Context context) {
        Intent intent = new Intent(context, ScraperWorkerAlarmReceiver.class)
            .setAction(ScraperWorkerService.ACTION_RUN)
            .putExtra("triggerSource", "alarm");
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags);
    }

    private static void scheduleAlarmAt(Context context, long nextAt, String reason) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) {
            ScraperWorkerStore.setNextRunAt(context, nextAt, "workmanager-only", reason);
            ScraperWorkerStore.setSchedulerEvent(context, "alarm_unavailable", "scheduler", "Android no expuso AlarmManager; queda activo WorkManager.");
            return;
        }
        PendingIntent intent = pendingIntent(context);
        boolean exact = canScheduleExactAlarms(context);
        try {
            if (exact && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextAt, intent);
            } else if (exact) {
                alarms.setExact(AlarmManager.RTC_WAKEUP, nextAt, intent);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextAt, intent);
            } else {
                alarms.set(AlarmManager.RTC_WAKEUP, nextAt, intent);
            }
            ScraperWorkerStore.setNextRunAt(context, nextAt, exact ? "exact+workmanager" : "inexact+workmanager", reason);
        } catch (SecurityException error) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextAt, intent);
            ScraperWorkerStore.setNextRunAt(context, nextAt, "inexact+workmanager", reason);
            ScraperWorkerStore.setSchedulerEvent(context, "exact_permission_missing", "scheduler", "Android negó la alarma exacta; se usará el respaldo flexible.");
        }
    }

    private static boolean schedulePeriodicWork(Context context, long nextAt, String reason) {
        try {
            long intervalMs = Math.max(MIN_WORK_INTERVAL_MS, ScraperWorkerStore.intervalHours(context) * 60L * 60L * 1000L);
            long initialDelay = Math.max(MIN_DELAY_MS, nextAt - System.currentTimeMillis());
            Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
            PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                ScraperWorkerKickWorker.class,
                intervalMs,
                TimeUnit.MILLISECONDS
            )
                .setInitialDelay(initialDelay, TimeUnit.MILLISECONDS)
                .setConstraints(constraints)
                .addTag(PERIODIC_WORK_TAG)
                .build();
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_WORK_NAME,
                shouldReplacePeriodicWork(reason)
                    ? ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE
                    : ExistingPeriodicWorkPolicy.KEEP,
                request
            );
            return true;
        } catch (RuntimeException error) {
            return false;
        }
    }

    private static boolean shouldReplacePeriodicWork(String reason) {
        String value = reason == null ? "" : reason;
        return "native-config-updated".equals(value)
            || "worker-started".equals(value)
            || "manual-reschedule".equals(value)
            || "exact-permission-detected".equals(value)
            || "server-schedule-changed".equals(value)
            || "boot-or-package-update".equals(value)
            || "service-destroyed".equals(value)
            || "service-task-removed".equals(value);
    }
}
