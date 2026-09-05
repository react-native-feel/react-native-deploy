import { useState, useEffect } from 'react'

interface InstanceInfoProps {
  host: string
  port: string
  device: string
}

function formatUptime(startTime: number): string {
  const seconds = Math.floor((Date.now() - startTime) / 1000)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export default function InstanceInfo({ host, port, device }: InstanceInfoProps) {
  const [startTime] = useState(Date.now())
  const [uptime, setUptime] = useState('00:00:00')

  useEffect(() => {
    const interval = setInterval(() => setUptime(formatUptime(startTime)), 1000)
    return () => clearInterval(interval)
  }, [startTime])

  return (
    <div className="flex items-center gap-4 text-xs font-mono text-gray-500">
      <span>{host}:{port}</span>
      <span>{device}</span>
      <span>{uptime}</span>
    </div>
  )
}
