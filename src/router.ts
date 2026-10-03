import { useEffect, useState } from 'preact/hooks';

export function currentPath() {
  return location.hash.replace(/^#/, '') || '/';
}

export function useRoute(): string[] {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const f = () => {
      setPath(currentPath());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return path.split('/').filter(Boolean).map(decodeURIComponent);
}

export function go(path: string) {
  location.hash = path;
}

export function back(fallback = '/') {
  if (history.length > 1) history.back();
  else go(fallback);
}
