import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useTranslation } from 'react-i18next';
import { MapPin, Navigation, Layers } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useMemos } from '../hooks/data';

// Fix for default marker icon in Leaflet
// @ts-ignore
import markerIcon from 'leaflet/dist/images/marker-icon.png';
// @ts-ignore
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// Distinctive marker for the currently selected note: an amber pin with a
// pulsing halo, so it stands out even when several notes sit almost on top
// of each other.
const SelectedIcon = L.divIcon({
  className: 'selected-map-marker',
  html:
    '<div class="halo"></div>' +
    '<svg class="pin" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>' +
    '</svg>',
  iconSize: [34, 34],
  iconAnchor: [17, 34],
  popupAnchor: [0, -32],
});

// "You are here" marker: a blue dot with a white ring and a faint pulsing
// halo, visually distinct from the note pins and the amber selected-note pin.
// Styles are inline so this stays self-contained (index.css is off-limits).
const MyLocationIcon = L.divIcon({
  className: '',
  html:
    '<div style="position:relative;width:16px;height:16px;">' +
    '<span style="position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:9999px;background:rgba(37,99,235,0.35);animation:noteshare-my-loc-pulse 2s ease-out infinite;"></span>' +
    '<span style="position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></span>' +
    '<style>@keyframes noteshare-my-loc-pulse{0%{transform:scale(1);opacity:0.7}70%{transform:scale(2.6);opacity:0}100%{transform:scale(2.6);opacity:0}}</style>' +
    '</div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -10],
});

const FOCUS_ZOOM = 17;

type BaseLayer = 'street' | 'satellite' | 'terrain';

const MAP_MAX_ZOOM = 19;

const LAYERS: Record<
  BaseLayer,
  {
    url: string;
    attribution: string;
    // Deepest zoom the source actually has tiles for; Leaflet upscales past it.
    maxNativeZoom: number;
    labels?: string;
    labelsMaxNativeZoom?: number;
  }
> = {
  street: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxNativeZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    // Esri's high-res imagery only reaches ~z17 outside major cities; past
    // that it serves grey "Map data not yet available" placeholders. Cap here
    // and let Leaflet upscale z17 for the last couple of levels.
    maxNativeZoom: 17,
    // Street labels + roads overlay (Carto) so satellite stays readable when
    // zoomed in. Esri's own reference layer stops at z13 and paints grey
    // "Map data not yet available" tiles over the imagery past that.
    labels:
      'https://{s}.basemaps.cartocdn.com/rastertiles/light_only_labels/{z}/{x}/{y}{r}.png',
    labelsMaxNativeZoom: 20,
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxNativeZoom: 17,
  },
};

type Focus = { center: [number, number]; zoom: number };

/**
 * Owns every imperative view change:
 *  - once the geotagged points are known, frame them (fitBounds for many,
 *    a close zoom for one) instead of leaving the map on the country-wide
 *    initial view;
 *  - after that, obey explicit focus requests (sidebar click, "my location").
 */
function MapController({
  points,
  focus,
}: {
  points: [number, number][];
  focus: Focus | null;
}) {
  const map = useMap();
  const framedRef = useRef(false);

  useEffect(() => {
    if (framedRef.current || points.length === 0) return;
    framedRef.current = true;
    if (points.length === 1) {
      map.setView(points[0], 14);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 15 });
    }
  }, [points, map]);

  useEffect(() => {
    if (focus) map.setView(focus.center, focus.zoom);
  }, [focus, map]);

  return null;
}

/** Leaflet needs a resize kick when its container mounts mid-animation. */
function InvalidateOnMount() {
  const map = useMap();
  useEffect(() => {
    const kick = () => map.invalidateSize();
    const timers = [50, 250, 600].map((ms) => window.setTimeout(kick, ms));
    window.addEventListener('resize', kick);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', kick);
    };
  }, [map]);
  return null;
}

