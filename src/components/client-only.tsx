'use client';

import { useEffect, useState } from 'react';

/** Render children only after client mount — data tabs use relative fetch,
 *  which is unavailable during SSR. Fallback stays empty until hydration. */
export function ClientOnly({
  children,
  fallback = null
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return mounted ? children : fallback;
}
