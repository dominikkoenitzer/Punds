import Sando, { StillPage } from './pages/Sando'
import SceneBoundary from './pages/SceneBoundary'

export default function App() {
  return (
    <SceneBoundary fallback={<StillPage />}>
      <Sando />
    </SceneBoundary>
  )
}
