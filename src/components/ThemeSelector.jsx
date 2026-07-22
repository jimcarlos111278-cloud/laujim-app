import { useState, useRef, useEffect } from 'react';
import { Palette, Check } from 'lucide-react';
import { THEMES, getTheme, setTheme } from '../utils/theme';

export default function ThemeSelector({ variant = 'dropdown' }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(getTheme());
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (id) => {
    setCurrent(id);
    setTheme(id, true);
    setOpen(false);
  };

  if (variant === 'swatches') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {THEMES.map(t => (
          <button key={t.id} onClick={() => handleSelect(t.id)} title={t.label}
            className={`w-7 h-7 rounded-full border-2 transition-all ${current === t.id ? 'border-gray-800 dark:border-white scale-110' : 'border-transparent'}`}
            style={{ backgroundColor: t.color }}>
            {current === t.id && <Check className="w-4 h-4 text-white mx-auto" strokeWidth={3} />}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
        <Palette className="w-3.5 h-3.5" />
        <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: THEMES.find(t => t.id === current)?.color }} />
        {THEMES.find(t => t.id === current)?.label}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-2 z-50 min-w-[180px]">
          {THEMES.map(t => (
            <button key={t.id} onClick={() => handleSelect(t.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${current === t.id ? 'bg-gray-100 dark:bg-gray-700 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
              <span className="w-5 h-5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: t.color }} />
              <span className="text-gray-700 dark:text-gray-300">{t.label}</span>
              {current === t.id && <Check className="w-4 h-4 ml-auto text-c-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}