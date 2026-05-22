// Generates the iOS OTA distribution manifest.plist that Safari hands to
// itms-services://?action=download-manifest;url={manifestUrl}.
//
// Schema: https://developer.apple.com/library/archive/documentation/IDEs/Conceptual/AppDistributionGuide/DistributingEnterpriseProgramApps/DistributingEnterpriseProgramApps.html
export function generateManifestPlist({
  ipaUrl,
  bundleId,
  bundleVersion,
  title,
  fullSizeImageUrl,
  displayImageUrl,
}) {
  if (!ipaUrl || !bundleId || !bundleVersion || !title) {
    throw new Error('generateManifestPlist requires ipaUrl, bundleId, bundleVersion, title');
  }

  const assets = [
    `      <dict>
        <key>kind</key>
        <string>software-package</string>
        <key>url</key>
        <string>${escapeXml(ipaUrl)}</string>
      </dict>`,
  ];

  if (displayImageUrl) {
    assets.push(`      <dict>
        <key>kind</key>
        <string>display-image</string>
        <key>url</key>
        <string>${escapeXml(displayImageUrl)}</string>
      </dict>`);
  }

  if (fullSizeImageUrl) {
    assets.push(`      <dict>
        <key>kind</key>
        <string>full-size-image</string>
        <key>url</key>
        <string>${escapeXml(fullSizeImageUrl)}</string>
      </dict>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
${assets.join('\n')}
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${escapeXml(bundleId)}</string>
        <key>bundle-version</key>
        <string>${escapeXml(bundleVersion)}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${escapeXml(title)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
