import { useState, useCallback } from 'react'
import VncViewer from './components/VncViewer'
import ConnectionStatus from './components/ConnectionStatus'
import InstanceInfo from './components/InstanceInfo'

type Status = 'disconnected' | 'connecting' | 'connected'

function getConfig() {
  const params = new URLSearchParams(window.location.search)
  return {
    host: params.get('host') || import.meta.env.VITE_VNC_HOST || '',
    port: params.get('port') || import.meta.env.VITE_VNC_PORT || '6080',
    password: params.get('password') || import.meta.env.VITE_VNC_PASSWORD || '',
    device: params.get('device') || import.meta.env.VITE_VNC_DEVICE || 'iPhone 16 Pro',
  }
}

export default function App() {
  const config = getConfig()
  const [status, setStatus] = useState<Status>(config.host ? 'connecting' : 'disconnected')
  const [host, setHost] = useState(config.host)
  const [port, setPort] = useState(config.port)
  const [password, setPassword] = useState(config.password)
  const [reconnectKey, setReconnectKey] = useState(0)

  const wsUrl = host ? `ws://${host}:${port}` : ''

  const handleConnect = useCallback(() => setStatus('connected'), [])
  const handleDisconnect = useCallback((clean: boolean) => {
    setStatus('disconnected')
    // Auto-reconnect on unclean disconnect after 3s
    if (!clean) {
      setTimeout(() => {
        setStatus('connecting')
        setReconnectKey((k) => k + 1)
      }, 3000)
    }
  }, [])

  // If no host configured or disconnected, show connect form
  if (!wsUrl || status === 'disconnected') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="bg-gray-900 p-6 rounded-lg border border-gray-800 w-80">
          <h1 className="text-white text-lg font-bold mb-4">iOS Simulator</h1>
          <label className="block text-gray-400 text-sm mb-1">Host</label>
          <input
            className="w-full bg-gray-800 text-white px-3 py-2 rounded mb-3 border border-gray-700 focus:border-blue-500 outline-none"
            placeholder="54.123.45.67"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
          <label className="block text-gray-400 text-sm mb-1">Port</label>
          <input
            className="w-full bg-gray-800 text-white px-3 py-2 rounded mb-3 border border-gray-700 focus:border-blue-500 outline-none"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
          <label className="block text-gray-400 text-sm mb-1">VNC Password</label>
          <input
            className="w-full bg-gray-800 text-white px-3 py-2 rounded mb-3 border border-gray-700 focus:border-blue-500 outline-none"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-500 transition-colors disabled:opacity-50"
            disabled={!host}
            onClick={() => {
              setStatus('connecting')
              setReconnectKey((k) => k + 1)
            }}
          >
            Connect
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-950 flex flex-col">
      <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <h1 className="text-white text-sm font-bold">iOS Simulator</h1>
        <div className="flex items-center gap-4">
          <InstanceInfo host={host} port={port} device={config.device} />
          <ConnectionStatus status={status} />
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <VncViewer
          key={reconnectKey}
          url={wsUrl}
          password={password}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />
      </main>
    </div>
  )
}
