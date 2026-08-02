package com.laujim.aptmanager;

import android.app.Activity;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "AuthorizedCallerScreening")
public class AuthorizedCallerPlugin extends Plugin {
    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void syncAuthorizedNumbers(PluginCall call) {
        JSArray numbers = call.getArray("numbers", new JSArray());
        Set<String> values = new HashSet<>();
        for (int index = 0; index < numbers.length(); index++) {
            try { values.add(numbers.getString(index)); } catch (Exception ignored) {}
        }
        AuthorizedCallerStore.save(getContext(), values);
        call.resolve(status());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        AuthorizedCallerStore.setEnabled(getContext(), call.getBoolean("enabled", false));
        call.resolve(status());
    }

    @PluginMethod
    public void requestScreeningRole(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("El filtro requiere Android 10 o superior");
            return;
        }
        RoleManager roles = (RoleManager) getContext().getSystemService(Context.ROLE_SERVICE);
        if (roles == null || !roles.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
            call.reject("Este teléfono no permite usar un filtro de llamadas");
            return;
        }
        if (roles.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
            call.resolve(status());
            return;
        }
        startActivityForResult(call, roles.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING), "screeningRoleResult");
    }

    @ActivityCallback
    private void screeningRoleResult(PluginCall call, ActivityResult activityResult) {
        JSObject result = status();
        result.put("requested", true);
        result.put("granted", activityResult.getResultCode() == Activity.RESULT_OK && isRoleGranted());
        call.resolve(result);
        notifyListeners("screeningRoleResult", result);
    }

    private JSObject status() {
        JSObject result = new JSObject();
        boolean supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
        result.put("supported", supported);
        result.put("enabled", AuthorizedCallerStore.isEnabled(getContext()));
        result.put("authorizedCount", AuthorizedCallerStore.count(getContext()));
        result.put("lastSyncedAt", AuthorizedCallerStore.lastSyncedAt(getContext()));
        result.put("roleGranted", isRoleGranted());
        return result;
    }

    private boolean isRoleGranted() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false;
        RoleManager roles = (RoleManager) getContext().getSystemService(Context.ROLE_SERVICE);
        return roles != null && roles.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)
            && roles.isRoleHeld(RoleManager.ROLE_CALL_SCREENING);
    }
}
