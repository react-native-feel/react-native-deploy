type Status = 'disconnected' | 'connecting' | 'connected'

const statusConfig: Record<Status, { label: string; color: string; dot: string }> = {
  disconnected: { label: 'Disconnected', color: 'text-red-400', dot: 'bg-red-400' },
  connecting: { label: 'Connecting...', color: 'text-yellow-400', dot: 'bg-yellow-400 animate-pulse' },
  connected: { label: 'Connected', color: 'text-green-400', dot: 'bg-green-400' },
}

export default function ConnectionStatus({ status }: { status: Status }) {
  const { label, color, dot } = statusConfig[status]

  return (
    <div className={`flex items-center gap-2 ${color}`}>
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span className="text-sm font-mono">{label}</span>
    </div>
  )
}
