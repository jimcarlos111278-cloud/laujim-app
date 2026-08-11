package com.laujim.aptmanager;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;

final class ScraperWorkerAlarm {
    private static final int REQUEST_CODE = 31777;

    private ScraperWorkerAlarm() {}

    private static PendingIntent pendingIntent(Context context) {
        Intent intent = new Intent(context, ScraperWorkerAlarmReceiver.class)
            .setAction(ScraperWorkerService.ACTION_RUN);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags);
    }

    static void scheduleNext(Context context, long delayMs) {
        if (!ScraperWorkerStore.enabled(context)) return;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        long safeDelay = Math.max(60_000L, delayMs);
        long triggerAt = SystemClock.elapsedRealtime() + safeDelay;
        PendingIntent intent = pendingIntent(context);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, intent);
        } else {
            alarms.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, intent);
        }
    }

    static void cancel(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(pendingIntent(context));
    }
}
