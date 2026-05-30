import { getSimulatorBuildSteps } from './simulator.js';

export function getExpoBuildSteps({ scheme, buildConfiguration = 'Release', workDir, distribution }) {
  const prep = [
    {
      name: 'Install JS dependencies',
      cmd: `cd ${workDir} && npm install`,
    },
    {
      name: 'Generate native project (expo prebuild)',
      cmd: `cd ${workDir} && npx expo prebuild --platform ios --clean`,
    },
    {
      name: 'Install CocoaPods dependencies',
      cmd: `cd ${workDir}/ios && pod install`,
    },
  ];

  if (distribution === 'simulator') {
    return [...prep, ...getSimulatorBuildSteps({ scheme, buildConfiguration, workDir })];
  }

  const archivePath = `${workDir}/build/${scheme}.xcarchive`;
  const exportPath = `${workDir}/build/export`;

  return [
    ...prep,
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
