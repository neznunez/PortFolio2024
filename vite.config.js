import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'mpa',
  server: {
    port: 5173,
    open: true,
    host: true
  },
  preview: {
    port: 4173,
    open: true
  }
});
