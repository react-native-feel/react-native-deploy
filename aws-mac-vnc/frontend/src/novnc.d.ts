declare module '@novnc/novnc/lib/rfb' {
  interface RFBCredentials {
    username: string
    password: string
    target: string
  }

  interface RFBOptions {
    shared?: boolean
    credentials?: RFBCredentials
    repeaterID?: string
    wsProtocols?: string[]
  }

  export default class RFB {
    constructor(target: HTMLElement, url: string | WebSocket, options?: RFBOptions)
    scaleViewport: boolean
    resizeSession: boolean
    viewOnly: boolean
    disconnect(): void
    sendCredentials(credentials: RFBCredentials): void
    addEventListener(type: string, listener: (e: any) => void): void
    removeEventListener(type: string, listener: (e: any) => void): void
  }
}
