import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { StatusBar, Style } from '@capacitor/status-bar'

type ListenerPromise = Promise<PluginListenerHandle>

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

export async function initializeNativeUi(): Promise<void> {
  if (!isNativeApp()) return

  await StatusBar.setStyle({ style: Style.Dark })
}

export async function openExternal(url: string): Promise<void> {
  if (isNativeApp()) {
    await Browser.open({ url })
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

export function onAppResume(callback: () => void): () => void {
  if (!isNativeApp()) return () => {}

  return cleanupWhenReady(CapacitorApp.addListener('resume', callback))
}

export function onAndroidBack(callback: () => void): () => void {
  if (Capacitor.getPlatform() !== 'android') return () => {}

  return cleanupWhenReady(CapacitorApp.addListener('backButton', callback))
}

export async function exitAndroidApp(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return

  await CapacitorApp.exitApp()
}

function cleanupWhenReady(listener: ListenerPromise): () => void {
  let remove: (() => Promise<void>) | undefined
  let shouldRemove = false
  let removed = false

  void listener.then((handle) => {
    remove = handle.remove
    if (shouldRemove) removeOnce()
  })

  return () => {
    shouldRemove = true
    removeOnce()
  }

  function removeOnce(): void {
    if (!remove || removed) return

    removed = true
    void remove()
  }
}
