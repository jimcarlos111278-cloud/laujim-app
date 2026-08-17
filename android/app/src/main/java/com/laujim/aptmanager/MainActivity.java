package com.laujim.aptmanager;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int FILE_CHOOSER_REQUEST = 4817;
    private ValueCallback<Uri[]> pendingFileCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AuthorizedCallerPlugin.class);
        registerPlugin(ScraperWorkerPlugin.class);
        super.onCreate(savedInstanceState);

        // Capacitor's default WebView does not consistently return the result of
        // Android's Photo Picker on every Samsung/WebView combination. Keep the
        // callback in the activity so a photo selected from the phone is always
        // delivered back to the HTML input that started the picker.
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) {
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
                ) {
                    if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
                    pendingFileCallback = filePathCallback;
                    try {
                        Intent chooser = fileChooserParams == null
                            ? new Intent(Intent.ACTION_OPEN_DOCUMENT)
                            : fileChooserParams.createIntent();
                        chooser.addCategory(Intent.CATEGORY_OPENABLE);
                        chooser.setType("image/*");
                        chooser.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                        startActivityForResult(chooser, FILE_CHOOSER_REQUEST);
                        return true;
                    } catch (Exception error) {
                        pendingFileCallback = null;
                        filePathCallback.onReceiveValue(null);
                        return false;
                    }
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            ValueCallback<Uri[]> callback = pendingFileCallback;
            pendingFileCallback = null;
            if (callback != null) {
                Uri[] results = null;
                if (resultCode == Activity.RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        results = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    } else if (data.getData() != null) {
                        results = new Uri[] { data.getData() };
                    }
                }
                callback.onReceiveValue(results);
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onDestroy() {
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
        super.onDestroy();
    }
}
