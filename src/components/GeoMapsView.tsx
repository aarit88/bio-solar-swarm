import React, { useEffect, useState } from 'react';
import {
  AdvancedMarker,
  APIProvider,
  InfoWindow,
  Map as GoogleMap,
  Pin,
} from '@vis.gl/react-google-maps';
import { Compass, MapPin, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { SimulationSnapshot } from '../simulation/types';

interface GeoMapsViewProps {
  snapshot: SimulationSnapshot;
  onSelectNode: (nodeId: string) => void;
}

interface PodGeoCoord {
  id: string;
  label: string;
  lat: number;
  lng: number;
  kind: 'pod' | 'tower';
}

// Reference urban corridor deployment (Bengaluru MG Road corridor twin)
const CORRIDOR_CENTER = { lat: 12.9756, lng: 77.6066 };

const DEPLOYMENT_MARKERS: PodGeoCoord[] = [
  { id: 'BSS-POD-01', label: 'Pod 01 · Transit Shelter', lat: 12.97545, lng: 77.6042, kind: 'pod' },
  { id: 'BSS-POD-02', label: 'Pod 02 · Arterial Junction', lat: 12.97552, lng: 77.6054, kind: 'pod' },
  { id: 'BSS-POD-03', label: 'Pod 03 · Crosswalk Hub', lat: 12.9756, lng: 77.6066, kind: 'pod' },
  { id: 'BSS-POD-04', label: 'Pod 04 · Market Frontage', lat: 12.97568, lng: 77.6078, kind: 'pod' },
  { id: 'BSS-POD-05', label: 'Pod 05 · Works Boundary', lat: 12.97575, lng: 77.609, kind: 'pod' },
  { id: 'CENTRAL-TOWER', label: 'Centralized Purification Tower', lat: 12.9768, lng: 77.6072, kind: 'tower' },
];

interface AirQualityApiResponse {
  indexes?: Array<{ code: string; displayName: string; aqi: number; category: string; dominantPollutant?: string }>;
  pollutants?: Array<{ code: string; displayName: string; concentration?: { value: number; units: string } }>;
  healthRecommendations?: { generalPopulation?: string };
}

export const GeoMapsView: React.FC<GeoMapsViewProps> = ({ snapshot, onSelectNode }) => {
  const { authFetch } = useAuth();
  const [mapsKey, setMapsKey] = useState<string>('');
  const [mapId, setMapId] = useState<string>('DEMO_MAP_ID');
  const [configLoaded, setConfigLoaded] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<PodGeoCoord | null>(DEPLOYMENT_MARKERS[2]);
  const [aqLoading, setAqLoading] = useState(false);
  const [aqError, setAqError] = useState<string | null>(null);
  const [aqData, setAqData] = useState<AirQualityApiResponse | null>(null);

  useEffect(() => {
    let active = true;
    authFetch('/api/v1/maps/config')
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setMapsKey(String(data.apiKey || ''));
        setMapId(String(data.mapId || 'DEMO_MAP_ID'));
        setConfigLoaded(true);
      })
      .catch(() => {
        if (active) setConfigLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [authFetch]);

  const fetchRealAirQuality = async () => {
    setAqLoading(true);
    setAqError(null);
    try {
      const target = selectedMarker || DEPLOYMENT_MARKERS[2];
      const resp = await authFetch('/api/v1/maps/air-quality', {
        method: 'POST',
        body: JSON.stringify({ lat: target.lat, lng: target.lng }),
      });
      const data = await resp.json();
      if (resp.status === 429 || data.quotaExceeded) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        setAqError('Google Maps Platform Air Quality API quota exceeded.');
        return;
      }
      if (!resp.ok) {
        setAqError(data.error || `HTTP ${resp.status}`);
        return;
      }
      setAqData(data);
    } catch (err) {
      setAqError(err instanceof Error ? err.message : 'Air Quality lookup error');
    } finally {
      setAqLoading(false);
    }
  };

  const selectedSimNode =
    selectedMarker && selectedMarker.kind === 'pod'
      ? snapshot.nodes.find((n) => n.node_id === selectedMarker.id)
      : null;

  return (
    <div
      data-testid="geospatial-maps-view"
      className="fixed inset-0 top-12 z-20 bg-[#D5DDE5] text-[#1E293B] flex flex-col lg:flex-row overflow-hidden"
    >
      {/* Map Viewport */}
      <div className="flex-1 relative min-h-[340px] bg-[#C8D3DE]">
        {configLoaded && mapsKey ? (
          <APIProvider apiKey={mapsKey}>
            <GoogleMap
              defaultCenter={CORRIDOR_CENTER}
              defaultZoom={17}
              mapId={mapId}
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              gestureHandling="greedy"
              style={{ width: '100%', height: '100%' }}
            >
              {DEPLOYMENT_MARKERS.map((m) => {
                const pod = snapshot.nodes.find((n) => n.node_id === m.id);
                const isOff = pod && pod.enabled === false;
                const bg =
                  m.kind === 'tower'
                    ? '#475569'
                    : isOff
                    ? '#DC2626'
                    : pod?.safety_override
                    ? '#D97706'
                    : '#059669';
                return (
                  <AdvancedMarker
                    key={m.id}
                    position={{ lat: m.lat, lng: m.lng }}
                    title={m.label}
                    onClick={() => setSelectedMarker(m)}
                  >
                    <Pin background={bg} glyphColor="#FFFFFF" borderColor="#1E293B" />
                  </AdvancedMarker>
                );
              })}

              {selectedMarker && (
                <InfoWindow
                  position={{ lat: selectedMarker.lat, lng: selectedMarker.lng }}
                  onCloseClick={() => setSelectedMarker(null)}
                >
                  <div className="text-xs text-[#0F172A] max-w-xs space-y-1 p-1">
                    <div className="font-semibold">{selectedMarker.label}</div>
                    {selectedSimNode ? (
                      <>
                        <div className="font-mono text-[11px]">
                          Status: {selectedSimNode.enabled !== false ? 'ACTIVE' : 'DEACTIVATED'} · Fan{' '}
                          {Math.round(selectedSimNode.fan_duty * 100)}%
                        </div>
                        <div className="font-mono text-[11px]">
                          PM2.5 {selectedSimNode.cin.pm25.toFixed(1)} → {selectedSimNode.cout.pm25.toFixed(1)} µg/m³
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelectNode(selectedSimNode.node_id)}
                          className="mt-1 px-2 py-1 rounded bg-[#059669] text-white text-[11px] font-medium"
                        >
                          Open Node Inspector
                        </button>
                      </>
                    ) : (
                      <div className="font-mono text-[11px]">
                        Central Tower · {snapshot.tower.power_w.toFixed(0)}W ·{' '}
                        {snapshot.tower.active ? 'Active' : 'Standby'}
                      </div>
                    )}
                  </div>
                </InfoWindow>
              )}
            </GoogleMap>
          </APIProvider>
        ) : (
          <div className="w-full h-full flex items-center justify-center p-6">
            <div className="bg-[#EEF2F6] border border-[#B8C4D0] rounded-xl p-6 max-w-md text-center space-y-2 shadow-md">
              <MapPin className="w-8 h-8 text-[#0F766E] mx-auto" />
              <h2 className="text-sm font-bold text-[#0F172A]">Google Maps Platform Twin Canvas</h2>
              <p className="text-xs text-[#475569]">
                {configLoaded
                  ? 'Google Maps API key is not configured in server environment secrets (GOOGLE_MAPS_API_KEY). Configure it to render live Google Map tiles.'
                  : 'Loading Google Maps Platform configuration...'}
              </p>
              <div className="pt-2 grid grid-cols-1 gap-1.5 text-left text-[11px] font-mono">
                {DEPLOYMENT_MARKERS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedMarker(m)}
                    className={`px-3 py-1.5 rounded border text-left ${
                      selectedMarker?.id === m.id
                        ? 'bg-[#2D3744] text-white border-[#1E293B]'
                        : 'bg-white text-[#334155] border-[#CBD5E1]'
                    }`}
                  >
                    {m.label} ({m.lat.toFixed(5)}, {m.lng.toFixed(5)})
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Geospatial Air Quality Control Sidebar */}
      <aside className="w-full lg:w-[390px] bg-[#EEF2F6] border-t lg:border-t-0 lg:border-l border-[#B8C4D0] p-4 overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-[#0F766E] font-semibold">
              Google Maps Platform · Urban Siting
            </div>
            <h2 className="text-sm font-bold text-[#0F172A]">Corridor Coordinates &amp; Live AQI</h2>
          </div>
          <Compass className="w-5 h-5 text-[#0F766E]" />
        </div>

        <div className="bg-white border border-[#CBD5E1] rounded-lg p-3 space-y-2 text-xs">
          <div className="font-semibold text-[#0F172A]">
            Selected Anchor: {selectedMarker?.label || 'Corridor Center'}
          </div>
          <div className="font-mono text-[11px] text-[#475569]">
            Lat {selectedMarker?.lat.toFixed(5)} · Lng {selectedMarker?.lng.toFixed(5)}
          </div>
          <button
            type="button"
            onClick={fetchRealAirQuality}
            disabled={aqLoading}
            className="w-full py-2 px-3 rounded-md bg-[#059669] hover:bg-[#047857] text-white font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${aqLoading ? 'animate-spin' : ''}`} />
            {aqLoading ? 'Querying Air Quality API...' : 'Fetch Live Google Air Quality'}
          </button>
        </div>

        {aqError && (
          <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FCA5A5] text-[#991B1B] text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{aqError}</span>
          </div>
        )}

        {aqData && (
          <div className="bg-white border border-[#CBD5E1] rounded-lg p-3 space-y-2 text-xs">
            <div className="font-semibold text-[#0F172A]">Google Air Quality Conditions</div>
            {aqData.indexes?.map((idx) => (
              <div key={idx.code} className="p-2 rounded bg-[#F1F5F9] font-mono">
                <div>
                  {idx.displayName}: <strong>{idx.aqi}</strong> ({idx.category})
                </div>
                {idx.dominantPollutant && (
                  <div className="text-[11px] text-[#475569]">
                    Dominant Pollutant: {idx.dominantPollutant.toUpperCase()}
                  </div>
                )}
              </div>
            ))}
            {aqData.pollutants && aqData.pollutants.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
                {aqData.pollutants.slice(0, 6).map((p) => (
                  <div key={p.code} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded p-1.5">
                    <div className="font-semibold">{p.displayName}</div>
                    <div>
                      {p.concentration?.value ?? '—'} {p.concentration?.units ?? ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {aqData.healthRecommendations?.generalPopulation && (
              <p className="text-[11px] text-[#475569] leading-relaxed">
                {aqData.healthRecommendations.generalPopulation}
              </p>
            )}
          </div>
        )}

        <div className="bg-[#DCE4EC] border border-[#B8C4D0] rounded-lg p-3 space-y-1.5 text-xs">
          <div className="font-semibold text-[#0F172A]">Simulated Twin Baseline</div>
          <div className="font-mono text-[11px] text-[#334155]">
            Twin AQI: {snapshot.pedestrianAqi} ({snapshot.aqiCategory}) · Rv +{snapshot.verifiedReductionRvPct.toFixed(1)}%
          </div>
          <div className="font-mono text-[11px] text-[#334155]">
            Crowd Est: {snapshot.populationCount} pedestrians · Active Pods {snapshot.activeNodeCount}/5
          </div>
        </div>
      </aside>
    </div>
  );
};
