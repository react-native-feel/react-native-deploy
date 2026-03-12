export function getClassicBuildSteps({ scheme, buildConfiguration = 'Release', workDir }) {
  const archivePath = `${workDir}/build/${scheme}.xcarchive`;
  const exportPath = `${workDir}/build/export`;

  return [
    {
      name: 'Install JS dependencies',
      cmd: `cd ${workDir} && npm install`,
    },
    {
      name: 'Install CocoaPods dependencies',
      cmd: `cd ${workDir}/ios && pod install`,
    },
    {
      name: 'Archive iOS app',
      cmd: `xcodebuild archive -workspace ${workDir}/ios/${scheme}.xcworkspace -scheme ${scheme} -configuration ${buildConfiguration} -archivePath ${archivePath} -destination "generic/platform=iOS" CODE_SIGN_STYLE=Manual`,
    },
    {
      name: 'Export .ipa',
      cmd: `xcodebuild -exportArchive -archivePath ${archivePath} -exportPath ${exportPath} -exportOptionsPlist ${workDir}/ExportOptions.plist`,
    },
  ];
}
