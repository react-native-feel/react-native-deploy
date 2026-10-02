// Bundles the CLI into one minified file for npm. Only dist/ and templates/
// are published, so src/ stays out of the tarball. Third-party dependencies
// stay external and install from npm as usual.
import { readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

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
  define: { __RND_VERSION__: JSON.stringify(pkg.version) },
});
