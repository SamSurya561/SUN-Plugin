import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/ui',
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'build/com.sun.plugin'),
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/ui/src/main.jsx'),
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'sun-app.js',
        assetFileNames: (info) => {
          if (info.name && info.name.endsWith('.css')) return 'sun-app.css';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/ui/src'),
    },
  },
});
