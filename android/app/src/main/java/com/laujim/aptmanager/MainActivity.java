package com.laujim.aptmanager;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int FILE_CHOOSER_REQUEST = 4817;
    private static final int MEDIA_PERMISSION_REQUEST = 4818;
    private ValueCallback<Uri[]> pendingFileCallback;
    private PermissionRequest pendingWebPermissionRequest;
    private String[] pendingWebPermissionResources;
    private Uri pendingCaptureUri;
    private File pendingCaptureFile;
    private final Handler deepLinkHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AuthorizedCallerPlugin.class);
        registerPlugin(ScraperWorkerPlugin.class);
        registerPlugin(BackgroundNotificationsPlugin.class);
        registerPlugin(PaymentWatcherPlugin.class);
        super.onCreate(savedInstanceState);

        // Capacitor may replace its WebView/WebChromeClient while the bridge is
        // booting. Install our media bridge after that initialization, retrying
        // once if the WebView is not ready yet. This is why media worked on the
        // web but the APK silently ignored the microphone request.
        deepLinkHandler.postDelayed(this::installMediaWebChromeClient, 650L);
        dispatchWhatsAppIntent(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        // Opening Laujim is also a safe recovery point after Android has
        // reclaimed the app process. Rebuild the alarm and WorkManager
        // fallback when the worker was already enabled; this does not start a
        // duplicate run because the dispatcher owns the duplicate window.
        if (ScraperWorkerStore.enabled(this)) {
            ScraperWorkerSchedule.scheduleAll(this, "app-resumed");
        }
    }

    private void installMediaWebChromeClient() {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) {
            deepLinkHandler.postDelayed(this::installMediaWebChromeClient, 300L);
            return;
        }
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (request == null) return;
                    boolean needsAudio = false;
                    boolean needsCamera = false;
                    ArrayList<String> grantableResources = new ArrayList<>();
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                            needsAudio = true;
                            grantableResources.add(resource);
                        } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                            needsCamera = true;
                            grantableResources.add(resource);
                        }
                    }
                    if (grantableResources.isEmpty()) {
                        request.deny();
                        return;
                    }
                    ArrayList<String> runtimePermissions = new ArrayList<>();
                    if (needsAudio && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        runtimePermissions.add(Manifest.permission.RECORD_AUDIO);
                    }
                    if (needsCamera && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        runtimePermissions.add(Manifest.permission.CAMERA);
                    }
                    if (runtimePermissions.isEmpty()) {
                        request.grant(grantableResources.toArray(new String[0]));
                    } else {
                        if (pendingWebPermissionRequest != null) pendingWebPermissionRequest.deny();
                        pendingWebPermissionRequest = request;
                        pendingWebPermissionResources = grantableResources.toArray(new String[0]);
                        requestPermissions(runtimePermissions.toArray(new String[0]), MEDIA_PERMISSION_REQUEST);
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
                    String acceptedType = acceptedMimeType(fileChooserParams);
                    boolean capture = fileChooserParams != null && fileChooserParams.isCaptureEnabled();
                    // Always launch native camera for image/* when capture is requested
                    // isCaptureEnabled() is unreliable in Android WebView, so also check accept type
                    boolean isImageOnly = "image/*".equals(acceptedType);
                    boolean isVideoOnly = "video/*".equals(acceptedType);
                    if ((capture || isImageOnly) && (isImageOnly || isVideoOnly)) {
                        // Request CAMERA permission at runtime if not granted
                        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(new String[]{ Manifest.permission.CAMERA }, MEDIA_PERMISSION_REQUEST);
                        }
                        launchCaptureIntent(isVideoOnly);
                        } else {
                            Intent chooser = fileChooserParams == null
                                ? new Intent(Intent.ACTION_OPEN_DOCUMENT)
                                : fileChooserParams.createIntent();
                            chooser.addCategory(Intent.CATEGORY_OPENABLE);
                            String[] acceptedTypes = acceptedMimeTypes(fileChooserParams);
                            if (acceptedTypes.length > 1) {
                                chooser.setType("*/*");
                                chooser.putExtra(Intent.EXTRA_MIME_TYPES, acceptedTypes);
                            } else {
                                chooser.setType(acceptedType);
                            }
                            chooser.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, fileChooserParams == null || !fileChooserParams.isCaptureEnabled());
                        startActivityForResult(chooser, FILE_CHOOSER_REQUEST);
                    }
                    return true;
                } catch (Exception error) {
                    pendingCaptureUri = null;
                    pendingCaptureFile = null;
                    pendingFileCallback = null;
                    filePathCallback.onReceiveValue(null);
                    return false;
                }
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != MEDIA_PERMISSION_REQUEST || pendingWebPermissionRequest == null) return;
        PermissionRequest request = pendingWebPermissionRequest;
        pendingWebPermissionRequest = null;
        boolean granted = grantResults.length > 0;
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) {
                granted = false;
                break;
            }
        }
        if (granted && pendingWebPermissionResources != null) {
            request.grant(pendingWebPermissionResources);
        } else {
            request.deny();
        }
        pendingWebPermissionResources = null;
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
                if (pendingCaptureUri != null) {
                    if (resultCode == Activity.RESULT_OK) results = new Uri[] { pendingCaptureUri };
                    else if (pendingCaptureFile != null) pendingCaptureFile.delete();
                    pendingCaptureUri = null;
                    pendingCaptureFile = null;
                } else if (resultCode == Activity.RESULT_OK && data != null) {
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
        pendingWebPermissionResources = null;
        if (pendingCaptureFile != null) pendingCaptureFile.delete();
        pendingCaptureFile = null;
        pendingCaptureUri = null;
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
        super.onDestroy();
    }

    private String acceptedMimeType(WebChromeClient.FileChooserParams params) {
        if (params == null || params.getAcceptTypes() == null) return "*/*";
        boolean image = false;
        boolean video = false;
        boolean audio = false;
        for (String value : params.getAcceptTypes()) {
            String type = value == null ? "" : value.toLowerCase();
            image |= type.startsWith("image/") || type.contains("image");
            video |= type.startsWith("video/") || type.contains("video");
            audio |= type.startsWith("audio/") || type.contains("audio");
        }
        if (video && !image && !audio) return "video/*";
        if (audio && !image && !video) return "audio/*";
        if (image && !video && !audio) return "image/*";
        return "*/*";
    }

    private String[] acceptedMimeTypes(WebChromeClient.FileChooserParams params) {
        if (params == null || params.getAcceptTypes() == null) return new String[0];
        ArrayList<String> types = new ArrayList<>();
        for (String value : params.getAcceptTypes()) {
            String type = value == null ? "" : value.toLowerCase();
            if ((type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/")) && !types.contains(type)) {
                types.add(type);
            }
        }
        return types.toArray(new String[0]);
    }

    private void launchCaptureIntent(boolean video) throws IOException {
        String directory = video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES;
        File baseDirectory = getExternalFilesDir(directory);
        if (baseDirectory == null) throw new IOException("No hay almacenamiento disponible");
        if (!baseDirectory.exists() && !baseDirectory.mkdirs()) throw new IOException("No se pudo crear el almacenamiento temporal");
        pendingCaptureFile = File.createTempFile("laujim-camera-", video ? ".mp4" : ".jpg", baseDirectory);
        pendingCaptureUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", pendingCaptureFile);
        String captureAction = video ? android.provider.MediaStore.ACTION_VIDEO_CAPTURE : android.provider.MediaStore.ACTION_IMAGE_CAPTURE;
        Intent captureIntent = new Intent(captureAction);
        captureIntent.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, pendingCaptureUri);
        captureIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        captureIntent.setClipData(android.content.ClipData.newRawUri("Laujim", pendingCaptureUri));
        startActivityForResult(captureIntent, FILE_CHOOSER_REQUEST);
    }
}
