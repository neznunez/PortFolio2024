import { defineConfig } from 'vite';

function projectSlugFallback() {
  const rewrite = (req, _res, next) => {
    const raw = req.url || '/';
    const path = raw.split('?')[0];
    if (
      path === '/' ||
      path === '/index.html' ||
      path === '/lite.html' ||
      path === '/project.html' ||
      path.startsWith('/@') ||
      path.startsWith('/node_modules') ||
      path.startsWith('/fb-storage') ||
      path.startsWith('/fb-storage-app') ||
      path.startsWith('/gcs-storage') ||
      /\.[a-zA-Z0-9]+$/.test(path)
    ) {
      return next();
    }
    const q = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
    req.url = '/index.html' + q;
    next();
  };

  return {
    name: 'project-slug-fallback',
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    }
  };
}

export default defineConfig({
  appType: 'mpa',
  plugins: [projectSlugFallback()],
  server: {
    port: 5173,
    open: true,
    host: true,
    proxy: {
      '/fb-storage': {
        target: 'https://firebasestorage.googleapis.com',
        changeOrigin: true,
        secure: true,
        rewrite: function (path) {
          return path.replace(/^\/fb-storage/, '');
        }
      },
      '/fb-storage-app': {
        target: 'https://portfolio-neznunez.firebasestorage.app',
        changeOrigin: true,
        secure: true,
        rewrite: function (path) {
          return path.replace(/^\/fb-storage-app/, '');
        }
      },
      '/gcs-storage': {
        target: 'https://storage.googleapis.com',
        changeOrigin: true,
        secure: true,
        rewrite: function (path) {
          return path.replace(/^\/gcs-storage/, '');
        }
      }
    }
  },
  preview: {
    port: 4173,
    open: true
  }
});
