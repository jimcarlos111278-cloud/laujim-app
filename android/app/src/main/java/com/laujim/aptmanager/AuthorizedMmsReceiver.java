package com.laujim.aptmanager;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Required Android endpoint for the default-SMS role. MMS is not handled by Laujim. */
public class AuthorizedMmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        // Laujim's protected mode currently covers plain SMS only.
    }
}
