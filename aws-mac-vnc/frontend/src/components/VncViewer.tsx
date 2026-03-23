import { useEffect, useRef, useCallback } from 'react'
import RFB from '@novnc/novnc/lib/rfb'

interface VncViewerProps {
  url: string
  password?: string
  onConnect?: () => void
  onDisconnect?: (clean: boolean) => void
}

export default function VncViewer({ url, password, onConnect, onDisconnect }: VncViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)

  const connect = useCallback(() => {
    if (!containerRef.current || rfbRef.current) return

    const rfb = new RFB(containerRef.current, url, {
      credentials: password ? { username: '', password, target: '' } : undefined,
    })

    rfb.scaleViewport = true
    rfb.resizeSession = true

    rfb.addEventListener('connect', () => onConnect?.())

    rfb.addEventListener('disconnect', (e: CustomEvent) => {
      rfbRef.current = null
      onDisconnect?.(e.detail.clean)
    })

    rfb.addEventListener('credentialsrequired', () => {
      if (password) {
        rfb.sendCredentials({ username: '', password, target: '' })
      }
    })

    rfbRef.current = rfb
  }, [url, password, onConnect, onDisconnect])

  useEffect(() => {
    connect()
    return () => {
      rfbRef.current?.disconnect()
      rfbRef.current = null
    }
  }, [connect])

  return <div ref={containerRef} className="w-full h-full" />
}
