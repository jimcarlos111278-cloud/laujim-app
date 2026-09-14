package com.laujim.callguard;

import android.os.Build;
import android.telecom.Call;
import android.telecom.CallAudioState;
import java.util.concurrent.CopyOnWriteArrayList;

public class CallManager {
    private static Call currentCall;
    private static final CopyOnWriteArrayList<CallListener> listeners = new CopyOnWriteArrayList<>();

    public interface CallListener {
        void onCallChanged(Call call);
        void onCallRemoved(Call call);
        void onAudioStateChanged(CallAudioState audioState);
    }

    public static synchronized void setCall(Call call) {
        currentCall = call;
        if (call != null) {
            call.registerCallback(new Call.Callback() {
                @Override
                public void onStateChanged(Call c, int state) {
                    notifyCallChanged(c);
                }

                @Override
                public void onDetailsChanged(Call c, Call.Details details) {
                    notifyCallChanged(c);
                }
            });
        }
        notifyCallChanged(call);
    }

    public static synchronized Call getCall() {
        return currentCall;
    }

    public static synchronized void clearCall() {
        Call old = currentCall;
        currentCall = null;
        for (CallListener l : listeners) {
            try { l.onCallRemoved(old); } catch (Exception ignored) {}
        }
    }

    public static void registerListener(CallListener listener) {
        if (listener != null && !listeners.contains(listener)) {
            listeners.add(listener);
        }
    }

    public static void unregisterListener(CallListener listener) {
        listeners.remove(listener);
    }

    private static void notifyCallChanged(Call call) {
        for (CallListener l : listeners) {
            try { l.onCallChanged(call); } catch (Exception ignored) {}
        }
    }

    public static void notifyAudioStateChanged(CallAudioState audioState) {
        for (CallListener l : listeners) {
            try { l.onAudioStateChanged(audioState); } catch (Exception ignored) {}
        }
    }

    public static void answer() {
        if (currentCall != null) {
            currentCall.answer(android.telecom.VideoProfile.STATE_AUDIO_ONLY);
        }
    }

    public static void reject() {
        if (currentCall != null) {
            currentCall.reject(false, null);
        }
    }

    public static void disconnect() {
        if (currentCall != null) {
            currentCall.disconnect();
        }
    }

    public static void setMuted(boolean muted) {
        if (LaujimInCallService.getInstance() != null) {
            LaujimInCallService.getInstance().setMuted(muted);
        }
    }

    public static void toggleSpeaker(boolean enable) {
        if (LaujimInCallService.getInstance() != null) {
            int route = enable ? CallAudioState.ROUTE_SPEAKER : CallAudioState.ROUTE_EARPIECE;
            LaujimInCallService.getInstance().setAudioRoute(route);
        }
    }

    public static void playDtmf(char digit) {
        if (currentCall != null) {
            currentCall.playDtmfTone(digit);
            try {
                Thread.sleep(120);
            } catch (InterruptedException ignored) {}
            currentCall.stopDtmfTone();
        }
    }
}
