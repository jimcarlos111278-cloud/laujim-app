package com.laujim.aptmanager;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Periodic network wake-up for Marketplace jobs queued from any device. */
public class MarketplaceQueueWorker extends Worker {
    public MarketplaceQueueWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        if (!ScraperWorkerStore.enabled(getApplicationContext())) return Result.success();
        return MarketplaceWorkerDispatcher.dispatch(getApplicationContext(), "marketplace-workmanager", false)
            ? Result.success()
            : Result.retry();
    }
}
