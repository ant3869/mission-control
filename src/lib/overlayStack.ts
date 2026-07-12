type OverlayEntry = {
  id: number
  onClose: () => void
}

let nextOverlayId = 1
let overlayStack: OverlayEntry[] = []

export function registerOverlay(onClose: () => void): () => void {
  const id = nextOverlayId++
  overlayStack.push({ id, onClose })

  return () => {
    overlayStack = overlayStack.filter((entry) => entry.id !== id)
  }
}

export function closeTopOverlay(): boolean {
  const entry = overlayStack.pop()
  if (!entry) return false

  entry.onClose()
  return true
}

export function resetOverlayStackForTests(): void {
  overlayStack = []
  nextOverlayId = 1
}
