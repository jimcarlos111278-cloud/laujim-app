package com.laujim.aptmanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

/** Durable WorkManager wake-up used for all enabled utility providers. */
public class ScraperWorkerKickWorker extends Worker {
    private static final String CHANNEL_ID = "laujim_scraper_scheduler";
    private static final int NOTIFICATION_ID = 31780;

    public ScraperWorkerKickWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        if (!ScraperWorkerStore.enabled(context)) return Result.success();
        long now = System.currentTimeMillis();
        ScraperWorkerStore.setLastWorkManagerAt(context, now);
        ScraperWorkerStore.setSchedulerEvent(context, "workmanager_received", "workmanager", "WorkManager despertó el programador de los tres servicios.");
        try {
            setForegroundAsync(foregroundInfo()).get(15, TimeUnit.SECONDS);
            return ScraperWorkerDispatcher.dispatch(context, "workmanager", false)
                ? Result.success()
                : Result.retry();
        } catch (Exception error) {
            String message = "WorkManager no pudo preparar la ejecución: " + String.valueOf(error.getMessage());
            ScraperWorkerStore.setSchedulerEvent(context, "workmanager_failed", "workmanager", message);
            ScraperWorkerStore.setRunState(context, "scheduler-error", message);
            return Result.retry();
        }
    }

    private ForegroundInfo foregroundInfo() {
        Context context = getApplicationContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.createNotificationChannel(new NotificationChannel(
                CHANNEL_ID,
                "Programador de servicios Laujim",
                NotificationManager.IMPORTANCE_LOW
            ));
        }
        Intent launch = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle("Laujim · Servicios")
            .setContentText("Preparando actualización de Air-e, Triple A y Gases…")
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pending)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return new ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        }
        return new ForegroundInfo(NOTIFICATION_ID, notification);
    }
}
