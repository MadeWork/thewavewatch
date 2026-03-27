import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import { useMemo, useState, useCallback, useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const COUNTRY_COORDS: Record<string, [number, number]> = {
  US: [-95, 38], GB: [-1, 53], DE: [10, 51], FR: [2, 47], QA: [51, 25],
  SE: [18, 62], JP: [139, 36], AU: [134, -25], BR: [-51, -10], IN: [78, 22],
  CN: [104, 35], ZA: [25, -29], NG: [8, 10], EG: [30, 27], KR: [127, 36],
  CA: [-106, 56], MX: [-102, 23], AR: [-64, -34], RU: [100, 60], IT: [12, 42],
  NZ: [174, -41], PT: [-8, 39], ES: [-4, 40], NL: [5, 52], BE: [4, 51],
  CH: [8, 47], AT: [14, 47], NO: [10, 62], DK: [10, 56], FI: [26, 64],
  IE: [-8, 53], SG: [104, 1], PL: [20, 52], CZ: [15, 50], GR: [22, 39],
};

interface Props {
  articles: Array<{ sources?: { country_code?: string } | null }>;
}

export default function WorldMap({ articles }: Props) {
  const isMobile = useIsMobile();
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([10, 30]);

  const markers = useMemo(() => {
    const counts: Record<string, number> = {};
    articles.forEach(a => {
      const cc = (a.sources as any)?.country_code;
      if (cc) counts[cc] = (counts[cc] || 0) + 1;
    });
    return Object.entries(counts)
      .filter(([cc]) => COUNTRY_COORDS[cc])
      .map(([cc, count]) => ({ cc, count, coords: COUNTRY_COORDS[cc] }));
  }, [articles]);

  const maxCount = Math.max(...markers.map(m => m.count), 1);

  const handleZoomIn = () => setZoom(z => Math.min(z * 1.5, 8));
  const handleZoomOut = () => setZoom(z => Math.max(z / 1.5, 1));
  const handleReset = () => { setZoom(1); setCenter([10, 30]); };

  return (
    <div className="monitor-card" style={{ touchAction: "pan-y" }}>
      <div className="flex items-center justify-between mb-2">
        <p className="section-label">Global Coverage</p>
        <div className="flex items-center gap-1">
          <button onClick={handleZoomIn} className="p-1 rounded-lg hover:bg-bg-subtle transition text-text-muted hover:text-foreground">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleZoomOut} className="p-1 rounded-lg hover:bg-bg-subtle transition text-text-muted hover:text-foreground">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleReset} className="p-1 rounded-lg hover:bg-bg-subtle transition text-text-muted hover:text-foreground">
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 100, center: [0, 20] }}
        style={{ width: "100%", height: 240 }}
      >
        <ZoomableGroup
          zoom={zoom}
          center={center}
          onMoveEnd={isMobile ? undefined : ({ coordinates, zoom: z }) => { setCenter(coordinates as [number, number]); setZoom(z); }}
          minZoom={1}
          maxZoom={isMobile ? 1 : 8}
          filterZoomEvent={isMobile ? () => false : undefined}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map(geo => (
                <Geography key={geo.rsmKey} geography={geo}
                  style={{
                    default: { fill: "hsl(224,18%,28%)", stroke: "hsl(224,20%,18%)", strokeWidth: 0.5 },
                    hover: { fill: "hsl(224,18%,32%)" },
                    pressed: { fill: "hsl(224,18%,28%)" },
                  }} />
              ))
            }
          </Geographies>
          {markers.map(m => (
            <Marker key={m.cc} coordinates={m.coords}>
              <circle r={4 + (m.count / maxCount) * 10} fill="hsl(216,90%,66%)" opacity={0.6} />
              <circle r={2} fill="hsl(216,90%,66%)" />
            </Marker>
          ))}
        </ZoomableGroup>
      </ComposableMap>
      {markers.length === 0 && (
        <p className="text-xs text-text-muted text-center mt-2">No geographic data yet</p>
      )}
    </div>
  );
}
