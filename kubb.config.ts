import { defineConfig } from '@kubb/core';
import { pluginOas } from '@kubb/plugin-oas';
import { pluginTs } from '@kubb/plugin-ts';
import { pluginZod } from '@kubb/plugin-zod';

// Generates typed models + zod response schemas for the Sentry API from the
// vendored (slimmed) OpenAPI spec. Only the two endpoints Revelo uses are in
// the spec. We intentionally skip the client plugin: its generated functions
// hard-`.parse()` requests/responses, but Sentry's real payloads and our
// partial write bodies don't satisfy the spec's "required" markings, so we
// validate responses leniently ourselves (see api.ts).
export default defineConfig({
  root: '.',
  input: {
    path: './src/providers/sentry/spec/sentry-openapi.json',
  },
  output: {
    path: './src/providers/sentry/gen',
    clean: true,
  },
  plugins: [
    pluginOas({ validate: false }),
    pluginTs({ output: { path: 'types' } }),
    pluginZod({ output: { path: 'zod' }, typed: true }),
  ],
});
