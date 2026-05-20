import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="flex-1">
        {/* Hero */}
        <section className="px-6 pt-20 pb-16 max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card px-3 py-1 text-xs text-fd-muted-foreground mb-6">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
            EAS-compatible · Runs on your own cloud Mac · iOS
          </div>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight mb-6">
            Ship React Native apps
            <br />
            on your own cloud Mac.
          </h1>
          <p className="text-lg md:text-xl text-fd-muted-foreground max-w-2xl mx-auto mb-10">
            <code className="px-1.5 py-0.5 rounded bg-fd-muted text-fd-foreground text-base">rn-deploy</code>{' '}
            reads your existing <code className="text-fd-foreground">eas.json</code> and{' '}
            <code className="text-fd-foreground">app.json</code>, then runs the build on{' '}
            <span className="text-fd-foreground font-medium">your own Mac instance in the cloud</span>{' '}
            — AWS EC2 Mac, MacinCloud, or any Mac you can SSH into — and ships to TestFlight. No third-party
            build service ever touches your code.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              to="/docs"
              className="px-5 py-2.5 rounded-lg bg-fd-primary text-fd-primary-foreground font-medium text-sm shadow-sm hover:opacity-90 transition"
            >
              Read the docs →
            </Link>
            <Link
              to="/docs/$"
              params={{ _splat: 'getting-started' }}
              className="px-5 py-2.5 rounded-lg border border-fd-border bg-fd-card text-fd-foreground font-medium text-sm hover:bg-fd-muted transition"
            >
              Get started in 5 minutes
            </Link>
          </div>
        </section>

        {/* How it flows */}
        <section className="px-6 pb-12 max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <FlowStep n="1" label="Your laptop" detail="reads eas.json + app.json" />
            <FlowStep n="2" label="Your cloud Mac" detail="builds with xcodebuild + signs" arrow />
            <FlowStep n="3" label="App Store Connect" detail="TestFlight + App Store" arrow />
          </div>
        </section>

        {/* Code preview */}
        <section className="px-6 pb-16 max-w-3xl mx-auto">
          <div className="rounded-xl border border-fd-border bg-fd-card overflow-hidden shadow-sm">
            <div className="px-4 py-2 border-b border-fd-border bg-fd-muted/50 text-xs text-fd-muted-foreground font-mono">
              ~/expo-project (on your laptop)
            </div>
            <pre className="p-5 text-sm overflow-x-auto">
              <code>
                <span className="text-fd-muted-foreground"># one-time</span>{'\n'}
                <span className="text-blue-500">brew install</span> asc{'\n'}
                <span className="text-blue-500">npm i -g</span> rn-deploy{'\n'}
                rn-deploy <span className="text-purple-500">credentials configure</span>{'\n'}
                {'\n'}
                <span className="text-fd-muted-foreground"># every release</span>{'\n'}
                rn-deploy <span className="text-purple-500">build</span> --profile production --auto-submit
              </code>
            </pre>
          </div>
        </section>

        {/* Feature grid */}
        <section className="px-6 py-16 max-w-6xl mx-auto">
          <h2 className="text-center text-sm font-medium text-fd-muted-foreground uppercase tracking-wider mb-10">
            What you get
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Feature
              title="Zero config for Expo projects"
              body="Reads your existing eas.json (build + submit profiles) and app.json (bundle ID, scheme). Drop in and go."
            />
            <Feature
              title="Your Mac, in the cloud"
              body="Provisions an AWS EC2 Mac on demand, or connects to your MacinCloud instance, a colo box, or your own desk Mac. The hardware is yours; rn-deploy just orchestrates the build over SSH."
            />
            <Feature
              title="Real signing, automated"
              body="asc signing fetch + dedicated build keychain. No Apple ID password, no fastlane match repo gymnastics — unless you want them."
            />
            <Feature
              title="Survives flaky networks"
              body="Builds run inside tmux on the remote. Drop your connection mid-build and rn-deploy build --resume picks up where you left off."
            />
            <Feature
              title="TestFlight in one command"
              body="--auto-submit chains build + upload + group assignment. Or run submit standalone for an existing .ipa."
            />
            <Feature
              title="Secrets stay yours"
              body="ASC API key in macOS keychain (via asc). .p8 uploaded just-in-time to your cloud Mac, deleted when the build ends. Source code lives on your own instance — never on someone else's build server."
            />
          </div>
        </section>

        {/* EAS comparison */}
        <section className="px-6 py-16 max-w-4xl mx-auto">
          <div className="rounded-xl border border-fd-border bg-fd-card p-8">
            <h2 className="text-2xl font-semibold mb-4">Coming from EAS?</h2>
            <p className="text-fd-muted-foreground mb-6">
              Your <code className="text-fd-foreground">eas.json</code> stays the same. The CLI commands map 1-to-1:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="rounded-lg border border-fd-border bg-fd-background p-4">
                <div className="text-xs text-fd-muted-foreground mb-2 uppercase tracking-wide">Before</div>
                <pre className="text-sm">
                  <code>
                    eas build --platform ios{'\n'}
                    eas submit --latest{'\n'}
                    eas credentials
                  </code>
                </pre>
              </div>
              <div className="rounded-lg border border-fd-border bg-fd-background p-4">
                <div className="text-xs text-fd-muted-foreground mb-2 uppercase tracking-wide">After</div>
                <pre className="text-sm">
                  <code>
                    rn-deploy build{'\n'}
                    rn-deploy submit --ipa ...{'\n'}
                    rn-deploy credentials configure
                  </code>
                </pre>
              </div>
            </div>
            <Link
              to="/docs/$"
              params={{ _splat: 'eas-compatibility' }}
              className="text-sm font-medium text-fd-primary hover:underline"
            >
              Full EAS compatibility reference →
            </Link>
          </div>
        </section>

        {/* Footer CTA */}
        <section className="px-6 py-20 text-center">
          <h2 className="text-2xl md:text-3xl font-semibold mb-4">Ready to ship?</h2>
          <p className="text-fd-muted-foreground mb-6">Five minutes from clone to TestFlight.</p>
          <Link
            to="/docs/$"
            params={{ _splat: 'getting-started' }}
            className="inline-block px-5 py-2.5 rounded-lg bg-fd-primary text-fd-primary-foreground font-medium text-sm shadow-sm hover:opacity-90 transition"
          >
            Getting started →
          </Link>
        </section>
      </main>
    </HomeLayout>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-fd-border bg-fd-card p-5 hover:bg-fd-muted/30 transition">
      <h3 className="font-medium mb-2">{title}</h3>
      <p className="text-sm text-fd-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function FlowStep({ n, label, detail, arrow }: { n: string; label: string; detail: string; arrow?: boolean }) {
  return (
    <div className="relative rounded-lg border border-fd-border bg-fd-card px-4 py-3 flex items-center gap-3">
      {arrow && (
        <span className="hidden md:block absolute -left-2.5 top-1/2 -translate-y-1/2 text-fd-muted-foreground">→</span>
      )}
      <span className="w-6 h-6 rounded-full bg-fd-primary/10 text-fd-primary text-xs font-medium flex items-center justify-center shrink-0">
        {n}
      </span>
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-fd-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}
