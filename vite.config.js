import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'mpa',
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
