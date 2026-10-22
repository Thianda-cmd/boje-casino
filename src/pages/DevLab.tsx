import { Suspense, lazy, useMemo, type ComponentType } from 'react'
import { useRoute } from '../lib/router'

/*
  Development labs at #/dev/<name>: pages for looking at one piece of the site on its own (every cosmetic at every
  size, a game's 3D models, a stage scrubbed to any moment), for building and for screenshots. Only the dev server
  has this route (App.tsx checks import.meta.env.DEV), so none of it ships. A lab is any file named <Name>Lab.tsx in a
  folder called dev under src; its route is its name in kebab case (src/games/kaiju/dev/ModelLab.tsx: #/dev/model).
*/

const files = import.meta.glob<{ default: ComponentType }>('../**/dev/*Lab.tsx')
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
const LABS = Object.fromEntries(Object.entries(files).map(([path, load]) => [kebab(path.split('/').pop()!.replace(/Lab\.tsx$/, '')), load]))

export default function DevLab() {
  const route = useRoute()
  const name = route.replace(/^\/dev\/?/, '').split(/[/?]/)[0]
  const Lab = useMemo(() => (LABS[name] ? lazy(LABS[name]) : null), [name])
  if (!Lab)
    return (
      <div className="p-6 text-[14px] text-muted">
        <h1 className="mb-3 text-[22px] font-black text-ink">Labs</h1>
        {Object.keys(LABS).length ? Object.keys(LABS).map((k) => <a key={k} href={`#/dev/${k}`} className="block py-1 text-sky hover:underline">{k}</a>) : 'No labs yet.'}
      </div>
    )
  return (
    <Suspense fallback={<div className="p-6 text-muted">Loading…</div>}>
      <Lab />
    </Suspense>
  )
}
