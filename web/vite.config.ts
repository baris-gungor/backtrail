import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/**
 * Same Basic Auth as the backend (src/common/auth), with the same AUTH_* variables from the root
 * .env, so the browser asks for credentials on the first page load. It then sends them with every
 * request, and the /api proxy forwards them to the backend, which checks them again.
 */
function basicAuth(username: string, password: string): Plugin {
  const expected = digest(`${username}:${password}`);
  return {
    name: 'backtrail-basic-auth',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/api/health') return next();
        const match = /^Basic\s+(\S+)$/i.exec(req.headers.authorization ?? '');
        const given = match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
        if (match && timingSafeEqual(digest(given), expected)) return next();
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="backtrail", charset="UTF-8"');
        res.end('Authentication required');
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const rootEnv = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), 'AUTH_');
  const auth = rootEnv.AUTH_USERNAME && rootEnv.AUTH_PASSWORD;
  return {
    plugins: [vue(), ...(auth ? [basicAuth(rootEnv.AUTH_USERNAME, rootEnv.AUTH_PASSWORD)] : [])],
    // vue-i18n esm-bundler feature flags: Composition API only, no devtools in production.
    define: {
      __VUE_I18N_FULL_INSTALL__: true,
      __VUE_I18N_LEGACY_API__: false,
      __INTLIFY_PROD_DEVTOOLS__: false,
    },
    server: {
      port: 5173,
      // Allow phone access through a quick tunnel (cloudflared / localhost.run).
      allowedHosts: ['.trycloudflare.com', '.lhr.life'],
      // The API is proxied, so the browser sees one origin and CORS is not needed.
      proxy: { '/api': env.VITE_API_TARGET || 'http://127.0.0.1:3000' },
    },
    build: {
      // Single-page local tool; naive-ui and lightweight-charts dominate the bundle.
      chunkSizeWarningLimit: 1500,
    },
  };
});
