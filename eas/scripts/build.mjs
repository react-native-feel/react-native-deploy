// Bundles the CLI into one minified file for npm. Only dist/ and templates/
// are published, so src/ stays out of the tarball. Third-party dependencies
// stay external and install from npm as usual.
import { readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

// PostHog project 337318. The project token is public by design: it can only
// write events, never read them. RND_POSTHOG_KEY overrides it, and an empty
// value builds a bundle that sends nothing.
const posthogKey = process.env.RND_POSTHOG_KEY ?? 'phc_BhqIVjqo3bFgH9DXqZxs3fUemr4FsF3YqRn655AULe9';

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: ['bin/rnd.js'],
  // Two levels deep, like src/commands/, so the '../../templates' lookup in
  // build:configure resolves to the package's templates/ either way.
  outfile: 'dist/bin/rnd.js',
  bundle: true,
  minify: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  legalComments: 'none',
  define: {
    __RND_VERSION__: JSON.stringify(pkg.version),
    __RND_POSTHOG_KEY__: JSON.stringify(posthogKey),
    __RND_POSTHOG_HOST__: JSON.stringify(process.env.RND_POSTHOG_HOST || 'https://us.i.posthog.com'),
  },
});
