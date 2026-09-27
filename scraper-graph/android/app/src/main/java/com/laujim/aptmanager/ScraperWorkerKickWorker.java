package com.laujim.aptmanager;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Durable WorkManager wake-up used for all enabled utility providers. */
public class ScraperWorkerKickWorker extends Worker {
    static final String INPUT_RETRY_PROVIDER = "retryProvider";
    static final String INPUT_RETRY_REASON = "retryReason";
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
        String retryProvider = getInputData().getString(INPUT_RETRY_PROVIDER);
        String retryReason = getInputData().getString(INPUT_RETRY_REASON);
        long now = System.currentTimeMillis();
        ScraperWorkerStore.setLastWorkManagerAt(context, now);
        if (retryProvider != null && !retryProvider.trim().isEmpty()) {
            String source = "provider-retry:" + (retryReason == null ? "incomplete" : retryReason);
            ScraperWorkerStore.setSchedulerEvent(context, "provider_retry_received", retryProvider, "WorkManager inició la recuperación independiente del proveedor.");
            return ScraperWorkerDispatcher.dispatchProvider(context, source, retryProvider, true, true)
                ? Result.success()
                : Result.retry();
        }
        ScraperWorkerStore.setSchedulerEvent(context, "workmanager_received", "workmanager", "WorkManager despertó el programador de los tres servicios.");
        // This worker only wakes the foreground service. Calling
        // setForegroundAsync() here made WorkManager report that the
        // foreground transition had not completed when the short-lived
        // wake-up worker returned. ScraperWorkerService promotes itself to
        // the foreground before doing any portal work, so no second
        // foreground transition is needed in this dispatcher.
        return ScraperWorkerDispatcher.dispatch(context, "workmanager", false)
            ? Result.success()
            : Result.retry();
    }
}
