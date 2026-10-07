import { defineConfig } from 'vite';
export default defineConfig({ envDir: false, esbuild: { jsx: 'automatic' }, build: { outDir: 'dist/client', emptyOutDir: true }, server: { host: '127.0.0.1' } });
