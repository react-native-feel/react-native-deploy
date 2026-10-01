import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';

/**
 * "Install on a test device" — the modal behind the Install button.
 *
 * The QR encodes a page URL, not the artifact — the same indirection EAS uses.
 * For internal builds that page is the install service's /install/<dispatchId>
 * (see worker/), which checks the build was published and hands the phone an
 * itms-services link (iOS) or the APK (Android). A GitHub artifact URL would
 * give the phone a zip behind a login, which it cannot install.
 */
export function InstallModal({ build, installUrl, onClose }) {
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(installUrl, {
      width: 448, // 2× the rendered size, so it stays sharp on a retina screen
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [installUrl]);

  // Escape closes, and focus starts inside the dialog so a keyboard user is not
  // left tabbing through the page behind it.
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(installUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied; the URL is selectable either way.
    }
  };

  const isSimulator = build.isForIosSimulator;
  const isIos = build.platform === 'IOS';

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
        ref={dialogRef}
      >
        <button className="modal__close" onClick={onClose} aria-label="Close" ref={closeRef}>
          ✕
        </button>

        <h2 className="modal__title" id="install-title">
          Install on a test device
        </h2>

        <p className="modal__lead">
          {isSimulator
            ? 'This is a simulator build. Download it and drag it onto a running iOS Simulator — it cannot be installed on a physical device.'
            : `You can install this ${build.distribution === 'INTERNAL' ? 'internal distribution' : 'production'} build on any device for which this build was provisioned. `}
          {!isSimulator && (
            <a
              href="https://docs.expo.dev/build/internal-distribution/"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              Learn more.
            </a>
          )}
        </p>

        {!isSimulator && (
          <>
            <p className="modal__section-title">Scan this code with a device</p>
            <p className="modal__hint">
              Open the Camera app and point it at this code. Then tap the notification that appears.
            </p>

            <div className="qr">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt={`QR code linking to ${installUrl}`} />
              ) : (
                <div
                  style={{ width: 224, height: 224, display: 'grid', placeItems: 'center', color: 'var(--text-subtle)' }}
                >
                  Generating…
                </div>
              )}
            </div>

            <details className="disclosure">
              <summary>How to install this build on {isIos ? 'iOS' : 'Android'}</summary>
              {isIos ? (
                <ol>
                  <li>Make sure the device&apos;s UDID is registered and included in this build&apos;s provisioning profile — a device added afterwards needs a new build.</li>
                  <li>Scan the code above, or open the link on the device.</li>
                  <li>Tap Install and confirm the prompt.</li>
                  <li>In Settings → General → VPN &amp; Device Management, trust the developer certificate.</li>
                </ol>
              ) : (
                <ol>
                  <li>Scan the code above, or open the link on the device.</li>
                  <li>Download the APK and allow installs from your browser if prompted.</li>
                  <li>Open the downloaded file to install it.</li>
                </ol>
              )}
            </details>
          </>
        )}

        <p className="modal__section-title">Send a link to a device</p>
        <p className="modal__hint">
          Send and open the URL below to install it on a registered device.
        </p>

        <div className="copy-field">
          <input readOnly value={installUrl} aria-label="Install URL" onFocus={(e) => e.target.select()} />
          <button onClick={copy} aria-label="Copy install URL" title="Copy">
            {copied ? '✓' : '📋'}
          </button>
        </div>
      </div>
    </div>
  );
}
