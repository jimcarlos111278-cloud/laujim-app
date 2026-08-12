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
        ScraperWorkerStore.setSchedulerEvent(context, "alarm_received", "alarm", "Android entregó la alarma de servicios.");
        ScraperWorkerSchedule.scheduleNextAlarm(context, "alarm-received");
        ScraperWorkerDispatcher.dispatch(context, "alarm", false);
    }
}
