import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { DEMO_PROJECT, demoBuilds, demoSubmissions } from './demo.js';
import { clearSettings, fetchBuild, fetchBuilds, readSettings, writeSettings } from './github.js';

/**
 * One data provider over two sources: the demo fixtures, and a real GitHub repo.
 *
 * Demo mode is the default so the page renders for someone who just opened it.
 * Connecting a repo swaps the source without any component knowing — every view
 * consumes Build records, and both sources produce them through the same mapper.
 */

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [settings, setSettings] = useState(() => readSettings());
  const [builds, setBuilds] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  // A public repo's Actions runs are readable without a token; one is only
  // needed for private repos and GitHub's higher rate limit.
  const isLive = Boolean(settings.repo);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      if (isLive) {
        setBuilds(await fetchBuilds(settings));
      } else {
        setBuilds(demoBuilds());
      }
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      // Fall back to demo data rather than showing an empty shell — a broken
      // token should not make the dashboard look like it has no features.
      setBuilds(demoBuilds());
      setStatus('error');
    }
  }, [isLive, settings]);

  useEffect(() => {
    load();
  }, [load]);

  const connect = useCallback((next) => {
    writeSettings(next);
    setSettings(readSettings());
  }, []);

  const disconnect = useCallback(() => {
    clearSettings();
    setSettings({ token: '', repo: '' });
  }, []);

  const getBuild = useCallback(
    async (buildId) => {
      const known = builds.find((b) => b.id === buildId || String(b._githubRunId) === buildId);
      if (!isLive) {
        return known ?? null;
      }
      if (!known) return null;
      return fetchBuild({ ...settings, runId: known._githubRunId });
    },
    [builds, isLive, settings]
  );

  const value = useMemo(
    () => ({
      builds,
      submissions: demoSubmissions(),
      project: isLive
        ? {
            name: settings.repo.split('/')[1],
            slug: settings.repo.split('/')[1],
            account: settings.repo.split('/')[0],
            repo: settings.repo,
          }
        : DEMO_PROJECT,
      status,
      error,
      isLive,
      settings,
      connect,
      disconnect,
      reload: load,
      getBuild,
    }),
    [builds, isLive, settings, status, error, connect, disconnect, load, getBuild]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error('useStore must be used inside <StoreProvider>');
  }
  return store;
}

/** Development builds are the internal-distribution and simulator ones. */
export function isDevelopmentBuild(build) {
  return build.distribution === 'INTERNAL' || build.distribution === 'SIMULATOR';
}

export function isProductionBuild(build) {
  return build.distribution === 'STORE';
}
