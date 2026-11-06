import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * The browser window a component is rendered in. Components inside a pop-out window must use this instead
 * of the global `window` for confirm(), clipboard and key listeners, or those would act on the main window.
 */
export const OwnerWindow = createContext<Window>(window)
export const useOwnerWindow = () => useContext(OwnerWindow)

const openWindows = new Map<string, Window>()
// closing is deferred one tick so an immediate re-mount (React StrictMode in development) reuses the window
const pendingClose = new Map<string, number>()

export interface PopoutPlacement { left?: number; top?: number; width?: number; height?: number }

/**
 * Renders `children` into a separate browser window (same app, same state: edits show up instantly in both).
 * The user can drag that window to a second screen and maximise it. Closing it calls `onClose`.
 *
 * Must be mounted from a user gesture (click / drag) or the browser blocks the popup; `onBlocked` is then called.
 */
export function PopoutWindow({ name, title, placement, onClose, onBlocked, onKeyDown, children }: {
  name: string
  title: string
  placement?: PopoutPlacement
  onClose: () => void
  onBlocked?: () => void
  onKeyDown?: (e: KeyboardEvent) => void
  children: ReactNode
}) {
  const [target, setTarget] = useState<{ win: Window; root: HTMLElement } | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const keyRef = useRef(onKeyDown)
  keyRef.current = onKeyDown

  useLayoutEffect(() => {
    const w = Math.round(placement?.width ?? Math.min(900, window.screen.availWidth * 0.6))
    const h = Math.round(placement?.height ?? Math.min(window.screen.availHeight * 0.85, 1000))
    const left = Math.round(placement?.left ?? window.screenX + 40)
    const top = Math.round(placement?.top ?? window.screenY + 40)
    const reuse = openWindows.get(name)
    if (pendingClose.has(name)) { window.clearTimeout(pendingClose.get(name)); pendingClose.delete(name) }
    const win = reuse && !reuse.closed ? reuse : window.open('', name, `popup=yes,width=${w},height=${h},left=${left},top=${top}`)
    if (!win) { onBlocked?.(); closeRef.current(); return }

    const doc = win.document
    doc.title = title
    // same look as the main window: copy every stylesheet (Tailwind build, Google fonts) and the root attributes
    doc.head.innerHTML = ''
    const meta = doc.createElement('meta')
    meta.setAttribute('charset', 'utf-8')
    doc.head.appendChild(meta)
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((n) => {
      const c = n.cloneNode(true) as HTMLElement
      if (n instanceof HTMLLinkElement) (c as HTMLLinkElement).href = n.href // absolute URL
      doc.head.appendChild(c)
    })
    doc.documentElement.className = document.documentElement.className
    doc.documentElement.lang = document.documentElement.lang
    doc.body.className = document.body.className
    doc.body.style.cssText = 'margin:0;height:100vh;overflow:hidden;'
    const root = doc.createElement('div')
    root.id = 'popout-root'
    root.style.height = '100%'
    doc.body.innerHTML = ''
    doc.body.appendChild(root)
    win.focus()

    openWindows.set(name, win)
    let done = false
    const closed = () => { if (!done && win.closed) { done = true; openWindows.delete(name); closeRef.current() } }
    win.addEventListener('pagehide', closed)
    // not every browser fires pagehide when the user closes a popup: also watch for it
    const poll = window.setInterval(() => { if (win.closed) closed() }, 400)
    const keys = (e: KeyboardEvent) => keyRef.current?.(e)
    win.addEventListener('keydown', keys)
    // closing / reloading the main page takes the pop-out with it
    const mainUnload = () => win.close()
    window.addEventListener('pagehide', mainUnload)
    setTarget({ win, root })
    return () => {
      done = true
      window.clearInterval(poll)
      win.removeEventListener('pagehide', closed)
      win.removeEventListener('keydown', keys)
      window.removeEventListener('pagehide', mainUnload)
      pendingClose.set(name, window.setTimeout(() => { pendingClose.delete(name); openWindows.delete(name); if (!win.closed) win.close() }, 0))
    }
    // the window is opened once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (target) target.win.document.title = title }, [target, title])

  if (!target) return null
  return createPortal(<OwnerWindow.Provider value={target.win}>{children}</OwnerWindow.Provider>, target.root)
}

/** Bring an open pop-out window to the front (no-op if it is closed). */
export function focusPopout(name: string) {
  const w = openWindows.get(name)
  if (w && !w.closed) w.focus()
}
