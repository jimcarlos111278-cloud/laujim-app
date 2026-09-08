// WebRTC Audio/Video Intercom with DSP Voice Filter and Speaker Boost
const STUN_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

const API_BASE = window.location.origin;

async function postSignal(callId, role, data) {
  try {
    await fetch(`${API_BASE}/api/intercom/public/call/${callId}/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, ...data }),
    });
  } catch (e) {
    console.warn('[WebRTC] Signal send error:', e.message);
  }
}

async function getPeerSignal(callId, role) {
  try {
    const res = await fetch(`${API_BASE}/api/intercom/public/call/${callId}/signal?role=${role}`);
    return await res.json().catch(() => ({}));
  } catch {
    return {};
  }
}

/**
 * Audio DSP Chain:
 * 1. High-pass filter (120 Hz): cuts car engines, street noise, wind rumble.
 * 2. Peaking filter (2500 Hz, +6 dB, Q: 1.2): sharpens human voice consonants for maximum intelligibility.
 * 3. DynamicsCompressor: levels out whisper and distant voices without clipping loud voices.
 * 4. Gain booster (+6.8 dB): maximizes smartphone loudspeaker output.
 */
export function enhanceAudioStream(stream) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);

    // 1. High-pass filter
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 120;
    highpass.Q.value = 0.8;

    // 2. Vocal intelligibility boost
    const voiceBoost = ctx.createBiquadFilter();
    voiceBoost.type = 'peaking';
    voiceBoost.frequency.value = 2500;
    voiceBoost.gain.value = 6;
    voiceBoost.Q.value = 1.2;

    // 3. Dynamics compressor
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    // 4. Maximum volume booster
    const gain = ctx.createGain();
    gain.gain.value = 2.2;

    source.connect(highpass);
    highpass.connect(voiceBoost);
    voiceBoost.connect(compressor);
    compressor.connect(gain);
    gain.connect(ctx.destination);

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    return ctx;
  } catch (e) {
    console.warn('[DSP] Audio enhancement fallback:', e.message);
    return null;
  }
}

/**
 * Start 2-way intercom call with optional video
 * @param {number} callId
 * @param {'visitor'|'tenant'} role
 * @param {object|function} optionsOrCallback
 */
export async function startIntercomCall(callId, role, optionsOrCallback = {}) {
  const options = typeof optionsOrCallback === 'function'
    ? { onStatusChange: optionsOrCallback }
    : optionsOrCallback;

  const {
    enableVideo = (role === 'visitor'),
    onStatusChange = () => {},
    onRemoteStream = () => {},
    onLocalStream = () => {},
  } = options;

  let pc = null;
  let localStream = null;
  let pollTimer = null;
  let audioCtx = null;
  let remoteAudioElement = null;
  const processedIceCandidates = new Set();

  try {
    onStatusChange('requesting_media');

    // Attempt video + audio first if enabled
    if (enableVideo) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: {
            facingMode: 'user',
            width: { ideal: 640, max: 1280 },
            height: { ideal: 480, max: 720 },
            frameRate: { ideal: 25, max: 30 },
          },
        });
      } catch (videoErr) {
        console.warn('[WebRTC] Camera access denied/unavailable, falling back to audio only:', videoErr.message);
      }
    }

    // Fallback to audio-only if video failed or disabled
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    }

    onLocalStream(localStream);

    pc = new RTCPeerConnection(STUN_SERVERS);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        // Run audio through DSP filter
        const audioTracks = remoteStream.getAudioTracks();
        if (audioTracks.length > 0) {
          audioCtx = enhanceAudioStream(remoteStream);
          if (!audioCtx) {
            remoteAudioElement = new Audio();
            remoteAudioElement.srcObject = remoteStream;
            remoteAudioElement.play().catch(() => {});
          }
        }
        onRemoteStream(remoteStream);
        onStatusChange('connected');
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        postSignal(callId, role, { candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        onStatusChange('connected');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        onStatusChange('disconnected');
      }
    };

    onStatusChange('connecting');

    if (role === 'visitor') {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);
      await postSignal(callId, 'visitor', { sdp: pc.localDescription });

      pollTimer = setInterval(async () => {
        const peer = await getPeerSignal(callId, 'visitor');
        if (peer.action === 'hangup') {
          onStatusChange('disconnected');
          return;
        }
        if (peer.sdp && !pc.currentRemoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(peer.sdp));
        }
        if (Array.isArray(peer.candidates) && pc.remoteDescription) {
          for (const cand of peer.candidates) {
            const key = JSON.stringify(cand);
            if (!processedIceCandidates.has(key)) {
              processedIceCandidates.add(key);
              try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
            }
          }
        }
      }, 1200);
    } else {
      let answered = false;
      pollTimer = setInterval(async () => {
        const peer = await getPeerSignal(callId, 'tenant');
        if (peer.action === 'hangup') {
          onStatusChange('disconnected');
          return;
        }
        if (peer.sdp && !answered) {
          answered = true;
          await pc.setRemoteDescription(new RTCSessionDescription(peer.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await postSignal(callId, 'tenant', { sdp: pc.localDescription });
        }
        if (Array.isArray(peer.candidates) && answered && pc.remoteDescription) {
          for (const cand of peer.candidates) {
            const key = JSON.stringify(cand);
            if (!processedIceCandidates.has(key)) {
              processedIceCandidates.add(key);
              try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
            }
          }
        }
      }, 1200);
    }

    return function stopCall() {
      if (pollTimer) clearInterval(pollTimer);
      postSignal(callId, role, { action: 'hangup' });
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      if (pc) pc.close();
      if (audioCtx) audioCtx.close().catch(() => {});
      if (remoteAudioElement) remoteAudioElement.pause();
      onStatusChange('disconnected');
    };
  } catch (err) {
    console.error('[WebRTC] Call error:', err);
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (pc) pc.close();
    onStatusChange('error', err.message);
    throw err;
  }
}
