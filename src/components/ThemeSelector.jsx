import { useState, useRef, useEffect } from 'react';
import { Palette, Sun, Moon, Check } from 'lucide-react';
import { THEMES, getTheme, setTheme, getThemeInfo } from '../utils/theme';

const iconMap = { Sun, Moon, Palette };

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
      <div className="flex flex-wrap gap-3 justify-center">
        {THEMES.map(t => {
          const Icon = iconMap[t.icon] || Palette;
          const isActive = current === t.id;
          return (
            <button key={t.id} onClick={() => handleSelect(t.id)}
              className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border-2 transition-all min-w-[72px] ${
                isActive
                  ? 'border-c-500 bg-c-50 shadow-sm'
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 bg-white dark:bg-gray-700'
              }`}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center shadow-sm" style={{ backgroundColor: t.color }}>
                {isActive ? <Check className="w-4 h-4 text-white" strokeWidth={3} /> : <Icon className="w-4 h-4 text-white" />}
              </div>
              <span className={`text-xs font-medium ${isActive ? 'text-c-700' : 'text-gray-600 dark:text-gray-300'}`}>{t.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  const currentTheme = getThemeInfo(current);
  const Icon = iconMap[currentTheme.icon] || Palette;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
        <Icon className="w-3.5 h-3.5" style={{ color: currentTheme.color }} />
        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: currentTheme.color }} />
        {currentTheme.label}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-1.5 z-50 min-w-[170px]">
          {THEMES.map(t => {
            const Icon2 = iconMap[t.icon] || Palette;
            const isActive = current === t.id;
            return (
              <button key={t.id} onClick={() => handleSelect(t.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-gray-100 dark:bg-gray-700 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}>
                <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: t.color }}>
                  <Icon2 className="w-3 h-3 text-white" />
                </span>
                <span className={`${isActive ? 'text-c-700 dark:text-c-300' : 'text-gray-700 dark:text-gray-300'}`}>{t.label}</span>
                {isActive && <Check className="w-4 h-4 ml-auto text-c-500" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}