'use client';

import { NhostProvider } from '@nhost/react';
import { ApolloProvider } from '@apollo/client';
import { nhost } from '@/lib/nhost';
import { apolloClient } from '@/lib/apollo';

export default function Providers({ children }) {
  return (
    <NhostProvider nhost={nhost}>
      <ApolloProvider client={apolloClient}>{children}</ApolloProvider>
    </NhostProvider>
  );
}
