package com.laujim.aptmanager;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

/** Required Android endpoint for the default-SMS role; quick-reply sending is not exposed yet. */
public class RespondViaMessageService extends Service {
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
