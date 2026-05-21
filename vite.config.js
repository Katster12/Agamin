import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      // During local dev, proxy /api/coingecko to CoinGecko directly
      // (on Vercel, the serverless function in api/coingecko.js handles this)
      '/api/coingecko': {
        target: 'https://api.coingecko.com/api/v3',
        changeOrigin: true,
        rewrite: (path) => {
          const url = new URL(path, 'http://localhost');
          const cgPath = url.searchParams.get('path') || '';
          url.searchParams.delete('path');
          return `${cgPath}?${url.searchParams.toString()}`;
        },
      },
    },
  },
})
