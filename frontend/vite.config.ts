import path from 'path'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from "@sentry/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // 仅在 CI/生产构建且提供 SENTRY_AUTH_TOKEN 时上传 source map（避免本地 dev/build 缺 token 报错）。
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [sentryVitePlugin({
          org: process.env.SENTRY_ORG!,
          project: process.env.SENTRY_PROJECT!,
          authToken: process.env.SENTRY_AUTH_TOKEN,
          sourcemaps: { filesToDeleteAfterUpload: ["dist/**/*.map"] },
        })]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    VDITOR_VERSION: JSON.stringify('3.11.2'),
  },
  build: {
    // 为 Sentry 上传 source map 所需；无 token 时仅本地生成、不外传，不影响产物功能。
    sourcemap: true,
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.PROXY_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
