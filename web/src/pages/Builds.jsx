import { describeBuild } from '@eas/models/build.js';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useStore } from '../api/store.jsx';
import {
  Avatar,
  EmptyState,
  PlatformIcon,
  StatusDot,
  formatDuration,
  formatRelative,
  shortSha,
} from '../components/primitives.jsx';

/**
 * The Builds table, with the same five filters expo.dev offers.
 *
 * Filter state lives in the query string rather than component state, so a
 * filtered view is a shareable URL — which is how these links actually get used,
 * pasted into a channel when someone asks "which build broke?".
 */

const FILTERS = [
  { key: 'platform', label: 'Platform', of: (b) => (b.platform === 'IOS' ? 'ios' : 'android') },
  { key: 'channel', label: 'Channel', of: (b) => b.updateChannel?.name },
  { key: 'runtime', label: 'Runtime', of: (b) => b.runtime?.version },
  { key: 'profile', label: 'Profile', of: (b) => b.buildProfile },
  { key: 'distribution', label: 'Mode', of: (b) => b.distribution?.toLowerCase() },
];

export function Builds() {
  const { builds, status } = useStore();
  const [params, setParams] = useSearchParams();

  const options = useMemo(() => {
    const map = {};
    for (const filter of FILTERS) {
      map[filter.key] = [...new Set(builds.map(filter.of).filter(Boolean))].sort();
    }
    return map;
  }, [builds]);

  const visible = useMemo(
    () =>
      builds.filter((build) =>
        FILTERS.every((filter) => {
          const selected = params.get(filter.key);
          return !selected || filter.of(build) === selected;
        })
      ),
    [builds, params]
  );

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setParams(next, { replace: true });
  };

  return (
    <>
      <h1 className="page-title">Builds</h1>

      <div className="filters">
        {FILTERS.map((filter) => (
          <label className="filter" key={filter.key}>
            <span className="filter__label">{filter.label}</span>
            <select
              value={params.get(filter.key) ?? ''}
              onChange={(event) => setFilter(filter.key, event.target.value)}
            >
              <option value="">All</option>
              {options[filter.key].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="card">
        {visible.length ? (
          <div className="table-wrap">
            <table className="builds">
              <thead>
                <tr>
                  <th>Build</th>
                  <th>Git ref</th>
                  <th>Profile</th>
                  <th>Runtime</th>
                  <th>Channel</th>
                  <th>Created by</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((build) => (
                  <tr key={build.id}>
                    <td>
                      <Link
                        to={`/builds/${build.id}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                      >
                        <StatusDot status={build.status} />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <PlatformIcon platform={build.platform} />
                            <span style={{ fontWeight: 550 }}>{describeBuild(build)}</span>
                            {build.appVersion ? (
                              <span style={{ color: 'var(--text-muted)' }}>
                                {build.appVersion}
                                {build.appBuildVersion ? ` (${build.appBuildVersion})` : ''}
                              </span>
                            ) : null}
                          </span>
                          <span
                            style={{
                              display: 'flex',
                              gap: 8,
                              color: 'var(--text-muted)',
                              fontSize: 12,
                              marginTop: 2,
                            }}
                          >
                            {formatRelative(build.createdAt)}
                            <span>🕐 {formatDuration(build.metrics.buildDuration)}</span>
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="mono">
                      {shortSha(build.gitCommitHash)}
                      <span style={{ color: 'var(--text-subtle)' }}>•</span>
                    </td>
                    <td>{build.buildProfile ?? '—'}</td>
                    <td className="mono">{build.runtime?.version ?? '—'}</td>
                    <td>{build.updateChannel?.name ?? '—'}</td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <Avatar name={build.initiatingActor?.displayName} />
                        <span>
                          <span style={{ display: 'block' }}>
                            {build.initiatingActor?.displayName ?? '—'}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                            {build.app.ownerAccount?.name ?? ''}
                          </span>
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="📦"
            title={
              status === 'loading' && !builds.length
                ? 'Loading builds…'
                : builds.length
                  ? 'No builds match these filters'
                  : 'No builds yet'
            }
            cta={builds.length || status === 'loading' ? undefined : 'Run eas build'}
          />
        )}
      </div>
    </>
  );
}
