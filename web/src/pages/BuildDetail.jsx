import { describeBuild } from '@eas/models/build.js';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useStore } from '../api/store.jsx';
import { InstallModal } from '../components/InstallModal.jsx';
import {
  Avatar,
  PlatformIcon,
  StatusDot,
  formatAvailability,
  formatDateTime,
  formatDuration,
  shortSha,
} from '../components/primitives.jsx';

/**
 * The build detail page: header, metadata strip, artifact card, and the phase
 * timeline — each sourced from a real workflow run rather than a summary.
 */
export function BuildDetail() {
  const { buildId } = useParams();
  const { getBuild, project } = useStore();
  const [build, setBuild] = useState(null);
  const [state, setState] = useState('loading');
  const [installOpen, setInstallOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    getBuild(buildId)
      .then((result) => {
        if (cancelled) return;
        setBuild(result);
        setState(result ? 'ready' : 'missing');
      })
      .catch(() => {
        if (!cancelled) setState('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [buildId, getBuild]);

  if (state === 'loading') {
    return <div style={{ color: 'var(--text-muted)' }}>Loading build…</div>;
  }
  if (state === 'missing' || !build) {
    return (
      <>
        <Breadcrumb buildId={buildId} />
        <div className="card">
          <div className="empty">
            <div className="empty__icon">?</div>
            <div className="empty__title">No build with that id</div>
          </div>
        </div>
      </>
    );
  }

  const canInstall =
    build.status === 'FINISHED' &&
    Boolean(build.artifacts.applicationArchiveUrl) &&
    build.distribution !== 'STORE';

  // Internal builds are published to the install service under their random
  // dispatch id; the QR goes straight to that page, which works on a phone with
  // no GitHub token. Anything else falls back to this build's dashboard page.
  const installOrigin = import.meta.env.VITE_INSTALL_ORIGIN || window.location.origin;
  const installUrl =
    build.distribution === 'INTERNAL' && build._dispatchId
      ? `${installOrigin}/install/${build._dispatchId}`
      : `${window.location.origin}${import.meta.env.BASE_URL}builds/${build.id}`;
  const artifactKind = build.isForIosSimulator
    ? 'APP'
    : build.platform === 'IOS'
      ? 'IPA'
      : build.distribution === 'INTERNAL'
        ? 'APK'
        : 'AAB';

  return (
    <>
      <Breadcrumb buildId={build.id} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="detail-head">
          <PlatformIcon platform={build.platform} />
          <div style={{ minWidth: 0 }}>
            <div className="detail-head__title">{describeBuild(build)}</div>
            <div className="detail-head__message">
              <span className="mono">{shortSha(build.gitCommitHash)}</span>
              {build.gitCommitMessage ? ` · ${build.gitCommitMessage}` : ''}
            </div>
          </div>
        </div>

        <div className="meta-grid">
          <Meta label="Profile" value={build.buildProfile ?? '—'} />
          <Meta label="Environment" value={build.buildProfile ?? '—'} />
          <Meta label="Deployment" value={build.updateChannel?.name ?? '—'} />
          <Meta
            label="Version"
            value={
              build.appVersion
                ? `${build.appVersion}${build.appBuildVersion ? ` (${build.appBuildVersion})` : ''}`
                : '—'
            }
          />
          <Meta label="Fingerprint" value={build.fingerprint?.hash ?? '—'} mono />
          <Meta label="Commit" value={shortSha(build.gitCommitHash)} mono />
          <Meta
            label="Created by"
            value={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Avatar name={build.initiatingActor?.displayName} />
                {build.initiatingActor?.displayName ?? '—'}
              </span>
            }
          />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__header">
          <span className="card__header-title">
            Build artifact <span className="badge">{artifactKind}</span>
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn--primary"
              disabled={!canInstall}
              onClick={() => setInstallOpen(true)}
              title={
                canInstall
                  ? 'Install on a test device'
                  : build.distribution === 'STORE'
                    ? 'Store builds are installed through TestFlight, not over the air'
                    : 'No installable artifact for this build'
              }
            >
              ⬇ Install
            </button>
            <a
              className="btn"
              href={build.artifacts.buildUrl ?? '#'}
              target="_blank"
              rel="noreferrer"
            >
              Open on GitHub ↗
            </a>
          </span>
        </div>

        <div className="table-wrap">
          <table className="builds" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Start time</th>
                <th>Wait time</th>
                <th>Queue time</th>
                <th>Build time</th>
                <th>Total time</th>
                <th>Availability</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <StatusDot status={build.status} />
                    {titleCase(build.status)}
                  </span>
                </td>
                <td>{formatDateTime(build.createdAt)}</td>
                <td>{formatDuration(build.metrics.buildWaitTime)}</td>
                <td>{formatDuration(build.metrics.buildQueueTime)}</td>
                <td>{formatDuration(build.metrics.buildDuration)}</td>
                <td>
                  {formatDuration(
                    (build.metrics.buildQueueTime ?? 0) + (build.metrics.buildDuration ?? 0)
                  )}
                </td>
                <td>{formatAvailability(build.expirationDate)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {build.error ? (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--danger)' }}>
          <div className="card__header" style={{ color: 'var(--danger)' }}>
            <span className="card__header-title">{build.error.errorCode}</span>
          </div>
          <div style={{ padding: '12px 16px' }}>
            <div>{build.error.message}</div>
            {build.error.docsUrl ? (
              <a
                href={build.error.docsUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)', fontSize: 13 }}
              >
                Open the failing step ↗
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card__header">
          <span className="card__header-title">Logs</span>
          {build.artifacts.xcodeBuildLogsUrl ? (
            <a
              className="card__link"
              href={build.artifacts.xcodeBuildLogsUrl}
              target="_blank"
              rel="noreferrer"
            >
              Xcode logs ↗
            </a>
          ) : null}
        </div>
        {build._phases?.length ? (
          build._phases.map((phase) => (
            <div className="phase-row" key={phase.key}>
              <StatusDot status={phase.status} />
              <span className="phase-row__name">{phase.name}</span>
              <span className="phase-row__time">{formatDuration(phase.durationSeconds)}</span>
            </div>
          ))
        ) : (
          <div style={{ padding: '16px', color: 'var(--text-muted)' }}>
            Step timings load with the full build view.{' '}
            <a
              href={build.artifacts.buildUrl ?? '#'}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              Open the run on GitHub
            </a>
          </div>
        )}
      </div>

      {installOpen ? (
        <InstallModal build={build} installUrl={installUrl} onClose={() => setInstallOpen(false)} />
      ) : null}
    </>
  );
}

function Breadcrumb({ buildId }) {
  return (
    <div className="breadcrumb">
      <Link to="/builds">📦 Builds</Link>
      <span>›</span>
      <span className="mono">{String(buildId).slice(0, 8)}</span>
    </div>
  );
}

function Meta({ label, value, mono }) {
  return (
    <div className="meta-grid__cell">
      <div className="meta-grid__label">{label}</div>
      <div className={`meta-grid__value${mono ? ' mono' : ''}`}>{value}</div>
    </div>
  );
}

function titleCase(status) {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
}
