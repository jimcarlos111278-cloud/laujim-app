package com.laujim.aptmanager;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ScraperWorkerBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ScraperWorkerStore.enabled(context)) return;
        ScraperWorkerAlarm.scheduleNext(context, 30_000L);
    }
}
