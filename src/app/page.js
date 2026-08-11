'use client';

import { useAuthenticationStatus } from '@nhost/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Home() {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    router.replace(isAuthenticated ? '/dashboard' : '/auth');
  }, [isAuthenticated, isLoading, router]);

  return (
    <main style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <p>Loading...</p>
    </main>
  );
}
