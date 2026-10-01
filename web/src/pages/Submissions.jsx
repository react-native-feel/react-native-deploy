import { useStore } from '../api/store.jsx';
import { EmptyState, StatusDot, formatRelative } from '../components/primitives.jsx';

/**
 * Submissions.
 *
 * Unlike builds, there is no local record to read: `eas submit` hands the binary
 * to App Store Connect and Apple owns the history from that point. Rather than
 * inventing a store that would drift from the truth, this view shows what the
 * CLI recorded and points at the authority for the rest.
 */
export function Submissions() {
  const { submissions, project } = useStore();

  return (
    <>
      <h1 className="page-title">Submissions</h1>

      <div className="card">
        {submissions.length ? (
          <div className="table-wrap">
            <table className="builds">
              <thead>
                <tr>
                  <th>Submission</th>
                  <th>Platform</th>
                  <th>Destination</th>
                  <th>Groups</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => (
                  <tr key={submission.id}>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <StatusDot status={submission.status} />
                        <span className="mono">{submission.id.slice(0, 8)}</span>
                      </span>
                    </td>
                    <td>{submission.platform}</td>
                    <td>
                      {submission.iosConfig
                        ? `App Store Connect ${submission.iosConfig.ascAppIdentifier ?? ''}`
                        : `Play ${submission.androidConfig?.track ?? ''}`}
                    </td>
                    <td>
                      {submission._testFlightGroups?.map((g) => g.name).join(', ') || '—'}
                    </td>
                    <td>{formatRelative(submission._submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="🏪"
            title="No submissions yet"
            cta="Submit your app to the stores"
            href="https://docs.expo.dev/submit/introduction/"
          />
        )}
      </div>

      <div className="banner" style={{ marginTop: 16 }}>
        <span>
          App Store Connect is the record for submissions. Run{' '}
          <code className="mono">eas submit:status</code> for the live version and TestFlight
          builds{project.account ? ` for @${project.account}` : ''}.
        </span>
        <a
          className="btn"
          href="https://appstoreconnect.apple.com/apps"
          target="_blank"
          rel="noreferrer"
        >
          Open App Store Connect ↗
        </a>
      </div>
    </>
  );
}
