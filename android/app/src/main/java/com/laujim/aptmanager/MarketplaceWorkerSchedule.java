package com.laujim.aptmanager;

import android.content.Context;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

/** Android's minimum durable polling interval is 15 minutes. */
final class MarketplaceWorkerSchedule {
    private static final String WORK_NAME = "laujim-marketplace-queue";
    private static final long INTERVAL_MINUTES = 15L;

    private MarketplaceWorkerSchedule() {}

    static void schedule(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            MarketplaceQueueWorker.class,
            INTERVAL_MINUTES,
            TimeUnit.MINUTES
        ).setConstraints(constraints).build();
        WorkManager.getInstance(context.getApplicationContext()).enqueueUniquePeriodicWork(
            WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        );
        ScraperWorkerStore.setMarketplaceNextCheckAt(context, System.currentTimeMillis() + TimeUnit.MINUTES.toMillis(INTERVAL_MINUTES));
    }

    static void cancel(Context context) {
        WorkManager.getInstance(context.getApplicationContext()).cancelUniqueWork(WORK_NAME);
        ScraperWorkerStore.setMarketplaceNextCheckAt(context, 0L);
    }
}
