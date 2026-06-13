import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/lib/blob.ts',
        'src/lib/export-store.ts',
        'src/lib/workbook-builder.ts'
      ]
    }
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') }
  }
});
