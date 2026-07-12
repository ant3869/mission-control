import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initializeNativeUi } from './lib/native'
import { ServerConnectionProvider } from './contexts/ServerConnectionContext'

void initializeNativeUi()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServerConnectionProvider>
      <App />
    </ServerConnectionProvider>
  </StrictMode>,
)
