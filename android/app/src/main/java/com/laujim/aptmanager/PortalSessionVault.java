package com.laujim.aptmanager;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.CookieManager;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Keeps the short-lived SPA state on the Android device. Cookies are owned by
 * Android WebView; sessionStorage and captured bearer headers are encrypted
 * with an Android Keystore key because they must never be sent to Render.
 */
final class PortalSessionVault {
    private static final String PREFS = "laujim_portal_session_v2";
    private static final String KEY_ALIAS = "laujim.portal.session.v2";
    private static final String KEY_STATE = "state_";
    private static final String KEY_AUTH = "auth_";
    private static final int MAX_VALUE_BYTES = 900_000;

    private PortalSessionVault() { }

    static void saveState(Context context, String provider, String json) {
        saveEncrypted(context, KEY_STATE + normalize(provider), json);
    }

    static String loadState(Context context, String provider) {
        return loadEncrypted(context, KEY_STATE + normalize(provider));
    }

    static void saveAuthorization(Context context, String provider, String value) {
        String token = value == null ? "" : value.trim();
        if (token.isEmpty()) return;
        saveEncrypted(context, KEY_AUTH + normalize(provider), token);
    }

    static String loadAuthorization(Context context, String provider) {
        return loadEncrypted(context, KEY_AUTH + normalize(provider));
    }

    static void flushCookies() {
        try { CookieManager.getInstance().flush(); } catch (RuntimeException ignored) { }
    }

    static void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    static String restoreScript(String encryptedStateJson) {
        String state = encryptedStateJson == null ? "" : encryptedStateJson.trim();
        if (state.isEmpty()) return "(function(){return false;})();";
        return "(function(){try{"
            + "const s=JSON.parse(" + JSONObject.quote(state) + ");"
            + "const put=(store,values)=>{if(!store||!values||typeof values!=='object')return;Object.keys(values).forEach(k=>{try{store.setItem(k,String(values[k]??''));}catch(e){}});};"
            + "put(window.localStorage,s.local);put(window.sessionStorage,s.session);"
            + "return true;}catch(e){return false;}})();";
    }

    static String snapshotScript(String provider, String bridgeName) {
        String safeBridge = bridgeName == null || bridgeName.trim().isEmpty() ? "LaujimAndroidBridge" : bridgeName.trim();
        return "(function(){try{"
            + "const read=s=>{const o={};if(!s)return o;for(let i=0;i<s.length;i++){const k=s.key(i);if(k!=null){const v=s.getItem(k);if(v!=null)o[k]=v;}}return o;};"
            + "const value=JSON.stringify({url:String(location.href||''),capturedAt:new Date().toISOString(),local:read(window.localStorage),session:read(window.sessionStorage)});"
            + "if(window." + safeBridge + "&&typeof window." + safeBridge + ".persistSession==='function')window." + safeBridge + ".persistSession("
            + JSONObject.quote(normalize(provider)) + ",value);return true;}catch(e){return false;}})();";
    }

    static String authorizationCaptureScript(String bridgeName) {
        String safeBridge = bridgeName == null || bridgeName.trim().isEmpty() ? "LaujimAndroidBridge" : bridgeName.trim();
        return "(function(){if(window.__LaujimAuthHookInstalled)return;window.__LaujimAuthHookInstalled=true;"
            + "const send=v=>{try{if(v&&window." + safeBridge + "&&typeof window." + safeBridge + ".captureAuthorization==='function')window." + safeBridge + ".captureAuthorization(String(v));}catch(e){}};"
            + "const read=h=>{if(!h)return '';try{if(typeof h.get==='function')return h.get('Authorization')||h.get('authorization')||'';if(Array.isArray(h)){for(const x of h){if(x&&String(x[0]).toLowerCase()==='authorization')return x[1]||'';}}for(const k of Object.keys(h)){if(k.toLowerCase()==='authorization')return h[k]||'';}}catch(e){}return '';};"
            + "const f=window.fetch;if(typeof f==='function')window.fetch=function(input,init){send(read(init&&init.headers)||read(input&&input.headers));return f.apply(this,arguments);};"
            + "try{const p=XMLHttpRequest.prototype;const h=p.setRequestHeader;p.setRequestHeader=function(n,v){if(String(n||'').toLowerCase()==='authorization')send(v);return h.apply(this,arguments);};}catch(e){}})();";
    }

    static String normalize(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase();
        if (normalized.equals("water") || normalized.equals("triple-a")) return "water";
        if (normalized.equals("gas") || normalized.equals("gascaribe")) return "gas";
        if (normalized.equals("facebook") || normalized.equals("marketplace")) return "facebook";
        return "air-e";
    }

    private static void saveEncrypted(Context context, String key, String value) {
        String plain = value == null ? "" : value;
        if (plain.getBytes(StandardCharsets.UTF_8).length > MAX_VALUE_BYTES) return;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey());
            byte[] encrypted = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            String packed = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP);
            preferences(context).edit().putString(key, packed).apply();
        } catch (Exception ignored) {
            // Never fall back to plaintext for portal state.
        }
    }

    private static String loadEncrypted(Context context, String key) {
        String packed = preferences(context).getString(key, "");
        if (packed == null || packed.isEmpty()) return "";
        try {
            String[] parts = packed.split("\\.", 2);
            if (parts.length != 2) return "";
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] encrypted = Base64.decode(parts[1], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            preferences(context).edit().remove(key).apply();
            return "";
        }
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey secretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        java.security.Key existing = keyStore.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }
}
