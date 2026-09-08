import { useState } from 'react';
import { Phone, DoorOpen, X, Camera, Loader2 } from 'lucide-react';
import { AUTH_TOKEN, getBase, getRawBase } from '../utils/config';

async function intercomRequest(route, options = {}) {
  const response = await fetch(getBase() + route, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-auth-token': AUTH_TOKEN, ...(options.headers || {}) },
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Error');
  return payload;
}

export default function IntercomCallModal({ call, onClose, onAction }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [imgKey] = useState(Date.now());

  async function handleUnlock() {
    setBusy('unlock');
    setMessage(null);
    try {
      const result = await intercomRequest('/intercom/unlock', {
        method: 'POST',
        body: JSON.stringify({ callId: call.id }),
      });
      setMessage({ type: 'success', text: result.message || '¡Puerta abierta!' });
      if (onAction) onAction('opened');
      setTimeout(onClose, 3000);
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    } finally { setBusy(''); }
  }

  async function handleIgnore() {
    setBusy('ignore');
    try {
      await intercomRequest('/intercom/ignore', {
        method: 'POST',
        body: JSON.stringify({ callId: call.id }),
      });
      if (onAction) onAction('ignored');
      onClose();
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    } finally { setBusy(''); }
  }

  const feedUrl = call.feedUrl
    ? `${getRawBase()}${call.feedUrl}?t=${imgKey}`
    : call.snapshotUrl
      ? `${getRawBase()}${call.snapshotUrl}`
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between bg-blue-600 px-4 py-3">
          <div className="flex items-center gap-2 text-white">
            <Phone className="h-4 w-4 animate-pulse" />
            <span className="text-sm font-semibold">Llamada del portón</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-white/70 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Camera feed */}
        <div className="relative aspect-video bg-slate-900">
          {feedUrl ? (
            <img
              src={feedUrl}
              alt="Vista del portón"
              className="h-full w-full object-cover"
              onError={e => { e.target.style.display = 'none'; }}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Camera className="h-12 w-12 text-slate-600" />
              <p className="ml-2 text-sm text-slate-500">Sin imagen del portón</p>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-4">
          <p className="text-center text-sm text-slate-600">
            Alguien está en el portón del edificio
          </p>
          <p className="text-center text-xs text-slate-400 mt-1">
            Fuente: {call.sourceDevice === 'whatsapp' ? 'WhatsApp' : 'QR Portón'}
          </p>

          {message && (
            <div className={`mt-3 rounded-xl p-3 text-center text-sm ${
              message.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}>
              {message.text}
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              onClick={handleIgnore}
              disabled={busy !== ''}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {busy === 'ignore' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              Ignorar
            </button>
            <button
              onClick={handleUnlock}
              disabled={busy !== ''}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === 'unlock' ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorOpen className="h-4 w-4" />}
              Abrir puerta
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
