# iOS Simulator Streaming via VNC — Design Spec

## Goal

Stream an iOS Simulator running on an AWS EC2 Mac instance to a web browser via an iframe, using VNC over WebSocket. This is a lightweight developer preview tool for 1-2 concurrent users.

## Non-Goals

- Loading or building apps on the simulator (out of scope for this workframe)
- Multi-tenant session management, scaling, or user auth
- Mobile/touch input forwarding (future consideration)
- Custom AMI creation (reuse rn-deploy's existing infra)

## Architecture

```
┌─────────────────────┐     ┌──────────────────────────────────────────┐
│  Browser (Vite app) │     │  EC2 Mac Instance (mac2.metal)           │
│                     │     │                                          │
│  ┌───────────────┐  │ WSS │  ┌────────────┐  VNC   ┌─────────────┐  │
│  │ noVNC viewer  │◄─┼─────┼─►│ websockify │◄──────►│ macOS VNC   │  │
│  │ (iframe)      │  │     │  │ (port 6080)│  :5900 │ (Screen     │  │
│  └───────────────┘  │     │  └────────────┘        │  Sharing)   │  │
│                     │     │                        └─────────────┘  │
│  ┌───────────────┐  │     │  ┌─────────────────┐                    │
│  │ Connection    │  │     │  │ iOS Simulator   │                    │
│  │ status + info │  │     │  │ (fullscreen)    │                    │
│  └───────────────┘  │     │  └─────────────────┘                    │
└─────────────────────┘     └──────────────────────────────────────────┘
```

## Components

### 1. Instance Provisioning (Node.js CLI)

This project (`aws-mac-vnc/`) is a standalone package within the `react-native-deploy` monorepo. It copies the infra patterns from the sibling `rn-deploy` project but owns its own code — no cross-package imports. The infra modules (`src/infra/*`) handle:
- Dedicated Host allocation
- EC2 Mac instance launch
- Security group management (opens ports 22, 6080)
- SSH key pair management
- State tracking (`.rn-deploy-state.json`)

New: a `stream` command that orchestrates the VNC setup after instance is running.

### 2. Remote Setup Script (runs via SSH on EC2 Mac)

Executed on the instance after boot. Does the following in order:

1. **Enable macOS Screen Sharing (VNC)**
   ```bash
   sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart \
     -activate -configure -access -on -privs -all \
     -restart -agent -menu
   sudo defaults write /var/db/launchd.db/com.apple.launchd/overrides.plist \
     com.apple.screensharing -dict Disabled -bool false
   sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.screensharing.plist
   ```
   Set a VNC password via:
   ```bash
   echo <password> | sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart \
     -configure -clientopts -setvnclegacy -vnclegacy yes -setvncpw -vncpw <password>
   ```

2. **Install and start websockify as a persistent daemon**
   ```bash
   pip3 install websockify
   # Create launchd plist for persistence (survives SSH disconnect)
   cat > ~/Library/LaunchAgents/com.websockify.plist << 'PLIST'
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>Label</key><string>com.websockify</string>
     <key>ProgramArguments</key><array>
       <string>/usr/local/bin/websockify</string>
       <string>6080</string>
       <string>localhost:5900</string>
     </array>
     <key>RunAtLoad</key><true/>
     <key>KeepAlive</key><true/>
   </dict></plist>
   PLIST
   launchctl load ~/Library/LaunchAgents/com.websockify.plist
   ```
   Uses Python `websockify` (battle-tested, macOS ships Python3) via `launchd` so it persists after SSH disconnect.

3. **Boot iOS Simulator fullscreen**
   ```bash
   xcrun simctl boot "iPhone 16 Pro"
   open -a Simulator
   # Fullscreen via AppleScript
   osascript -e 'tell application "Simulator" to activate' \
     -e 'delay 2' \
     -e 'tell application "System Events" to keystroke "f" using {command down, control down}'
   ```

4. **Hide dock and menu bar**
   ```bash
   defaults write com.apple.dock autohide -bool true
   defaults write com.apple.dock autohide-delay -float 999
   killall Dock
   defaults write NSGlobalDomain _HIHideMenuBar -bool true
   ```

5. **Readiness check** — poll until websockify is listening before reporting ready:
   ```bash
   for i in $(seq 1 30); do nc -z localhost 6080 && break || sleep 1; done
   ```

### 3. Frontend (Vite + React + TypeScript)

Located in `frontend/` directory.

**Stack:**
- Vite + React + TypeScript
- Tailwind CSS
- `@novnc/novnc` (official npm package, v1.6.0+) — the `RFB` class is imported from `@novnc/novnc/lib/rfb`

**Pages/Components:**
- `App.tsx` — Main layout, connection state management
- `VncViewer.tsx` — Wraps noVNC's `RFB` class, connects to websockify endpoint, renders to a canvas
- `ConnectionStatus.tsx` — Shows connected/connecting/disconnected state
- `InstanceInfo.tsx` — Displays instance IP, simulator device, uptime

**Connection flow:**
1. User runs CLI command `rn-deploy stream` which provisions instance + outputs the websockify URL
2. CLI writes a `.env.local` file in `frontend/` with `VITE_VNC_HOST=<public-ip>` and `VITE_VNC_PORT=6080`
3. User opens the Vite dev server at `http://localhost:5173` (or passes `?host=<ip>` as query param override)
4. noVNC connects via WebSocket to `ws://<instance-ip>:6080`
5. VNC password is auto-generated during provisioning (random 8-char alphanumeric), stored in `.rn-deploy-state.json`, and written to `.env.local` as `VITE_VNC_PASSWORD`

### 4. Security (Minimal for Dev Use)

- Security group restricts ports 22 and 6080 to the developer's current IP
- VNC password set during provisioning
- No public-facing proxy needed — direct WebSocket connection for dev use
- websockify runs plain `ws://` (not `wss://`) — acceptable for dev tool over restricted IP

## CLI Interface

New command added to rn-deploy:

```
rn-deploy stream [options]

Options:
  --device <name>    Simulator device (default: "iPhone 16 Pro")
  --runtime <ver>    iOS runtime version (default: latest available)
  --port <number>    websockify port (default: 6080)
  --no-teardown      Keep instance alive after disconnect
```

**Flow:**
1. Check for existing running instance (reuse if available)
2. If no instance: allocate host → launch instance → wait for ready
3. SSH in and run remote setup (VNC + websockify + simulator)
4. Update security group with current IP for port 6080
5. Print connection URL: `ws://<public-ip>:6080`
6. Print frontend URL: `http://localhost:5173` (Vite dev server)

## File Structure

```
aws-mac-vnc/
├── src/
│   ├── commands/
│   │   └── stream.js          # New stream command
│   ├── remote/
│   │   └── vnc-setup.js       # VNC + websockify + simulator setup
│   └── ... (existing infra/remote/utils modules)
├── frontend/
│   ├── index.html
│   ├── package.json           # vite, react, @novnc/novnc, tailwindcss
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── VncViewer.tsx
│   │   │   ├── ConnectionStatus.tsx
│   │   │   └── InstanceInfo.tsx
│   │   └── styles/
│   │       └── index.css      # Tailwind imports
│   └── public/
└── docs/
```

## Error Handling

- **Instance fails to start:** CLI retries with existing rn-deploy retry logic, then exits with clear error
- **VNC fails to enable:** SSH exec checks exit codes, reports specific failure reason
- **Simulator fails to boot:** Falls back to listing available devices/runtimes
- **WebSocket connection drops:** noVNC has built-in reconnect; frontend shows reconnecting state
- **Port 6080 unreachable:** Frontend shows timeout error with hint to check security group

## Testing Strategy

- **Unit tests:** vnc-setup.js command generation (assert correct SSH commands produced)
- **Integration test:** Mock SSH to verify full stream command flow
- **Manual test:** Spin up real EC2 Mac, connect from browser, verify simulator displays
