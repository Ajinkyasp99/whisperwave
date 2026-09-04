import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

/**
 * `HTTPS=1` serves over TLS with a self-signed certificate.
 *
 * Browsers only expose getUserMedia in a secure context, and `localhost` is
 * the sole plaintext exception - so testing phone-to-phone over the LAN, which
 * is the whole point of this app, requires it.
 */
const https = process.env.HTTPS === '1';

export default defineConfig({
  base: '/whisperwave/',
  plugins: [react(), tailwindcss(), ...(https ? [basicSsl()] : [])],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: 'es2022' },
});
