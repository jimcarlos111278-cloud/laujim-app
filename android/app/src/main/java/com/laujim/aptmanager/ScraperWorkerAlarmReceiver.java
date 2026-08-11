package com.laujim.aptmanager;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

public class ScraperWorkerAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ScraperWorkerStore.enabled(context)) return;
        Intent service = new Intent(context, ScraperWorkerService.class)
            .setAction(ScraperWorkerService.ACTION_RUN);
        try {
            ContextCompat.startForegroundService(context, service);
        } catch (RuntimeException error) {
            ScraperWorkerStore.setRunState(context, "error", "Android no pudo iniciar el servicio: " + error.getMessage());
        }
    }
}
