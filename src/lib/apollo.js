// src/lib/apollo.js
//
// Apollo Client setup: regular queries/mutations go over HTTPS,
// but subscriptions (live updates) need a WebSocket connection.
// This "split" link sends each request over the right one automatically.

'use client';

import { ApolloClient, InMemoryCache, HttpLink, split, ApolloLink } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';
import { nhost } from './nhost';

const SUBDOMAIN = 'giuwwstthmppkgbifltz';
const REGION = 'ap-south-1';

const httpUrl = `https://${SUBDOMAIN}.hasura.${REGION}.nhost.run/v1/graphql`;
const wsUrl = `wss://${SUBDOMAIN}.hasura.${REGION}.nhost.run/v1/graphql`;

function getHeaders() {
  const token = nhost.auth.getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const httpLink = new HttpLink({
  uri: httpUrl,
});

// authenticated http link - attaches the current user's access token
const authMiddleware = new ApolloLink((operation, forward) => {
  operation.setContext(({ headers = {} }) => ({
    headers: { ...headers, ...getHeaders() },
  }));
  return forward(operation);
});

const authHttpLink = authMiddleware.concat(httpLink);

let wsLink = null;
if (typeof window !== 'undefined') {
  wsLink = new GraphQLWsLink(
    createClient({
      url: wsUrl,
      connectionParams: () => ({
        headers: getHeaders(),
      }),
    })
  );
}

const splitLink =
  typeof window !== 'undefined' && wsLink
    ? split(
        ({ query }) => {
          const definition = getMainDefinition(query);
          return (
            definition.kind === 'OperationDefinition' &&
            definition.operation === 'subscription'
          );
        },
        wsLink,
        authHttpLink
      )
    : authHttpLink;

export const apolloClient = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});
