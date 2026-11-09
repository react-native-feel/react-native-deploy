import { defineConfig } from 'vitepress';

// Built under /deploy/docs/ and served two ways from the same files: by the
// Cloudflare Pages app next to the dashboard (react-native-deploy.pages.dev),
// and proxied from reactnativefeel.com/deploy/docs — the canonical address.
export default defineConfig({
  base: '/deploy/docs/',
  title: 'React Native Deploy',
  description:
    'A drop-in EAS replacement: the same rnd commands and eas.json, with builds on GitHub Actions and store delivery through asc.',
  cleanUrls: true,
  lastUpdated: false,
  head: [['meta', { name: 'theme-color', content: '#4f46e5' }]],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'Commands', link: '/reference/commands', activeMatch: '/reference/commands' },
      { text: 'Workflow', link: '/reference/workflow', activeMatch: '/reference/workflow' },
      // The dashboard is a separate app on the Pages origin, not a docs page.
      // Absolute, because reactnativefeel.com proxies the docs but not the dashboard.
      { text: 'Dashboard', link: 'https://react-native-deploy.pages.dev/deploy/dashboard/' },
    ],
    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'How it works', link: '/guide/how-it-works' },
          { text: 'Differences from EAS', link: '/guide/differences' },
        ],
      },
      {
        text: 'Build',
        items: [
          { text: 'Building', link: '/guide/building' },
          { text: 'eas.json support', link: '/guide/eas-json' },
          { text: 'Development builds', link: '/guide/development-builds' },
          { text: 'Internal distribution (QR)', link: '/guide/internal-distribution' },
        ],
      },
      {
        text: 'Ship',
        items: [
          { text: 'Credentials', link: '/guide/credentials' },
          { text: 'Submitting to TestFlight', link: '/guide/submit' },
        ],
      },
      {
        text: 'Operate',
        items: [
          { text: 'Dashboard & install service', link: '/guide/dashboard' },
          { text: 'Troubleshooting', link: '/guide/troubleshooting' },
          { text: 'Telemetry', link: '/guide/telemetry' },
        ],
      },
      {
        text: 'Open source',
        items: [{ text: 'Contributing', link: '/guide/contributing' }],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Commands', link: '/reference/commands' },
          { text: 'Workflow, secrets & variables', link: '/reference/workflow' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/react-native-feel/react-native-deploy' }],
    editLink: {
      pattern: 'https://github.com/react-native-feel/react-native-deploy/edit/master/docs-site/:path',
      text: 'Edit this page on GitHub',
    },
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: {
      message:
        'Released under the MIT License. Builds run on your GitHub Actions minutes; signing assets stay in your repo secrets.',
      copyright:
        '<a href="https://github.com/react-native-feel/react-native-deploy">react-native-feel/react-native-deploy</a> · <a href="https://reactnativefeel.com/deploy">reactnativefeel.com/deploy</a>',
    },
  },
});
