import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В dev клиент работает на :5173, а Socket.io проксируется на сервер :3001,
// чтобы для браузера всё было на одном origin (TDD §12).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/healthz': 'http://localhost:3001',
    },
  },
});
