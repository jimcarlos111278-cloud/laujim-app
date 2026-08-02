package com.laujim.aptmanager;

import android.os.Build;
import android.telecom.Call;
import android.telecom.CallScreeningService;

public class AuthorizedCallerScreeningService extends CallScreeningService {
    @Override
    public void onScreenCall(Call.Details callDetails) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            && callDetails.getCallDirection() != Call.Details.DIRECTION_INCOMING) {
            return;
        }

        String phone = callDetails.getHandle() == null ? "" : callDetails.getHandle().getSchemeSpecificPart();
        boolean allowed = AuthorizedCallerStore.isAllowed(this, phone);
        CallResponse.Builder response = new CallResponse.Builder();

        if (!allowed) {
            response.setDisallowCall(true);
            response.setRejectCall(true);
            response.setSkipNotification(true);
        }
        respondToCall(callDetails, response.build());
    }
}
