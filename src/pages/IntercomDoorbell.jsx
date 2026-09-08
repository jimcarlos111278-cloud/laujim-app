import { useEffect, useState } from 'react';
import { Building2, Phone, CheckCircle2, Loader2 } from 'lucide-react';

const API_BASE = window.location.origin;

async function publicRequest(route, options = {}) {
  const response = await fetch(API_BASE + '/api' + route, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Error de conexión');
  return payload;
}

export default function IntercomDoorbell() {
  const [apartments, setApartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(null);
  const [callResult, setCallResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    publicRequest('/intercom/public/apartments')
      .then(data => setApartments(data.apartments || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function callApartment(name) {
    setCalling(name);
    setCallResult(null);
    setError('');
    try {
      const result = await publicRequest('/intercom/public/call', {
        method: 'POST',
        body: JSON.stringify({ apartmentCode: name }),
      });
      setCallResult({ name, message: result.message, callId: result.callId });
    } catch (e) {
      setError(e.message);
    } finally {
      setCalling(null);
    }
  }

  // Group apartments by floor
  const floors = {};
  apartments.forEach(a => {
    const floor = a.floor || String(a.name).charAt(0);
    if (!floors[floor]) floors[floor] = [];
    floors[floor].push(a);
  });
  const sortedFloors = Object.keys(floors).sort((a, b) => Number(a) - Number(b));

  if (callResult) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Llamando al {callResult.name}</h2>
          <p className="mt-2 text-sm text-slate-500">{callResult.message}</p>
          <p className="mt-4 text-xs text-slate-400">El residente recibirá una notificación. Por favor espere frente a la cámara.</p>
          <div className="mt-6 flex justify-center">
            <div className="flex gap-1">
              <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-emerald-500" style={{ animationDelay: '0ms' }} />
              <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-emerald-500" style={{ animationDelay: '150ms' }} />
              <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-emerald-500" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
          <button
            onClick={() => setCallResult(null)}
            className="mt-6 rounded-xl border border-slate-200 px-6 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Llamar a otro apartamento
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 p-4">
      <div className="mx-auto max-w-sm">
        <div className="mb-6 pt-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600">
            <Building2 className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Edificio Laujim</h1>
          <p className="mt-1 text-sm text-slate-400">Seleccione el apartamento al que desea llamar</p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-center text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-4">
            {sortedFloors.map(floor => (
              <div key={floor}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Piso {floor}</p>
                <div className="grid grid-cols-3 gap-2">
                  {floors[floor].sort((a, b) => String(a.name).localeCompare(String(b.name))).map(apt => (
                    <button
                      key={apt.name}
                      onClick={() => callApartment(apt.name)}
                      disabled={calling !== null}
                      className="group relative flex flex-col items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 px-4 py-5 text-white transition-all hover:bg-blue-600 hover:border-blue-500 hover:scale-105 active:scale-95 disabled:opacity-50"
                    >
                      {calling === apt.name ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>
                          <Phone className="mb-1.5 h-5 w-5 text-slate-400 group-hover:text-white" />
                          <span className="text-lg font-bold">{apt.name}</span>
                        </>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-8 text-center text-xs text-slate-600">
          Powered by Laujim APP
        </p>
      </div>
    </div>
  );
}
