import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useStore } from './api/store.jsx';
import { Avatar } from './components/primitives.jsx';
import { BuildDetail } from './pages/BuildDetail.jsx';
import { Builds } from './pages/Builds.jsx';
import { Overview } from './pages/Overview.jsx';
import { Submissions } from './pages/Submissions.jsx';

/**
 * NavLink matches on pathname only, so "/builds?distribution=internal" and
 * "/builds" would both light up. A link is active only when the query it
 * carries matches too — and a bare link only when the URL has no filter.
 */
function queryMatches(to, search) {
  const linkQuery = new URLSearchParams(to.split('?')[1] ?? '');
  const current = new URLSearchParams(search);
  if ([...linkQuery.keys()].length === 0) {
    return !current.has('distribution');
  }
  return [...linkQuery].every(([key, value]) => current.get(key) === value);
}

/** The left rail, grouped the way expo.dev groups it. */
const NAV = [
  {
    section: 'Project',
    links: [{ to: '/', label: 'Overview', icon: '▦', end: true }],
  },
  {
    section: 'Develop',
    links: [{ to: '/builds?distribution=internal', label: 'Development builds', icon: '📦' }],
  },
  {
    section: 'Deploy',
    links: [
      { to: '/builds', label: 'Builds', icon: '📦' },
      { to: '/submissions', label: 'Submissions', icon: '🏪' },
    ],
  },
];

export function App() {
  const { project, isLive, status, error, connect, disconnect, reload } = useStore();
  const location = useLocation();

  return (
    <div className="shell">
      <nav className="rail">
        <div className="rail__brand">
          <span aria-hidden="true">▲</span> Deploy
        </div>

        <div className="rail__project">
          <Avatar name={project.name} />
          <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {project.name}
          </span>
        </div>

        {NAV.map((group) => (
          <div key={group.section}>
            <div className="rail__section">{group.section}</div>
            {group.links.map((linkProps) => (
              <NavLink
                key={linkProps.label}
                to={linkProps.to}
                end={linkProps.end}
                className={({ isActive }) =>
                  `rail__link${isActive && queryMatches(linkProps.to, location.search) ? ' is-active' : ''}`
                }
              >
                <span aria-hidden="true">{linkProps.icon}</span>
                {linkProps.label}
              </NavLink>
            ))}
          </div>
        ))}

        {/* The docs are a separate site on the same origin, outside the router's basename. */}
        <div>
          <div className="rail__section">Help</div>
          <a className="rail__link" href="/deploy/docs/">
            <span aria-hidden="true">📖</span>
            Docs
          </a>
        </div>
      </nav>

      <main className="main">
        <ConnectionBanner
          isLive={isLive}
          status={status}
          error={error}
          project={project}
          onConnect={connect}
          onDisconnect={disconnect}
          onReload={reload}
        />

        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/builds" element={<Builds />} />
          <Route path="/builds/:buildId" element={<BuildDetail />} />
          <Route path="/submissions" element={<Submissions />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

/**
 * Explains where the data on screen came from, and offers the swap.
 *
 * Demo mode has to announce itself — a dashboard showing plausible builds that
 * are not yours is worse than one showing nothing.
 */
function ConnectionBanner({ isLive, status, error, project, onConnect, onDisconnect, onReload }) {
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState(project.repo ?? '');
  const [token, setToken] = useState('');

  if (error) {
    return (
      <div className="banner banner--error">
        <span>{error} — showing demo data instead.</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onReload}>
            Retry
          </button>
          <button className="btn" onClick={onDisconnect}>
            Disconnect
          </button>
        </span>
      </div>
    );
  }

  if (isLive) {
    return (
      <div className="banner">
        <span>
          Live — reading GitHub Actions runs from <strong>{project.repo}</strong>
          {status === 'loading' ? ' (refreshing…)' : ''}
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onReload}>
            Refresh
          </button>
          <button className="btn" onClick={onDisconnect}>
            Disconnect
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="banner">
      {open ? (
        <form
          className="connect-form"
          onSubmit={(event) => {
            event.preventDefault();
            onConnect({ repo: repo.trim(), token: token.trim() });
          }}
        >
          <label className="filter">
            <span className="filter__label">Repository</span>
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/name"
              required
            />
          </label>
          <label className="filter">
            <span className="filter__label">GitHub token (read-only, optional for public repos)</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_…"
            />
          </label>
          <button className="btn btn--primary" type="submit">
            Connect
          </button>
          <button className="btn" type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span>
            Showing <strong>demo data</strong>. Connect a repository to read your own builds — the
            token stays in this browser and is only ever sent to api.github.com.
          </span>
          <button className="btn btn--primary" onClick={() => setOpen(true)}>
            Connect a repository
          </button>
        </>
      )}
    </div>
  );
}
