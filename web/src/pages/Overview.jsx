import { Link } from 'react-router-dom';

import { isDevelopmentBuild, isProductionBuild, useStore } from '../api/store.jsx';
import { Avatar, BuildRow, EmptyState } from '../components/primitives.jsx';

/**
 * The "Develop & deploy" screen — the project landing page.
 *
 * Three cards matter here and they mirror expo.dev exactly: development builds,
 * production builds, and submissions. Each shows the three most recent entries
 * or an empty state pointing at the command that would create one.
 */
export function Overview() {
  const { builds, submissions, project } = useStore();

  const development = builds.filter(isDevelopmentBuild).slice(0, 3);
  const production = builds.filter(isProductionBuild).slice(0, 3);

  return (
    <>
      <header style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 26 }}>
        <Avatar name={project.name} large />
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>
            {project.name}
          </h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>@{project.account}</div>
        </div>
      </header>

      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 14px' }}>Develop &amp; deploy</h2>

      <div className="card-grid">
        <section className="card">
          <div className="card__header">
            <span className="card__header-title">📦 Development builds</span>
            {development.length ? (
              <Link className="card__link" to="/builds?distribution=internal">
                View all
              </Link>
            ) : null}
          </div>
          {development.length ? (
            development.map((build) => (
              <BuildRow key={build.id} build={build} to={`/builds/${build.id}`} />
            ))
          ) : (
            <EmptyState
              icon="📦"
              title="No development builds yet"
              cta="Build your app for testing"
              href="https://docs.expo.dev/develop/development-builds/introduction/"
            />
          )}
        </section>

        <section className="card">
          <div className="card__header">
            <span className="card__header-title">📦 Production builds</span>
            {production.length ? (
              <Link className="card__link" to="/builds?distribution=store">
                View all
              </Link>
            ) : null}
          </div>
          {production.length ? (
            production.map((build) => (
              <BuildRow key={build.id} build={build} to={`/builds/${build.id}`} />
            ))
          ) : (
            <EmptyState
              icon="📦"
              title="No production builds yet"
              cta="Build your app for distribution"
              href="https://docs.expo.dev/build/setup/"
            />
          )}
        </section>

        <section className="card">
          <div className="card__header">
            <span className="card__header-title">🏪 Submissions</span>
            {submissions.length ? (
              <Link className="card__link" to="/submissions">
                View all
              </Link>
            ) : null}
          </div>
          {submissions.length ? (
            submissions.map((submission) => (
              <div className="build-row" key={submission.id}>
                <div className="build-row__body">
                  <div className="build-row__title">{submission.platform} submission</div>
                  <div className="build-row__meta">{submission.status}</div>
                </div>
              </div>
            ))
          ) : (
            <EmptyState
              icon="🏪"
              title="No submissions yet"
              cta="Submit your app to the stores"
              href="https://docs.expo.dev/submit/introduction/"
            />
          )}
        </section>
      </div>
    </>
  );
}
