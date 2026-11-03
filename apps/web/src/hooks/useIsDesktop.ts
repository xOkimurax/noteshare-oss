import { useEffect, useState } from 'react';

// Matches the `md:` breakpoint (768px) this app already uses elsewhere as
// the mobile/desktop split (e.g. App.tsx's hamburger nav is `md:hidden`).
const QUERY = '(min-width: 768px)';

/** True on a desktop-sized viewport, reactive to resize/orientation change. */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
