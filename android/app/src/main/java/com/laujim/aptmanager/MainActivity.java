package com.laujim.aptmanager;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int FILE_CHOOSER_REQUEST = 4817;
    private static final int MICROPHONE_PERMISSION_REQUEST = 4818;
    private ValueCallback<Uri[]> pendingFileCallback;
    private PermissionRequest pendingWebPermissionRequest;
    private final Handler deepLinkHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AuthorizedCallerPlugin.class);
        registerPlugin(ScraperWorkerPlugin.class);
        registerPlugin(BackgroundNotificationsPlugin.class);
        registerPlugin(PaymentWatcherPlugin.class);
        super.onCreate(savedInstanceState);

        // Capacitor's default WebView does not consistently return the result of
        // Android's Photo Picker on every Samsung/WebView combination. Keep the
        // callback in the activity so a photo selected from the phone is always
        // delivered back to the HTML input that started the picker.
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) {
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(PermissionRequest request) {
                    runOnUiThread(() -> {
                        if (request == null) return;
                        boolean needsAudio = false;
                        for (String resource : request.getResources()) {
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                                needsAudio = true;
                                break;
                            }
                        }
                        if (!needsAudio) {
                            request.deny();
                            return;
                        }
                        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                        } else {
                            if (pendingWebPermissionRequest != null) pendingWebPermissionRequest.deny();
                            pendingWebPermissionRequest = request;
                            requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, MICROPHONE_PERMISSION_REQUEST);
                        }
                    });
                }

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
        dispatchWhatsAppIntent(getIntent());
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != MICROPHONE_PERMISSION_REQUEST || pendingWebPermissionRequest == null) return;
        PermissionRequest request = pendingWebPermissionRequest;
        pendingWebPermissionRequest = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
        } else {
            request.deny();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        dispatchWhatsAppIntent(intent);
    }

    private void dispatchWhatsAppIntent(Intent intent) {
        if (intent == null || !BackgroundNotificationService.ACTION_OPEN_WHATSAPP.equals(intent.getAction())) return;
        int conversationId = intent.getIntExtra(BackgroundNotificationService.EXTRA_CONVERSATION_ID, 0);
        if (conversationId <= 0) return;
        deepLinkHandler.postDelayed(() -> {
            WebView webView = getBridge() == null ? null : getBridge().getWebView();
            if (webView == null) return;
            webView.evaluateJavascript("(function(){window.__laujimPendingConversation=" + conversationId + ";window.dispatchEvent(new CustomEvent('laujim:open-whatsapp',{detail:{conversationId:" + conversationId + "}}));})();", null);
        }, 650L);
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
        if (pendingWebPermissionRequest != null) {
            pendingWebPermissionRequest.deny();
            pendingWebPermissionRequest = null;
        }
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
        super.onDestroy();
    }
}
