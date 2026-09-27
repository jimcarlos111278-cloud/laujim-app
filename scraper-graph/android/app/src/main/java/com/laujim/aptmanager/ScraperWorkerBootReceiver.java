package com.laujim.aptmanager;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ScraperWorkerBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ScraperWorkerStore.enabled(context)) return;
        ScraperWorkerSchedule.scheduleAll(context, "boot-or-package-update");
        MarketplaceWorkerSchedule.schedule(context);
        ScraperWorkerStore.setSchedulerEvent(context, "device_boot", "boot", "Android reinició o actualizó Laujim; se restauró el horario de los tres servicios.");
    }
}
