import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Matches Next.js's actual JSX runtime (SWC, automatic, no React import required) rather than
  // esbuild's classic-transform default, which needs `React` in scope. tsconfig.json's
  // `"jsx": "preserve"` leaves the choice to whatever tool actually transforms it — Next's build
  // for the app, and this for tests — so a component under `app/` or `src/ui/` renders the same
  // way here as it does in production, with no per-file React import added just to satisfy a
  // test runner default (lane-review finding 3's render test surfaced this gap).
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
  resolve: {
    alias: {
      '@/contracts': r('./src/contracts'),
      '@/adapters': r('./src/adapters'),
      '@/analytics': r('./src/analytics'),
      '@/calc': r('./src/calc'),
      '@/repositories': r('./src/repositories'),
      '@/services': r('./src/services'),
      '@/agent': r('./src/agent'),
      '@/ui': r('./src/ui'),
      '@/fixtures': r('./fixtures'),
      '@/env': r('./src/env.ts'),
      '@': r('./src'),
    },
  },
});
