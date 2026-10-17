import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  clean: true,
  // Workspace packages ship TS source, so bundle them into the API build.
  noExternal: [/^@hr\//],
});
