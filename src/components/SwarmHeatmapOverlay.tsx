/**
 * Bio-Solar Swarm: D3.js 2D Performance Heatmap Overlay
 * Projects real-time D3 iso-improvement contours (Delta PM2.5 / Rv %) onto the 3D WebGL scene
 * and renders a calibrated 2D corridor planform mini-map + D3 linear colorbar legend.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import * as THREE from 'three';
import { ViewportCameraMatrices } from '../scene/SwarmViewport';
import {
  computeSwarmImprovementField,
  gridToWorld,
  HEATMAP_BOUNDS,
  SwarmHeatmapField,
} from '../simulation/heatmap';
import { SimulationSnapshot } from '../simulation/types';

interface SwarmHeatmapOverlayProps {
  snapshot: SimulationSnapshot;
  cameraMatricesRef: React.MutableRefObject<ViewportCameraMatrices | null>;
  visible: boolean;
  rightDrawerOpen?: boolean;
}

const CONTOUR_THRESHOLDS = [8, 16, 26, 38, 50, 62];
const CONTOUR_STOPS = ['#94A3B8', '#38BDF8', '#2DD4BF', '#10B981', '#047857'];

const PLANFORM_W = 266;
const PLANFORM_H = 76;

const _vec4 = new THREE.Vector4();

function projectWorldPoint(
  wx: number,
  wy: number,
  wz: number,
  mats: ViewportCameraMatrices
): [number, number] | null {
  _vec4.set(wx, wy, wz, 1);
  _vec4.applyMatrix4(mats.matrixWorldInverse);
  _vec4.applyMatrix4(mats.projectionMatrix);
  if (_vec4.w <= 0.15) return null;
  const ndcX = _vec4.x / _vec4.w;
  const ndcY = _vec4.y / _vec4.w;
  return [(ndcX * 0.5 + 0.5) * mats.width, (-ndcY * 0.5 + 0.5) * mats.height];
}

export const SwarmHeatmapOverlay: React.FC<SwarmHeatmapOverlayProps> = ({
  snapshot,
  cameraMatricesRef,
  visible,
  rightDrawerOpen = false,
}) => {
  const contourGroupRef = useRef<SVGGElement | null>(null);
  const calloutGroupRef = useRef<SVGGElement | null>(null);
  const planformSvgRef = useRef<SVGSVGElement | null>(null);
  const legendAxisRef = useRef<SVGGElement | null>(null);

  const field = useMemo<SwarmHeatmapField>(
    () => computeSwarmImprovementField(snapshot),
    [snapshot]
  );
  const fieldRef = useRef<SwarmHeatmapField>(field);
  fieldRef.current = field;

  const fieldVersionRef = useRef(0);
  useEffect(() => {
    fieldVersionRef.current += 1;
  }, [field]);

  const colorScale = useMemo(
    () => d3.scaleSequential(d3.interpolateRgbBasis(CONTOUR_STOPS)).domain([0, 72]),
    []
  );

  // Calibrated D3 colorbar axis (0% .. 72% AQI improvement)
  useEffect(() => {
    if (!visible || rightDrawerOpen || !legendAxisRef.current) return;
    const axisScale = d3.scaleLinear().domain([0, 72]).range([6, PLANFORM_W - 6]);
    const axis = d3
      .axisBottom(axisScale)
      .tickValues([0, 18, 36, 54, 72])
      .tickSize(3)
      .tickFormat((d) => `${Number(d)}%`);

    const g = d3.select(legendAxisRef.current);
    g.call(axis);
    g.select('.domain').attr('stroke', '#64748B');
    g.selectAll('.tick line').attr('stroke', '#64748B');
    g.selectAll('.tick text')
      .attr('fill', '#CBD5E1')
      .attr('font-size', '9px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');
  }, [visible, rightDrawerOpen]);

  // Render D3 top-down 2D corridor planform heatmap in top-right legend card
  useEffect(() => {
    if (!visible || rightDrawerOpen || !planformSvgRef.current) return;
    const svg = d3.select(planformSvgRef.current);

    const xScale = d3
      .scaleLinear()
      .domain([HEATMAP_BOUNDS.minX, HEATMAP_BOUNDS.maxX])
      .range([0, PLANFORM_W]);
    const zScale = d3
      .scaleLinear()
      .domain([HEATMAP_BOUNDS.minZ, HEATMAP_BOUNDS.maxZ])
      .range([0, PLANFORM_H]);

    const contourGen = d3
      .contours()
      .size([field.cols, field.rows])
      .thresholds(CONTOUR_THRESHOLDS);
    const contours = contourGen(field.values);

    const lineGen = d3.line<[number, number]>().curve(d3.curveLinearClosed);

    const pathsData = contours.flatMap((c) => {
      const fill = colorScale(c.value);
      const tNorm = Math.max(0, Math.min(1, c.value / 65));
      return c.coordinates
        .map((poly) => {
          const dStr = poly
            .map((ring) => {
              const pts: [number, number][] = ring.map(([gx, gy]) => {
                const { x, z } = gridToWorld(gx, gy);
                return [xScale(x), zScale(z)];
              });
              return lineGen(pts) || '';
            })
            .filter(Boolean)
            .join(' ');
          return {
            d: dStr,
            fill,
            opacity: 0.25 + tNorm * 0.55,
            value: c.value,
          };
        })
        .filter((item) => item.d.length > 0);
    });

    const contourLayer = svg.select<SVGGElement>('g.planform-contours');
    contourLayer
      .selectAll<SVGPathElement, (typeof pathsData)[number]>('path')
      .data(pathsData)
      .join('path')
      .attr('d', (d) => d.d)
      .attr('fill', (d) => d.fill)
      .attr('fill-opacity', (d) => d.opacity)
      .attr('fill-rule', 'evenodd')
      .attr('stroke', (d) => d.fill)
      .attr('stroke-width', 0.7)
      .attr('stroke-opacity', 0.8);

    // Draw Pod nodes + peak crosshair
    const podLayer = svg.select<SVGGElement>('g.planform-pods');
    podLayer
      .selectAll<SVGCircleElement, (typeof field.hotspots)[number]>('circle.pod-dot')
      .data(field.hotspots, (d) => d.nodeId)
      .join('circle')
      .attr('class', 'pod-dot')
      .attr('cx', (d) => xScale(d.x))
      .attr('cy', (d) => zScale(d.z))
      .attr('r', (d) => (d.enabled ? 3.8 : 2.8))
      .attr('fill', (d) => (d.enabled ? '#ECFDF5' : '#64748B'))
      .attr('stroke', (d) => (d.enabled ? '#059669' : '#334155'))
      .attr('stroke-width', 1.4);

    // Peak marker crosshair
    const peakGroup = svg.select<SVGGElement>('g.planform-peak');
    const px = xScale(field.peakLocation.x);
    const pz = zScale(field.peakLocation.z);
    peakGroup.attr('transform', `translate(${px}, ${pz})`);
    peakGroup.style('display', field.peakImprovementPct >= 5 ? 'inline' : 'none');
  }, [field, colorScale, visible, rightDrawerOpen]);

  // Real-time 3D-projected D3 contours + pod hotspot callouts locked to Three.js camera
  useEffect(() => {
    if (!visible) {
      if (contourGroupRef.current) contourGroupRef.current.innerHTML = '';
      if (calloutGroupRef.current) calloutGroupRef.current.innerHTML = '';
      return;
    }

    let rafId = 0;
    let lastDrawnCamVer = -1;
    let lastDrawnFieldVer = -1;
    let lastDrawMs = 0;
    const lineGen = d3.line<[number, number]>().curve(d3.curveLinearClosed);

    const drawProjectedOverlay = (now: number) => {
      rafId = requestAnimationFrame(drawProjectedOverlay);

      const mats = cameraMatricesRef.current;
      const contourLayer = contourGroupRef.current;
      const calloutLayer = calloutGroupRef.current;
      if (!mats || !contourLayer || !calloutLayer || mats.width <= 0 || mats.height <= 0) {
        return;
      }

      const fVer = fieldVersionRef.current;
      const cVer = mats.version;
      if (cVer === lastDrawnCamVer && fVer === lastDrawnFieldVer) {
        return;
      }
      if (now - lastDrawMs < 38) {
        return; // ~26 Hz cap keeps CPU overhead negligible alongside WebGL
      }

      lastDrawMs = now;
      lastDrawnCamVer = cVer;
      lastDrawnFieldVer = fVer;

      const currentField = fieldRef.current;
      const contourGen = d3
        .contours()
        .size([currentField.cols, currentField.rows])
        .thresholds(CONTOUR_THRESHOLDS);
      const contours = contourGen(currentField.values);

      const projectedBands: Array<{
        d: string;
        fill: string;
        fillOpacity: number;
        strokeOpacity: number;
      }> = [];

      for (const band of contours) {
        const fill = colorScale(band.value);
        const tNorm = Math.max(0, Math.min(1, band.value / 65));
        for (const poly of band.coordinates) {
          const ringPaths: string[] = [];
          for (const ring of poly) {
            const pts: [number, number][] = [];
            let validRing = true;
            for (const [gx, gy] of ring) {
              const { x, z } = gridToWorld(gx, gy);
              const screenPt = projectWorldPoint(x, HEATMAP_BOUNDS.yPlane, z, mats);
              if (!screenPt) {
                validRing = false;
                break;
              }
              pts.push(screenPt);
            }
            if (validRing && pts.length >= 3) {
              const seg = lineGen(pts);
              if (seg) ringPaths.push(seg);
            }
          }
          if (ringPaths.length > 0) {
            projectedBands.push({
              d: ringPaths.join(' '),
              fill,
              fillOpacity: 0.14 + tNorm * 0.28,
              strokeOpacity: 0.45 + tNorm * 0.4,
            });
          }
        }
      }

      d3.select(contourLayer)
        .selectAll<SVGPathElement, (typeof projectedBands)[number]>('path')
        .data(projectedBands)
        .join('path')
        .attr('d', (d) => d.d)
        .attr('fill', (d) => d.fill)
        .attr('fill-opacity', (d) => d.fillOpacity)
        .attr('fill-rule', 'evenodd')
        .attr('stroke', (d) => d.fill)
        .attr('stroke-width', 1.25)
        .attr('stroke-opacity', (d) => d.strokeOpacity);

      // Projected pod hotspot callout tags
      const calloutData = currentField.hotspots
        .map((hs) => {
          if (!hs.enabled || hs.improvementPct < 8) return null;
          const topPt = projectWorldPoint(hs.x, 4.15, hs.z, mats);
          const basePt = projectWorldPoint(hs.x, 3.2, hs.z, mats);
          if (!topPt || !basePt) return null;
          if (
            topPt[0] < 40 ||
            topPt[0] > mats.width - 40 ||
            topPt[1] < 56 ||
            topPt[1] > mats.height - 80
          ) {
            return null;
          }
          const isPeak = Math.abs(hs.improvementPct - currentField.peakImprovementPct) < 2.5;
          return {
            ...hs,
            sx: topPt[0],
            sy: topPt[1],
            bx: basePt[0],
            by: basePt[1],
            isPeak,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      const groups = d3
        .select(calloutLayer)
        .selectAll<SVGGElement, (typeof calloutData)[number]>('g.pod-callout')
        .data(calloutData, (d) => d.nodeId)
        .join((enter) => {
          const g = enter.append('g').attr('class', 'pod-callout');
          g.append('line').attr('class', 'callout-stem');
          g.append('rect').attr('class', 'callout-box');
          g.append('text').attr('class', 'callout-text');
          return g;
        });

      groups
        .select<SVGLineElement>('line.callout-stem')
        .attr('x1', (d) => d.sx)
        .attr('y1', (d) => d.sy + 10)
        .attr('x2', (d) => d.bx)
        .attr('y2', (d) => d.by)
        .attr('stroke', (d) => (d.isPeak ? '#10B981' : '#38BDF8'))
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', '2,2')
        .attr('stroke-opacity', 0.85);

      groups
        .select<SVGRectElement>('rect.callout-box')
        .attr('x', (d) => d.sx - 34)
        .attr('y', (d) => d.sy - 11)
        .attr('width', 68)
        .attr('height', 21)
        .attr('rx', 4)
        .attr('fill', '#1E293B')
        .attr('fill-opacity', 0.88)
        .attr('stroke', (d) => (d.isPeak ? '#10B981' : '#475569'))
        .attr('stroke-width', (d) => (d.isPeak ? 1.4 : 1));

      groups
        .select<SVGTextElement>('text.callout-text')
        .attr('x', (d) => d.sx)
        .attr('y', (d) => d.sy + 3)
        .attr('text-anchor', 'middle')
        .attr('fill', (d) => (d.isPeak ? '#6EE7B7' : '#E2E8F0'))
        .attr('font-size', '10px')
        .attr('font-weight', '600')
        .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
        .text((d) => `${d.nodeId.slice(-2)} +${Math.round(d.improvementPct)}%`);
    };

    rafId = requestAnimationFrame(drawProjectedOverlay);
    return () => cancelAnimationFrame(rafId);
  }, [visible, colorScale, cameraMatricesRef]);

  if (!visible) return null;

  const windRad = ((snapshot.environment.windAngleDeg ?? 35) * Math.PI) / 180;
  const windDx = Math.cos(windRad) * 11;
  const windDz = -Math.sin(windRad) * 11;

  return (
    <>
      {/* Full-Bleed Projected D3.js 2D Contour Overlay on 3D Scene */}
      <svg
        data-testid="swarm-heatmap-svg"
        aria-label="D3.js 2D Performance Heatmap Overlay"
        className="fixed inset-0 w-full h-full z-10 pointer-events-none overflow-hidden"
      >
        <g ref={contourGroupRef} />
        <g ref={calloutGroupRef} />
      </svg>

      {/* Top-Right Compact 2D Corridor Planform & Calibrated D3 Legend Card */}
      {!rightDrawerOpen && (
        <aside
          data-testid="swarm-heatmap-legend"
          aria-label="Swarm Performance Heatmap Planform and Scale"
          className="hidden md:block fixed top-16 right-4 z-20 w-[292px] bg-[#2D3744]/95 border border-[#465466] rounded-xl p-3 text-[#F1F5F9] shadow-lg pointer-events-auto"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[#94A3B8]">
                D3.js 2D Performance Heatmap
              </div>
              <div className="text-xs font-semibold text-white">
                Peak +{field.peakImprovementPct.toFixed(1)}% · {field.peakLocation.label}
              </div>
            </div>
            <div className="text-right font-mono tabular-nums">
              <div className="text-[10px] text-[#94A3B8]">Corridor Mean</div>
              <div className="text-xs font-semibold text-[#34D399]">
                +{field.meanImprovementPct.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Top-Down 2D Corridor Planform SVG */}
          <div className="mt-2 rounded-lg overflow-hidden border border-[#435060] bg-[#1E2630]">
            <svg
              ref={planformSvgRef}
              viewBox={`0 0 ${PLANFORM_W} ${PLANFORM_H}`}
              className="w-full h-[76px] block"
            >
              {/* North sidewalk & 4-lane avenue reference bands */}
              <rect x={0} y={0} width={PLANFORM_W} height={34} fill="#334155" fillOpacity={0.55} />
              <rect x={0} y={34} width={PLANFORM_W} height={PLANFORM_H - 34} fill="#1E293B" />
              <line
                x1={0}
                y1={34}
                x2={PLANFORM_W}
                y2={34}
                stroke="#64748B"
                strokeWidth={0.8}
                strokeDasharray="3,3"
              />
              {/* D3 Contour Layer */}
              <g className="planform-contours" />
              {/* Pod Nodes */}
              <g className="planform-pods" />
              {/* Peak Gain Crosshair */}
              <g className="planform-peak">
                <circle r={6} fill="none" stroke="#F8FAFC" strokeWidth={1.1} strokeDasharray="2,2" />
              </g>
              {/* Wind Vector Indicator */}
              <g transform="translate(242, 16)">
                <circle r={11} fill="#0F172A" fillOpacity={0.75} stroke="#475569" strokeWidth={0.8} />
                <line
                  x1={-windDx * 0.45}
                  y1={-windDz * 0.45}
                  x2={windDx * 0.65}
                  y2={windDz * 0.65}
                  stroke="#38BDF8"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                />
                <circle cx={windDx * 0.65} cy={windDz * 0.65} r={1.8} fill="#BAE6FD" />
              </g>
            </svg>
          </div>

          {/* Calibrated D3 Linear Colorbar Axis */}
          <svg viewBox={`0 0 ${PLANFORM_W} 28`} className="w-full h-7 mt-1.5 block">
            <defs>
              <linearGradient id="bss-heatmap-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#94A3B8" />
                <stop offset="28%" stopColor="#38BDF8" />
                <stop offset="56%" stopColor="#2DD4BF" />
                <stop offset="80%" stopColor="#10B981" />
                <stop offset="100%" stopColor="#047857" />
              </linearGradient>
            </defs>
            <rect
              x={6}
              y={2}
              width={PLANFORM_W - 12}
              height={7}
              rx={2}
              fill="url(#bss-heatmap-grad)"
            />
            <g ref={legendAxisRef} transform="translate(0, 10)" />
          </svg>
        </aside>
      )}
    </>
  );
};
