import React from 'react'
import ReactDOM from 'react-dom/client'

// Self-hosted typefaces, bundled into dist/ by Vite. Previously fetched from
// Google Fonts at runtime, which contradicted the local-first promise and left
// the packaged desktop app falling back to a generic system sans whenever it
// had no network. All three are OFL-1.1, so bundling is permitted.
//
// `wght` covers every weight in one variable file per subset, and each subset
// carries a unicode-range so a browser only downloads the scripts it renders.
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/outfit/wght.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'

import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
)
