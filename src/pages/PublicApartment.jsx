import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bath, BedDouble, Building2, ChevronLeft, ChevronRight, Droplets, Flame, Home, Image, Ruler, Zap } from 'lucide-react';
import { getBase, photoUrl } from '../utils/config';

const serviceIcons = { water: Droplets, gas: Flame, electricity: Zap };

export default function PublicApartment() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [galleryIndex, setGalleryIndex] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${getBase()}/public/apartments/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Esta página no está disponible.');
        return response.json();
      })
      .then(setData)
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [id]);

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-sm text-center bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <Home className="w-14 h-14 text-gray-300 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900">Página no disponible</h1>
          <p className="text-sm text-gray-500 mt-2">{error}</p>
          <Link to="/publico" className="inline-block mt-5 text-sm font-medium text-blue-600 hover:underline">Ver apartamentos disponibles</Link>
        </div>
      </main>
    );
  }

  if (!data) {
    return <main className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="animate-spin w-9 h-9 border-4 border-blue-600 border-t-transparent rounded-full" /></main>;
  }

  const { apartment, photos = [], services = [] } = data;
  const imageUrls = photos.map(photoUrl).filter(Boolean);
  const isAvailable = apartment.status === 'vacant';

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link to="/publico" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 mb-5"><ChevronLeft className="w-4 h-4" /> Ver disponibles</Link>

        <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
          {imageUrls.length > 0 ? (
            <button type="button" onClick={() => setGalleryIndex(0)} className="block w-full relative bg-gray-100 text-left">
              <img src={imageUrls[0]} alt={`Apartamento ${apartment.name}`} className="w-full h-72 object-cover" />
              {imageUrls.length > 1 && <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-lg bg-black/60 px-3 py-1.5 text-xs font-medium text-white"><Image className="w-3.5 h-3.5" /> {imageUrls.length} fotos</span>}
            </button>
          ) : <div className="h-48 bg-gradient-to-br from-blue-50 to-slate-100 flex items-center justify-center"><Building2 className="w-16 h-16 text-blue-200" /></div>}

          <div className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-500">Apartamento</p>
                <h1 className="text-3xl font-bold mt-1">{apartment.name}</h1>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${isAvailable ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{isAvailable ? 'DISPONIBLE' : 'INFORMACIÓN DEL APARTAMENTO'}</span>
            </div>

            {apartment.description && <p className="mt-5 text-gray-600 leading-relaxed">{apartment.description}</p>}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
              {apartment.rooms && <Info icon={BedDouble} label="Habitaciones" value={apartment.rooms} />}
              {apartment.bathrooms && <Info icon={Bath} label="Baños" value={apartment.bathrooms} />}
              {apartment.area && <Info icon={Ruler} label="Área" value={`${apartment.area} m²`} />}
              {apartment.floor && <Info icon={Building2} label="Piso" value={apartment.floor} />}
            </div>

            {isAvailable && <div className="mt-6 rounded-xl bg-emerald-50 border border-emerald-100 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Canon mensual</p><p className="text-2xl font-bold text-emerald-700 mt-1">${Number(apartment.monthlyRent || 0).toLocaleString('es-CO')}</p></div>}
          </div>
        </section>

        <section className="mt-6 bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-bold">Servicios útiles</h2>
          <p className="text-sm text-gray-500 mt-1">Accesos generales para consultar o pagar servicios. Los códigos y datos privados solo aparecen al iniciar sesión.</p>
          <div className="grid sm:grid-cols-3 gap-3 mt-5">
            {services.map(service => {
              const Icon = serviceIcons[service.id] || Home;
              return <a key={service.id} href={service.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:bg-blue-50 transition-colors"><Icon className="w-5 h-5 text-blue-600" /><span><span className="block text-sm font-semibold">{service.name}</span><span className="block text-xs text-gray-500">{service.provider}</span></span></a>;
            })}
          </div>
          <Link to="/login" className="inline-flex mt-5 text-sm font-semibold text-blue-600 hover:underline">¿Eres residente? Ingresa para ver tu información privada.</Link>
        </section>
      </div>

      {galleryIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setGalleryIndex(null)}>
          <div className="relative max-w-5xl w-full" onClick={event => event.stopPropagation()}>
            <button type="button" onClick={() => setGalleryIndex(null)} className="absolute -top-10 right-0 text-sm text-white/90 hover:text-white">Cerrar</button>
            <img src={imageUrls[galleryIndex]} alt={`Apartamento ${apartment.name}`} className="max-h-[80vh] max-w-full mx-auto rounded-lg object-contain" />
            {imageUrls.length > 1 && <div className="flex items-center justify-between mt-3"><button type="button" onClick={() => setGalleryIndex(index => index === 0 ? imageUrls.length - 1 : index - 1)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white/15 text-white text-sm hover:bg-white/25"><ChevronLeft className="w-4 h-4" /> Anterior</button><span className="text-sm text-white/75">{galleryIndex + 1} / {imageUrls.length}</span><button type="button" onClick={() => setGalleryIndex(index => index === imageUrls.length - 1 ? 0 : index + 1)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white/15 text-white text-sm hover:bg-white/25">Siguiente <ChevronRight className="w-4 h-4" /></button></div>}
          </div>
        </div>
      )}
    </main>
  );
}

function Info({ icon: Icon, label, value }) {
  return <div className="rounded-xl bg-gray-50 p-3"><Icon className="w-4 h-4 text-gray-400 mb-2" /><p className="text-xs text-gray-500">{label}</p><p className="text-sm font-bold mt-0.5">{value}</p></div>;
}
