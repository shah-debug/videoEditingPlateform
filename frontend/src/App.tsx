import { useEffect, useState } from 'react'
import { Home } from './home/Home'
import { Editor } from './editor/Editor'
import { Toasts } from './components/ui'

const LAST_KEY = 'last-project'

function parseHash() {
  const m = location.hash.match(/^#\/project\/([\w-]+)/)
  return m ? m[1] : null
}

export default function App() {
  const [projectId, setProjectId] = useState<string | null>(parseHash)

  useEffect(() => {
    const h = () => setProjectId(parseHash())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])

  useEffect(() => {
    try { if (projectId) localStorage.setItem(LAST_KEY, projectId) } catch { /* ignore */ }
  }, [projectId])

  const open = (id: string) => { location.hash = `#/project/${id}` }
  const back = () => { location.hash = '#/' }

  return (
    <>
      {projectId ? <Editor key={projectId} projectId={projectId} onBack={back} /> : <Home onOpen={open} />}
      <Toasts />
    </>
  )
}
