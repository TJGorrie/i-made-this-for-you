// Map entity: an uploaded image you can pan/zoom, with draggable pins linked to entities.
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { uploadImage, type Pin } from './api.ts'
import type { LinkTarget } from './wikiLink.ts'

type Props = {
  assetsUrl: string; image: string; pins: unknown; targets: LinkTarget[]
  onImage: (name: string) => void; onPins: (pins: Pin[]) => void; onOpen: (id: string) => void
}

export function MapView({ assetsUrl, image, pins: rawPins, targets, onImage, onPins, onOpen }: Props) {
  const pins = Array.isArray(rawPins) ? (rawPins as Pin[]) : []
  const el = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<L.Map>()
  const [size, setSize] = useState<{ w: number; h: number }>()
  const [placing, setPlacing] = useState('')
  const [error, setError] = useState('')
  const src = image && `${assetsUrl}/${image}`

  // Leaflet's Simple CRS is y-up from the bottom; files store pixels from the top-left, so flip y.
  const toLatLng = (p: Pin): L.LatLngTuple => [size!.h - p.y, p.x]

  useEffect(() => {
    setSize(undefined)
    if (!src) return
    const img = new Image()
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => setError(`Couldn't load ${image}`)
    img.src = src
  }, [src])

  useEffect(() => {
    if (!size || !el.current) return
    const bounds: L.LatLngBoundsExpression = [[0, 0], [size.h, size.w]]
    const m = L.map(el.current, { crs: L.CRS.Simple, minZoom: -5, attributionControl: false })
    L.imageOverlay(src, bounds).addTo(m)
    m.fitBounds(bounds)
    setMap(m)
    return () => { m.remove(); setMap(undefined) }
  }, [size])

  // Redraw pins whenever they change; handlers close over the current list.
  useEffect(() => {
    if (!map) return
    const layer = L.layerGroup().addTo(map)
    pins.forEach((p, i) => {
      const label = document.createElement('span')
      label.textContent = targets.find((t) => t.id === p.entity)?.title ?? '(missing)'
      L.marker(toLatLng(p), {
        draggable: true,
        title: 'Click to open · drag to move · right-click to remove',
        icon: L.divIcon({ className: 'pin', html: label, iconSize: undefined }),
      })
        .on('click', () => onOpen(p.entity))
        .on('dragend', (e) => {
          const ll = (e.target as L.Marker).getLatLng()
          onPins(pins.map((q, j) => (j === i ? { ...q, x: Math.round(ll.lng), y: Math.round(size!.h - ll.lat) } : q)))
        })
        .on('contextmenu', () => confirm(`Remove pin "${label.textContent}"?`) && onPins(pins.filter((_, j) => j !== i)))
        .addTo(layer)
    })
    return () => { layer.remove() }
  }, [map, JSON.stringify(pins), targets])

  // Placing mode: next click on the map drops a pin for the chosen entity.
  useEffect(() => {
    if (!map || !placing) return
    const onClick = (e: L.LeafletMouseEvent) => {
      onPins([...pins, { entity: placing, x: Math.round(e.latlng.lng), y: Math.round(size!.h - e.latlng.lat) }])
      setPlacing('')
    }
    map.once('click', onClick)
    return () => { map.off('click', onClick) }
  }, [map, placing])

  async function upload(file: File) {
    setError('')
    await uploadImage(assetsUrl, file).then(onImage, (e) => setError(e.message))
  }

  return (
    <section className="map-view">
      <div className="map-tools">
        <label className="mini upload">
          {image ? 'Replace image' : 'Upload map image'}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        {size && (
          <>
            <select aria-label="Pin entity" value={placing} onChange={(e) => setPlacing(e.target.value)}>
              <option value="">Add pin for…</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            {placing && <small>Click on the map to place it.</small>}
          </>
        )}
        {error && <small className="error">{error}</small>}
      </div>
      {src && <div ref={el} className={placing ? 'map placing' : 'map'} />}
    </section>
  )
}
