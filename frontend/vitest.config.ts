import { defineConfig } from 'vitest/config'

import viteConfig from './vite.config'

export default defineConfig({
  ...viteConfig,
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // 仅收集单测；e2e/ 归 Playwright，明确 include 防止 vitest 误抓 .spec.ts
    include: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/main.tsx'],
      // text 报告已含未覆盖行号列；istanbul-reports@3 无 text-missing（c8 遗留名），故不设
      reporter: ['text'],
    },
  },
})
