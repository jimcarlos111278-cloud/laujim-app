package com.laujim.aptmanager;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ScraperWorkerAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ScraperWorkerStore.enabled(context)) return;
        long now = System.currentTimeMillis();
        ScraperWorkerStore.setLastAlarmAt(context, now);
        String provider = intent == null ? "" : intent.getStringExtra(ScraperWorkerService.EXTRA_PROVIDER);
        if (provider != null && !provider.trim().isEmpty()) {
            ScraperWorkerStore.setSchedulerEvent(context, "provider_retry_alarm_received", provider, "Android entregó la recuperación independiente del proveedor.");
            boolean dispatched = ScraperWorkerDispatcher.dispatchProvider(
                context,
                "provider-retry-alarm",
                provider,
                intent.getBooleanExtra(ScraperWorkerService.EXTRA_RESET_PROVIDER_SESSION, true),
                true
            );
            if (!dispatched) ScraperWorkerSchedule.scheduleProviderRetry(context, provider, "alarm-dispatch-failed");
            return;
        }
        ScraperWorkerStore.setSchedulerEvent(context, "alarm_received", "alarm", "Android entregó la alarma de servicios.");
        ScraperWorkerSchedule.scheduleNextAlarm(context, "alarm-received");
        ScraperWorkerDispatcher.dispatch(context, "alarm", false);
    }
}
