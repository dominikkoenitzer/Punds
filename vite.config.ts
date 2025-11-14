import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['@chakra-ui/react', '@chakra-ui/theme', '@chakra-ui/theme-tools'],
          'animation-vendor': ['framer-motion'],
          'emotion-vendor': ['@emotion/react', '@emotion/styled'],
          'icons-vendor': ['react-icons'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
