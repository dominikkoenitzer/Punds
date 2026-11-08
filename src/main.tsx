// first: the diagnostics keep errors and page timings from the start, and `?test` seeds the random numbers before
// anything draws one
import './diagBoot'
import './realm/testMode'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './App.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
