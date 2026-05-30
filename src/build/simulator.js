// Simulator builds produce an unsigned .app for the iphonesimulator SDK — no
// provisioning profile, no ASC key, no codesigning. The .app is a directory,
// so we tar+gzip it into a single artifact for upload/distribution.

export function getSimulatorProductsDir(workDir, buildConfiguration = 'Release') {
  return `${workDir}/build/dd/Build/Products/${buildConfiguration}-iphonesimulator`;
}

export function getSimulatorAppPath(workDir, scheme, buildConfiguration = 'Release') {
  return `${getSimulatorProductsDir(workDir, buildConfiguration)}/${scheme}.app`;
}

export function getSimulatorTarballPath(workDir, scheme) {
  return `${workDir}/build/${scheme}.app.tgz`;
}

export function getSimulatorBuildSteps({ scheme, buildConfiguration = 'Release', workDir }) {
  const derivedData = `${workDir}/build/dd`;
  const productsDir = getSimulatorProductsDir(workDir, buildConfiguration);
  const tarball = getSimulatorTarballPath(workDir, scheme);

  return [
    {
      name: 'Build for iOS Simulator (unsigned)',
      cmd: `xcodebuild build -workspace ${workDir}/ios/${scheme}.xcworkspace -scheme ${scheme} -configuration ${buildConfiguration} -sdk iphonesimulator -derivedDataPath ${derivedData} CODE_SIGNING_ALLOWED=NO`,
    },
    {
      name: 'Package .app into a tarball',
      cmd: `cd ${productsDir} && tar -czf ${tarball} ${scheme}.app`,
    },
  ];
}
