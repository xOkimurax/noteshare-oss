import { useEffect, useState } from 'react';

const KEY = 'noteshare:autosave';
const EVENT = 'noteshare:autosave-change';

/** Auto-save is ON by default; only an explicit "false" disables it. */
export function getAutoSave(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setAutoSave(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? 'true' : 'false');
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Reactive accessor — reflects changes made anywhere in the tab (and other tabs). */
export function useAutoSave(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(getAutoSave);

  useEffect(() => {
    const sync = () => setValue(getAutoSave());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return [
    value,
    (v: boolean) => {
      setAutoSave(v);
      setValue(v);
    },
  ];
}
