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
    private static final String KEY_COOKIES = "cookies_";
    private static final int MAX_VALUE_BYTES = 900_000;
    private static final String[] GAS_ORIGINS = {
        "https://portal.gascaribe.com/",
        "https://pagosweb-production-api.innovacion-gascaribe.com/"
    };

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

    static void clearProvider(Context context, String provider) {
        String normalized = normalize(provider);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove(KEY_STATE + normalized)
            .remove(KEY_AUTH + normalized)
            .remove(KEY_COOKIES + normalized)
            .apply();
    }

    /**
     * Gases del Caribe permits a maximum of ten contracts per account. The
     * Android WebView has one global cookie jar, so account sessions must be
     * snapshotted before changing from gas-1 to gas-2 (or the next account).
     * The snapshot is encrypted with the same Android Keystore key as the
     * portal state and never leaves the device.
     */
    static void saveCookieSnapshot(Context context, String provider) {
        String normalized = normalize(provider);
        if (!isGasSession(normalized)) return;
        try {
            JSONObject snapshot = new JSONObject();
            CookieManager cookies = CookieManager.getInstance();
            for (String origin : GAS_ORIGINS) {
                String value = cookies.getCookie(origin);
                if (value != null && !value.trim().isEmpty()) snapshot.put(origin, value);
            }
            saveEncrypted(context, KEY_COOKIES + normalized, snapshot.toString());
        } catch (Exception ignored) {
            // A cookie snapshot is only a recovery aid; never fail a scrape.
        }
    }

    /**
     * Switches the shared WebView cookie jar to a saved Gases account. If no
     * snapshot exists for a new account, stale Gases cookies are removed so a
     * manual login cannot silently attach to the previous account.
     */
    static void activateCookieSession(Context context, String previousProvider, String nextProvider) {
        String previous = normalize(previousProvider);
        String next = normalize(nextProvider);
        if (!isGasSession(next)) return;
        if (isGasSession(previous) && !previous.equals(next)) saveCookieSnapshot(context, previous);

        String saved = loadEncrypted(context, KEY_COOKIES + next);
        boolean accountChanged = isGasSession(previous) && !previous.equals(next);
        boolean newSecondaryAccount = isSecondaryGasSession(next) && saved.isEmpty();
        boolean restoreSavedAccount = !saved.isEmpty();
        if (accountChanged || newSecondaryAccount || restoreSavedAccount) clearGasCookies();
        if (restoreSavedAccount) restoreGasCookies(saved);
        flushCookies();
    }

    static void clearGasCookies() {
        try {
            CookieManager cookies = CookieManager.getInstance();
            for (String origin : GAS_ORIGINS) {
                String current = cookies.getCookie(origin);
                if (current == null || current.trim().isEmpty()) continue;
                for (String part : current.split(";")) {
                    String name = part.split("=", 2)[0].trim();
                    if (name.isEmpty()) continue;
                    cookies.setCookie(origin, name + "=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/");
                }
            }
        } catch (RuntimeException ignored) { }
    }

    private static void restoreGasCookies(String snapshotJson) {
        try {
            JSONObject snapshot = new JSONObject(snapshotJson == null ? "{}" : snapshotJson);
            CookieManager cookies = CookieManager.getInstance();
            for (String origin : GAS_ORIGINS) {
                String value = snapshot.optString(origin, "");
                if (value.isEmpty()) continue;
                for (String part : value.split(";")) {
                    String cookie = part.trim();
                    if (!cookie.isEmpty() && cookie.contains("=")) cookies.setCookie(origin, cookie + "; Path=/");
                }
            }
        } catch (Exception ignored) { }
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
        if (normalized.matches("gas-\\d+")) return normalized;
        if (normalized.equals("gas") || normalized.equals("gascaribe")) return "gas";
        if (normalized.equals("facebook") || normalized.equals("marketplace")) return "facebook";
        return "air-e";
    }

    static boolean isGasSession(String value) {
        String normalized = normalize(value);
        return normalized.equals("gas") || normalized.matches("gas-\\d+");
    }

    static boolean isSecondaryGasSession(String value) {
        return normalize(value).matches("gas-[2-9]\\d*");
    }

    static String baseProvider(String value) {
        String normalized = normalize(value);
        return isGasSession(normalized) ? "gas" : normalized;
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
