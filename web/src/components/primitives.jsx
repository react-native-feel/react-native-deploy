import { describeBuild } from '@eas/models/build.js';
import { Link } from 'react-router-dom';

/**
 * The small shared pieces: status marks, platform glyphs, and the two duration
 * formats expo.dev uses. Formatting lives here rather than in each view so a
 * build reads identically in the overview card, the table, and the detail page.
 */

const STATUS_CLASS = {
  FINISHED: 'finished',
  ERRORED: 'errored',
  CANCELED: 'canceled',
  NEW: 'pending',
  IN_QUEUE: 'pending',
  IN_PROGRESS: 'pending',
  PENDING_CANCEL: 'pending',
};

const STATUS_MARK = {
  FINISHED: '✓',
  ERRORED: '✕',
  CANCELED: '–',
};

export function StatusDot({ status, title }) {
  const variant = STATUS_CLASS[status] ?? 'skipped';
  return (
    <span
      className={`status-dot status-dot--${variant}`}
      title={title ?? status}
      aria-label={status}
      role="img"
    >
      {STATUS_MARK[status] ?? ''}
    </span>
  );
}

export function PlatformIcon({ platform }) {
  // Apple's glyph is not in every font, so Android falls back to a robot face
  // rather than a tofu box.
  return (
    <span aria-label={platform} title={platform} style={{ fontSize: 12, lineHeight: 1 }}>
      {platform === 'IOS' ? '' : '🤖'}
    </span>
  );
}

export function Avatar({ name, large }) {
  const initial = (name ?? '?').charAt(0).toUpperCase();
  return <span className={`avatar${large ? ' avatar--lg' : ''}`}>{initial}</span>;
}

/** `6m 45s`, matching both the CLI and expo.dev. */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 1) return '< 1s';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

/** `11 days ago`, `1w ago` — the relative form used in lists. */
export function formatRelative(iso, now = Date.now()) {
  if (!iso) return '—';
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [label, size] of units) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      return `${count} ${label}${count === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Artifacts expire; expo.dev shows the remaining window rather than a date. */
export function formatAvailability(expirationDate) {
  if (!expirationDate) return '—';
  const days = Math.ceil((new Date(expirationDate).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'Expired';
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function shortSha(sha) {
  return (sha ?? '').slice(0, 7) || '—';
}

export function EmptyState({ icon, title, cta, href }) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true">{icon}</div>
      <div className="empty__title">{title}</div>
      {cta ? (
        <a className="empty__cta" href={href ?? '#'} target="_blank" rel="noreferrer">
          {cta} ↗
        </a>
      ) : null}
    </div>
  );
}

/** A compact build row, as used in the overview cards. */
export function BuildRow({ build, to }) {
  const body = (
    <>
      <StatusDot status={build.status} />
      <div className="build-row__body">
        <div className="build-row__title">
          <PlatformIcon platform={build.platform} />
          {describeBuild(build)}
        </div>
        <div className="build-row__meta">
          <Avatar name={build.initiatingActor?.displayName} />
          <span>{formatRelative(build.createdAt)}</span>
          <span className="sep">·</span>
          <span>🕐 {formatDuration(build.metrics.buildDuration)}</span>
          <span className="sep">·</span>
          <span className="mono">{shortSha(build.gitCommitHash)}</span>
        </div>
      </div>
    </>
  );

  return to ? (
    <Link className="build-row" to={to}>
      {body}
    </Link>
  ) : (
    <div className="build-row">{body}</div>
  );
}
