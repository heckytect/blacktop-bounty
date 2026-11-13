import { defineConfig } from 'vitest/config';

// Relative asset paths so the static build runs from any host or subfolder (spec §12.1 hosting).
export default defineConfig({
  base: './',
  // One ~5 MB bundle (Rapier's wasm is inlined); still inside the 8 MB first-load budget (spec §12.4).
  build: { chunkSizeWarningLimit: 6000 },
  test: { include: ['tests/**/*.test.ts'] }, // e2e/ belongs to Playwright
});
