import { defineConfig } from 'vitepress';

// Served by the same Worker as the dashboard, under /deploy/docs/ — so every
// asset and link is prefixed, exactly like the dashboard's /deploy/dashboard/.
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
      // The dashboard is a separate app on the same origin, not a docs page.
      { text: 'Dashboard', link: '/../dashboard/', target: '_self' },
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
        text: 'Reference',
        items: [
          { text: 'Commands', link: '/reference/commands' },
          { text: 'Workflow, secrets & variables', link: '/reference/workflow' },
        ],
      },
    ],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: {
      message: 'Builds run on your GitHub Actions minutes; signing assets stay in your repo secrets.',
    },
  },
});
