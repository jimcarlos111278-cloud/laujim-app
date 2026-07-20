import { useState, useEffect } from 'react';
import { Home, DollarSign, ChevronLeft, ChevronRight, Image, ExternalLink } from 'lucide-react';
import { getBase } from '../utils/config';

export default function PublicApartments() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [gallery, setGallery] = useState(null);

  useEffect(() => {
    fetch(getBase() + '/public/vacants')
      .then(r => { if (!r.ok) throw new Error('Error al cargar'); return r.json(); })
      .then(setData)
      .catch(e => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <Home className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-800 mb-2">No disponible</h1>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const { apartments, photos } = data;
  const photosByApt = {};
  for (const p of photos) {
    const aid = Number(p.apartmentId);
    if (!photosByApt[aid]) photosByApt[aid] = [];
    photosByApt[aid].push(p);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Apartamentos Disponibles</h1>
          <p className="text-gray-500 mt-1">
            {apartments.length === 0 ? 'No hay apartamentos disponibles en este momento' : `${apartments.length} apartamento${apartments.length !== 1 ? 's' : ''} disponible${apartments.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        {apartments.length === 0 && (
          <div className="text-center py-16">
            <Home className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">Todos los apartamentos están arrendados actualmente.</p>
          </div>
        )}

        <div className="space-y-6">
          {apartments.map(apt => {
            const aptPhotos = photosByApt[apt.id] || [];
            return (
              <div key={apt.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                {aptPhotos.length > 0 && (
                  <div className="relative bg-gray-100">
                    <img src={aptPhotos[0].data || ''} alt={apt.name} className="w-full h-56 object-cover" onError={e => { e.target.style.display = 'none'; }} />
                    {aptPhotos.length > 1 && (
                      <div className="absolute top-3 right-3 flex gap-1">
                        {aptPhotos.slice(0, 3).map((_, i) => (
                          <button key={i} onClick={() => setGallery({ photos: aptPhotos, idx: i })} className="p-1.5 bg-black/40 text-white rounded-lg hover:bg-black/60 transition-colors text-xs">
                            <Image className="w-3.5 h-3.5" />
                          </button>
                        ))}
                        {aptPhotos.length > 3 && (
                          <span className="p-1.5 bg-black/40 text-white rounded-lg text-xs">+{aptPhotos.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="p-5">
                  <h2 className="text-xl font-bold text-gray-900 mb-2">{apt.name}</h2>
                  {apt.description && <p className="text-gray-600 text-sm mb-3">{apt.description}</p>}
                  <div className="flex flex-wrap gap-2 mb-3">
                    {apt.rooms && <span className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full">{apt.rooms} hab</span>}
                    {apt.bathrooms && <span className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full">{apt.bathrooms} baño</span>}
                    {apt.area && <span className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full">{apt.area} m²</span>}
                    {apt.floor && <span className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full">Piso {apt.floor}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-emerald-600" />
                    <span className="text-lg font-bold text-emerald-600">${(apt.monthlyRent || 0).toLocaleString()}</span>
                    <span className="text-sm text-gray-400">/mes</span>
                  </div>
                  {apt.paymentDueDay && <p className="text-xs text-gray-400 mt-1">Día de pago: {apt.paymentDueDay} de cada mes</p>}
                  {apt.notes && <p className="text-sm text-gray-500 mt-2 p-2 bg-gray-50 rounded-lg">{apt.notes}</p>}
                  <span className="inline-block mt-3 text-xs font-bold bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full">DISPONIBLE</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-center mt-8 pb-8">
          <p className="text-xs text-gray-400">Generado por Laujim App</p>
        </div>
      </div>

      {gallery && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setGallery(null)}>
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <button onClick={() => setGallery(null)} className="absolute -top-10 right-0 text-white/80 hover:text-white text-sm p-1 z-10">Cerrar</button>
            <img src={gallery.photos[gallery.idx].data || ''} alt="" className="max-w-full max-h-[80vh] object-contain rounded-lg" />
            <div className="flex items-center justify-between w-full mt-3">
              <button onClick={() => setGallery(g => ({ ...g, idx: g.idx === 0 ? g.photos.length - 1 : g.idx - 1 }))} className="flex items-center gap-1 px-4 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30 transition-colors text-sm"><ChevronLeft className="w-4 h-4" /> Anterior</button>
              <span className="text-white/70 text-sm">{gallery.idx + 1} / {gallery.photos.length}</span>
              <button onClick={() => setGallery(g => ({ ...g, idx: g.idx === g.photos.length - 1 ? 0 : g.idx + 1 }))} className="flex items-center gap-1 px-4 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30 transition-colors text-sm">Siguiente <ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}