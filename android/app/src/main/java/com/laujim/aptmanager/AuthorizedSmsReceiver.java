package com.laujim.aptmanager;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

/** Receives SMS only while Laujim is the Android default SMS application. */
public class AuthorizedSmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_DELIVER_ACTION.equals(intent.getAction())) return;

        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) return;

        String sender = parts[0].getOriginatingAddress();
        if (!AuthorizedCallerStore.isAuthorizedPhone(context, sender)) return;

        StringBuilder body = new StringBuilder();
        long receivedAt = parts[0].getTimestampMillis();
        for (SmsMessage part : parts) body.append(part.getMessageBody());
        AuthorizedSmsStore.add(context, sender, body.toString(), receivedAt > 0 ? receivedAt : System.currentTimeMillis());
    }
}
