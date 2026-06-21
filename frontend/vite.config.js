import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: __dirname,
    plugins: [vue()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
            vue: 'vue/dist/vue.esm-bundler.js'
        }
    },
    server: {
        port: 5173,
        proxy: {
            '/api': { target: 'http://localhost:5000', changeOrigin: true },
            '/uploads': { target: 'http://localhost:5000', changeOrigin: true },
            '/images': { target: 'http://localhost:5000', changeOrigin: true },
            '/logout': { target: 'http://localhost:5000', changeOrigin: true }
        }
    },
    build: {
        outDir: path.resolve(__dirname, '..', 'dist'),
        emptyOutDir: true
    }
});
