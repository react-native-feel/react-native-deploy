import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  indexKeyFor,
  toIndexRecord,
  parseIndex,
  addRecord,
  appendToIndex,
  readIndex,
  readAllIndexes,
  sanitizeSlug,
  deriveSlug,
} from '../../src/distribute/registry.js';

const sampleMeta = {
  id: 'uuid-1',
  slug: 'myapp',
  profile: 'preview',
  distribution: 'simulator',
  artifactKind: 'simulator-app',
  scheme: 'MyApp',
  bundleId: 'com.example.app',
  version: '1.0.0',
  buildNumber: '3',
  commit: 'abc1234',
  branch: 'main',
  createdAt: '2026-05-20T12:00:00Z',
  artifactUrl: 'https://cdn/app.app.tgz',
  installPageUrl: 'https://cdn/index.html',
  manifestUrl: null,
  itmsServicesUrl: null,
};

// In-memory storage stub matching the adapter surface registry uses.
function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    async getString(key) {
      return key in store ? store[key] : null;
    },
    async putString(content, key) {
      store[key] = content;
      return `https://cdn/${key}`;
    },
    async listPrefixes(prefix) {
      const p = prefix.replace(/\/?$/, '/');
      const slugs = new Set();
      for (const key of Object.keys(store)) {
        if (key.startsWith(p)) {
          const rest = key.slice(p.length);
          slugs.add(rest.split('/')[0]);
        }
      }
      return [...slugs];
    },
  };
}

describe('registry pure helpers', () => {
  it('indexKeyFor is per-app', () => {
    assert.strictEqual(indexKeyFor('myapp'), 'builds/myapp/index.json');
  });

  it('sanitizeSlug lowercases and strips unsafe chars', () => {
    assert.strictEqual(sanitizeSlug('My App!'), 'my-app');
    assert.strictEqual(sanitizeSlug('---'), 'app');
  });

  it('deriveSlug prefers app.slug, then profile scheme', () => {
    assert.strictEqual(deriveSlug({ app: { slug: 'Cool App' } }), 'cool-app');
    assert.strictEqual(deriveSlug({}, { scheme: 'MyApp' }), 'myapp');
    assert.strictEqual(deriveSlug({ build: { production: { scheme: 'Prod' } } }), 'prod');
  });

  it('toIndexRecord keeps only summary fields', () => {
    const rec = toIndexRecord(sampleMeta);
    assert.strictEqual(rec.id, 'uuid-1');
    assert.strictEqual(rec.artifactKind, 'simulator-app');
    assert.ok(!('manifestUrl' in rec));
    assert.ok(!('itmsServicesUrl' in rec));
  });

  it('parseIndex returns empty index for null/garbage', () => {
    assert.deepStrictEqual(parseIndex(null), { version: 1, builds: [] });
    assert.deepStrictEqual(parseIndex('not json'), { version: 1, builds: [] });
    assert.deepStrictEqual(parseIndex('{"builds":"nope"}'), { version: 1, builds: [] });
  });

  it('addRecord prepends newest-first and de-dupes by id', () => {
    let index = { version: 1, builds: [] };
    index = addRecord(index, { id: 'a', createdAt: '1' });
    index = addRecord(index, { id: 'b', createdAt: '2' });
    index = addRecord(index, { id: 'a', createdAt: '3' }); // re-add a
    assert.deepStrictEqual(index.builds.map(b => b.id), ['a', 'b']);
    assert.strictEqual(index.builds[0].createdAt, '3');
  });
});

describe('appendToIndex / readIndex', () => {
  it('creates the index on first build', async () => {
    const storage = fakeStorage();
    await appendToIndex(storage, 'myapp', sampleMeta);
    const builds = await readIndex(storage, 'myapp');
    assert.strictEqual(builds.length, 1);
    assert.strictEqual(builds[0].id, 'uuid-1');
    assert.ok('builds/myapp/index.json' in storage.store);
  });

  it('prepends subsequent builds', async () => {
    const storage = fakeStorage();
    await appendToIndex(storage, 'myapp', sampleMeta);
    await appendToIndex(storage, 'myapp', { ...sampleMeta, id: 'uuid-2', createdAt: '2026-05-21T12:00:00Z' });
    const builds = await readIndex(storage, 'myapp');
    assert.deepStrictEqual(builds.map(b => b.id), ['uuid-2', 'uuid-1']);
  });

  it('keeps separate indexes per app', async () => {
    const storage = fakeStorage();
    await appendToIndex(storage, 'appone', { ...sampleMeta, slug: 'appone', id: 'x' });
    await appendToIndex(storage, 'apptwo', { ...sampleMeta, slug: 'apptwo', id: 'y' });
    assert.strictEqual((await readIndex(storage, 'appone')).length, 1);
    assert.strictEqual((await readIndex(storage, 'apptwo')).length, 1);
  });
});

describe('readAllIndexes', () => {
  it('merges across slugs newest-first', async () => {
    const storage = fakeStorage();
    await appendToIndex(storage, 'appone', { ...sampleMeta, slug: 'appone', id: 'old', createdAt: '2026-01-01T00:00:00Z' });
    await appendToIndex(storage, 'apptwo', { ...sampleMeta, slug: 'apptwo', id: 'new', createdAt: '2026-06-01T00:00:00Z' });
    const all = await readAllIndexes(storage);
    assert.deepStrictEqual(all.map(b => b.id), ['new', 'old']);
  });

  it('returns [] when there are no builds', async () => {
    const storage = fakeStorage();
    assert.deepStrictEqual(await readAllIndexes(storage), []);
  });
});
