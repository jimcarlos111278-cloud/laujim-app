package com.laujim.aptmanager;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AuthorizedCallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