export default function MapView() {
  const { t } = useTranslation();
  const { memos, loading } = useMemos();
  const [focus, setFocus] = useState<Focus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [myLocation, setMyLocation] = useState<[number, number] | null>(null);
  const markerRefs = useRef<Record<string, L.Marker>>({});
  const [layer, setLayer] = useState<BaseLayer>(() => {
    try {
      return (localStorage.getItem('noteshare:maplayer') as BaseLayer) || 'street';
    } catch {
      return 'street';
    }
  });

  const memosWithLocation = memos.filter((m) => m.location && m.location.lat && m.location.lng);
  const points: [number, number][] = memosWithLocation.map((m) => [
    m.location!.lat,
    m.location!.lng,
  ]);

  // No geotagged notes to frame → drop the user near their own position.
  useEffect(() => {
    if (memosWithLocation.length > 0 || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setFocus({ center: [pos.coords.latitude, pos.coords.longitude], zoom: 13 });
      setMyLocation([pos.coords.latitude, pos.coords.longitude]);
    });
  }, [memosWithLocation.length]);

  // Select a note: mark it (distinctive marker + list highlight), fly to it,
  // and pop its details open.
  const selectMemo = (memo: (typeof memosWithLocation)[number]) => {
    setSelectedId(memo.id);
    setFocus({ center: [memo.location!.lat, memo.location!.lng], zoom: FOCUS_ZOOM });
  };

  // Open the popup of whichever marker is selected (also when it re-selects
  // after a data refresh remounts the markers).
  useEffect(() => {
    if (selectedId && markerRefs.current[selectedId]) {
      markerRefs.current[selectedId].openPopup();
    }
  }, [selectedId, memosWithLocation.length]);

  const setLayerPersist = (l: BaseLayer) => {
    setLayer(l);
    try {
      localStorage.setItem('noteshare:maplayer', l);
    } catch {
      /* ignore */
    }
  };

  if (loading) return <div className="text-center py-20 text-stone-400">{t('loading_map')}</div>;

  const cfg = LAYERS[layer];

  return (
    // `isolate` traps Leaflet's z-index:1000 controls in this element's own
    // stacking context so they can't paint over the mobile nav drawer (z-90).
    <div className="isolate h-full relative rounded-3xl overflow-hidden border border-stone-200 dark:border-stone-800 shadow-inner">
      <MapContainer
        center={[-25.28, -57.63]}
        zoom={5}
        maxZoom={MAP_MAX_ZOOM}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          key={layer}
          url={cfg.url}
          attribution={cfg.attribution}
          maxZoom={MAP_MAX_ZOOM}
          maxNativeZoom={cfg.maxNativeZoom}
        />
        {cfg.labels && (
          <TileLayer
            key={`${layer}-labels`}
            url={cfg.labels}
            attribution=""
            maxZoom={MAP_MAX_ZOOM}
            maxNativeZoom={cfg.labelsMaxNativeZoom ?? cfg.maxNativeZoom}
          />
        )}
        <MapController points={points} focus={focus} />
        <InvalidateOnMount />
        {memosWithLocation.map((memo) => (
          <Marker
            key={memo.id}
            position={[memo.location!.lat, memo.location!.lng]}
            icon={selectedId === memo.id ? SelectedIcon : DefaultIcon}
            zIndexOffset={selectedId === memo.id ? 1000 : 0}
            ref={(ref) => {
              if (ref) markerRefs.current[memo.id] = ref;
              else delete markerRefs.current[memo.id];
            }}
            eventHandlers={{ click: () => setSelectedId(memo.id) }}
          >
            <Popup>
              <div className="p-2 min-w-[200px]">
                <h4 className="font-bold text-emerald-700 mb-1">{memo.title}</h4>
                <p className="text-xs text-stone-500 line-clamp-2 mb-2">{memo.content}</p>
                <div className="flex items-center gap-1 text-[10px] text-stone-400 font-bold uppercase">
                  <MapPin className="w-3 h-3" /> {memo.location!.name}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
        {myLocation && (
          <Marker position={myLocation} icon={MyLocationIcon} zIndexOffset={2000}>
            <Popup>{t('you_are_here') || 'Estás acá'}</Popup>
          </Marker>
        )}
      </MapContainer>

      {/* Layer switcher — bottom-left on mobile so it clears the memo list;
          top-right on desktop. */}
      <div className="absolute bottom-6 left-4 md:bottom-auto md:left-auto md:top-6 md:right-6 z-[1000] flex bg-white dark:bg-stone-800 rounded-xl shadow-lg overflow-hidden text-[11px] sm:text-xs font-medium">
        {(
          [
            ['street', t('map_street') || 'Calle'],
            ['satellite', t('map_satellite') || 'Satélite'],
            ['terrain', t('map_terrain') || 'Terreno'],
          ] as [BaseLayer, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setLayerPersist(id)}
            className={
              'px-2.5 sm:px-3 py-2 transition-colors ' +
              (layer === id
                ? 'bg-emerald-600 text-white'
                : 'text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700')
            }
          >
            {id === 'street' && <Layers className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />}
            {label}
          </button>
        ))}
      </div>

      <div className="absolute bottom-6 right-6 z-[1000] flex flex-col gap-2">
        <button
          onClick={() => {
            if (navigator.geolocation) {
              setSelectedId(null);
              navigator.geolocation.getCurrentPosition((pos) => {
                setFocus({
                  center: [pos.coords.latitude, pos.coords.longitude],
                  zoom: FOCUS_ZOOM,
                });
                setMyLocation([pos.coords.latitude, pos.coords.longitude]);
              });
            }
          }}
          className="p-3 bg-white dark:bg-stone-800 rounded-full shadow-lg hover:bg-stone-50 dark:hover:bg-stone-700 transition-all text-emerald-600 dark:text-emerald-400"
        >
          <Navigation className="w-6 h-6" />
        </button>
      </div>

      <div className="absolute top-6 left-6 z-[1000] glass p-4 rounded-2xl max-w-xs">
        <h3 className="font-bold text-sm mb-2 flex items-center gap-2 dark:text-white">
          <MapPin className="w-4 h-4 text-emerald-600" />
          {t('geotagged_memos')}
        </h3>
        <div className="space-y-2 max-h-40 overflow-auto pr-2">
          {memosWithLocation.map((memo) => (
            <button
              key={memo.id}
              onClick={() => selectMemo(memo)}
              className={
                'w-full text-left p-2 rounded-lg transition-all ' +
                (selectedId === memo.id
                  ? 'bg-amber-100 dark:bg-amber-500/20 ring-1 ring-amber-400 dark:ring-amber-500/40'
                  : 'hover:bg-black/5 dark:hover:bg-white/5')
              }
            >
              <p
                className={
                  'text-xs font-bold truncate ' +
                  (selectedId === memo.id
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'dark:text-stone-200')
                }
              >
                {memo.title}
              </p>
              <p className="text-[10px] text-stone-400 dark:text-stone-500 truncate">{memo.location!.name}</p>
            </button>
          ))}
          {memosWithLocation.length === 0 && (
            <p className="text-xs text-stone-400 dark:text-stone-500 italic">{t('no_tagged_memos')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
