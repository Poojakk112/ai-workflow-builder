// src/lib/nhost.js
//
// This sets up the connection to your nhost backend (auth + graphql).
// Replace subdomain/region below if yours are different.

import { NhostClient } from '@nhost/nhost-js';

export const nhost = new NhostClient({
  subdomain: 'giuwwstthmppkgbifltz',
  region: 'ap-south-1',
});
