/**
 * Bio-Solar Swarm 3D Urban Remediation Viewport (Three.js)
 * Isolated WebGL canvas container with software-WebGL guard, RoomEnvironment PBR,
 * InstancedMesh pollution plume physics, ACO mesh arcs, and smooth damped camera presets.
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { INITIAL_NODE_LAYOUT, SimulationSnapshot } from '../simulation/types';
import {
  buildCentralTowerModel,
  buildPedestrian,
  buildStreetTree,
  buildSwarmPodModel,
  buildUrbanVehicle,
  CentralTowerRig,
  PedestrianRig,
  SwarmPodRig,
  VehicleRig,
} from './models';
import { createSceneTextureBundle } from './textures';

export type CameraPreset = 'overview' | 'pod_closeup' | 'tower_compare' | 'top_map';

export interface ViewportCameraMatrices {
  projectionMatrix: THREE.Matrix4;
  matrixWorldInverse: THREE.Matrix4;
  width: number;
  height: number;
  version: number;
}

interface SwarmViewportProps {
  snapshotRef: React.MutableRefObject<SimulationSnapshot>;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  cameraPreset: CameraPreset;
  cameraTrigger: number;
  paused: boolean;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  cameraMatricesRef?: React.MutableRefObject<ViewportCameraMatrices | null>;
}

const PARTICLE_COUNT = 420;

interface ParticleState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  cleaned: number; // 0 = raw polluted, 1 = remediated
}

// Pre-allocated math scratch objects (zero per-frame GC allocations)
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _targetCamPos = new THREE.Vector3();
const _targetLook = new THREE.Vector3();
const _pointer = new THREE.Vector2();

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export const SwarmViewport: React.FC<SwarmViewportProps> = ({
  snapshotRef,
  selectedNodeId,
  onSelectNode,
  cameraPreset,
  cameraTrigger,
  paused,
  onCanvasReady,
  cameraMatricesRef,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  const selectedNodeRef = useRef(selectedNodeId);
  const onSelectNodeRef = useRef(onSelectNode);
  const pausedRef = useRef(paused);
  const onCanvasReadyRef = useRef(onCanvasReady);
  const cameraMatricesPropRef = useRef(cameraMatricesRef);
  const presetTargetRef = useRef<{ active: boolean; preset: CameraPreset }>({
    active: false,
    preset: cameraPreset,
  });

  useEffect(() => {
    selectedNodeRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    onSelectNodeRef.current = onSelectNode;
  }, [onSelectNode]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    onCanvasReadyRef.current = onCanvasReady;
  }, [onCanvasReady]);

  useEffect(() => {
    cameraMatricesPropRef.current = cameraMatricesRef;
  }, [cameraMatricesRef]);

  useEffect(() => {
    if (cameraTrigger > 0) {
      presetTargetRef.current = { active: true, preset: cameraPreset };
    }
  }, [cameraPreset, cameraTrigger]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute('data-testid', 'swarm-webgl-canvas');
    container.appendChild(renderer.domElement);
    onCanvasReadyRef.current?.(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const scene = new THREE.Scene();
    const skyColor = new THREE.Color('#B4C1CD');
    scene.background = skyColor;
    scene.fog = new THREE.FogExp2(0xb4c1cd, 0.0085);

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.25, 260);
    camera.position.set(0, 15.5, 31.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 5;
    controls.maxDistance = 85;
    controls.target.set(0, 3.2, -5.0);
    controls.update();

    const sharedCameraMatrices: ViewportCameraMatrices = {
      projectionMatrix: camera.projectionMatrix.clone(),
      matrixWorldInverse: camera.matrixWorldInverse.clone(),
      width,
      height,
      version: 0,
    };
    if (cameraMatricesPropRef.current) {
      cameraMatricesPropRef.current.current = sharedCameraMatrices;
    }

    controls.addEventListener('start', () => {
      presetTargetRef.current.active = false;
    });

    // Studio & Daylight Environment Map
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    pmremGenerator.dispose();

    // Warm Key Sunlight + Cool Sky/Ground Hemisphere + Subtle Rim Light
    const hemiLight = new THREE.HemisphereLight(0xdbe8f4, 0x5c6672, 1.18);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff1d6, 2.1);
    sunLight.position.set(28, 38, 22);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 2;
    sunLight.shadow.camera.far = 110;
    sunLight.shadow.camera.left = -45;
    sunLight.shadow.camera.right = 45;
    sunLight.shadow.camera.top = 35;
    sunLight.shadow.camera.bottom = -35;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0xe0ecff, 0.6);
    rimLight.position.set(-24, 16, -26);
    scene.add(rimLight);

    // Procedural Textures
    const textures = createSceneTextureBundle(renderer.capabilities.getMaxAnisotropy());

    // Extended Ground Horizon Plane (avoids floating island void)
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x7a8591,
      roughness: 0.92,
      metalness: 0.02,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    // Pedestrian Sidewalk Promenade (z = -11 .. -2.5)
    const sidewalkMat = new THREE.MeshStandardMaterial({
      map: textures.sidewalkAlbedo,
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.04,
    });
    const northSidewalk = new THREE.Mesh(new THREE.BoxGeometry(110, 0.14, 9.5), sidewalkMat);
    northSidewalk.position.set(0, -0.07, -7.25);
    northSidewalk.receiveShadow = true;
    scene.add(northSidewalk);

    const southSidewalk = new THREE.Mesh(new THREE.BoxGeometry(110, 0.14, 6.5), sidewalkMat);
    southSidewalk.position.set(0, -0.07, 10.75);
    southSidewalk.receiveShadow = true;
    scene.add(southSidewalk);

    // 4-Lane Asphalt Avenue (z = -2.5 .. +7.5, raised slightly above base ground)
    const roadMat = new THREE.MeshStandardMaterial({
      map: textures.roadAlbedo,
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.06,
    });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(110, 10), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.01, 2.5);
    road.receiveShadow = true;
    scene.add(road);

    // Crosswalk Stripes at x = 0 (near Pod 03)
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.7 });
    const stripeGeo = new THREE.PlaneGeometry(2.6, 0.52);
    for (let z = -1.6; z <= 6.6; z += 1.15) {
      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(0, 0.025, z);
      scene.add(stripe);
    }

    // Bus Shelter Canopy beside Pod 01 (x = -26.5, z = -7.8)
    const shelterGroup = new THREE.Group();
    const shelterFrameMat = new THREE.MeshStandardMaterial({ color: 0x3b4552, roughness: 0.4, metalness: 0.65 });
    const shelterGlassMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      transparent: true,
      opacity: 0.35,
      roughness: 0.15,
    });
    const shelterRoof = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 1.9), shelterFrameMat);
    shelterRoof.position.set(-27.2, 2.65, -7.8);
    shelterRoof.castShadow = true;
    shelterGroup.add(shelterRoof);
    const shelterBack = new THREE.Mesh(new THREE.BoxGeometry(4.0, 2.5, 0.08), shelterGlassMat);
    shelterBack.position.set(-27.2, 1.35, -8.65);
    shelterGroup.add(shelterBack);
    for (const px of [-29.1, -25.3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.65, 8), shelterFrameMat);
      post.position.set(px, 1.32, -8.6);
      shelterGroup.add(post);
    }
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 0.55), shelterFrameMat);
    bench.position.set(-27.2, 0.48, -8.15);
    shelterGroup.add(bench);
    scene.add(shelterGroup);

    // Urban Buildings (North Skyline + Distant Backdrop + South Block behind camera)
    const buildingSpecs = [
      { x: -34, z: -20, w: 12, d: 11, h: 17, tex: 0 },
      { x: -20, z: -21, w: 13, d: 12, h: 22, tex: 1 },
      { x: -5, z: -20, w: 12, d: 10, h: 15, tex: 2 },
      { x: 30, z: -21, w: 14, d: 12, h: 20, tex: 0 },
      { x: -38, z: 40, w: 14, d: 11, h: 14, tex: 2 },
      { x: -16, z: 41, w: 15, d: 11, h: 18, tex: 1 },
      { x: 6, z: 40, w: 14, d: 10, h: 15, tex: 0 },
      { x: 28, z: 41, w: 15, d: 11, h: 16, tex: 2 },
    ];
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x525d69, roughness: 0.85 });
    for (const b of buildingSpecs) {
      const facadeMat = new THREE.MeshStandardMaterial({
        map: textures.buildingFacades[b.tex],
        color: 0xffffff,
        roughness: 0.65,
        metalness: 0.15,
      });
      const bldg = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), facadeMat);
      bldg.position.set(b.x, b.h / 2, b.z);
      bldg.castShadow = true;
      bldg.receiveShadow = true;
      scene.add(bldg);

      const parapet = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.3, 0.5, b.d + 0.3), roofMat);
      parapet.position.set(b.x, b.h + 0.25, b.z);
      scene.add(parapet);
    }

    // Street Trees along sidewalk
    const treeXs = [-31, -18, -6, 6, 18, 31];
    for (const tx of treeXs) {
      const tree = buildStreetTree(textures);
      tree.position.set(tx, 0, -9.2);
      scene.add(tree);
    }

    // Build Centralized Air Purification Tower (set back at x: 16, z: -22)
    const towerRig: CentralTowerRig = buildCentralTowerModel(textures);
    towerRig.group.position.set(16, 0, -22);
    scene.add(towerRig.group);

    // Build the 5 Street-Level Bio-Solar Swarm Pods
    const podRigs: SwarmPodRig[] = INITIAL_NODE_LAYOUT.map((slot) => {
      const rig = buildSwarmPodModel(slot.node_id, textures, isSoftwareGl);
      rig.group.position.set(slot.x, 0, slot.z);
      scene.add(rig.group);
      return rig;
    });

    // Build ACO Swarm Mesh Communication Arcs between adjacent pods
    const swarmLinksGroup = new THREE.Group();
    const linkArcs: Array<{
      mesh: THREE.Mesh;
      mat: THREE.MeshStandardMaterial;
      pulse: THREE.Mesh;
      curve: THREE.QuadraticBezierCurve3;
    }> = [];
    for (let i = 0; i < podRigs.length - 1; i++) {
      const a = INITIAL_NODE_LAYOUT[i];
      const b = INITIAL_NODE_LAYOUT[i + 1];
      const start = new THREE.Vector3(a.x, 3.0, a.z);
      const mid = new THREE.Vector3((a.x + b.x) / 2, 4.35, (a.z + b.z) / 2);
      const end = new THREE.Vector3(b.x, 3.0, b.z);
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const tubeGeo = new THREE.TubeGeometry(curve, 20, 0.055, 8, false);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x10b981,
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.75,
        roughness: 0.25,
      });
      const arcMesh = new THREE.Mesh(tubeGeo, mat);
      swarmLinksGroup.add(arcMesh);

      const pulse = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xa7f3d0 })
      );
      swarmLinksGroup.add(pulse);

      linkArcs.push({ mesh: arcMesh, mat, pulse, curve });
    }
    scene.add(swarmLinksGroup);

    // Build Animated Traffic Vehicles
    const vehicleSpecs: Array<{ variant: 'sedan' | 'bus' | 'van'; color: number; laneZ: number; dir: 1 | -1; x: number; speed: number }> = [
      { variant: 'bus', color: 0xd97706, laneZ: 0.2, dir: 1, x: -32, speed: 6.2 },
      { variant: 'sedan', color: 0x2563eb, laneZ: 0.2, dir: 1, x: -6, speed: 9.2 },
      { variant: 'van', color: 0x64748b, laneZ: -1.4, dir: 1, x: 18, speed: 7.8 },
      { variant: 'sedan', color: 0xdc2626, laneZ: 4.1, dir: -1, x: 28, speed: 9.5 },
      { variant: 'van', color: 0x0f766e, laneZ: 4.1, dir: -1, x: -12, speed: 8.1 },
      { variant: 'bus', color: 0x3b82f6, laneZ: 5.8, dir: -1, x: 6, speed: 6.5 },
      { variant: 'sedan', color: 0x7c3aed, laneZ: 5.8, dir: -1, x: -26, speed: 8.8 },
    ];
    const vehicles: VehicleRig[] = vehicleSpecs.map((vs) => {
      const rig = buildUrbanVehicle(vs.variant, vs.color, textures);
      rig.laneZ = vs.laneZ;
      rig.direction = vs.dir;
      rig.speed = vs.speed;
      rig.xPos = vs.x;
      rig.group.position.set(vs.x, 0, vs.laneZ);
      rig.group.rotation.y = vs.dir === 1 ? 0 : Math.PI;
      scene.add(rig.group);
      return rig;
    });

    // Build Articulated Pedestrians on North Sidewalk (pool of 18 scaled dynamically by voice population)
    const pedSpecs = [
      { x: -24.5, z: -6.7, shirt: 0x0284c7, pants: 0x334155, phase: 0.2 },
      { x: -12.0, z: -6.8, shirt: 0xd97706, pants: 0x334155, phase: 2.3 },
      { x: -1.2, z: -4.6, shirt: 0x059669, pants: 0x1e293b, phase: 0.8 },
      { x: 11.4, z: -4.5, shirt: 0x2563eb, pants: 0x1e293b, phase: 4.0 },
      { x: 23.2, z: -4.7, shirt: 0xea580c, pants: 0x1e293b, phase: 5.1 },
      { x: -22.2, z: -4.4, shirt: 0xe11d48, pants: 0x1e293b, phase: 1.4 },
      { x: 1.8, z: -6.9, shirt: 0x7c3aed, pants: 0x334155, phase: 3.1 },
      { x: 13.5, z: -6.6, shirt: 0xdb2777, pants: 0x334155, phase: 2.0 },
      { x: -17.5, z: -5.0, shirt: 0x0d9488, pants: 0x1e293b, phase: 1.1 },
      { x: -7.5, z: -6.5, shirt: 0x4f46e5, pants: 0x334155, phase: 2.8 },
      { x: 5.8, z: -4.8, shirt: 0xc026d3, pants: 0x1e293b, phase: 0.5 },
      { x: 17.8, z: -6.8, shirt: 0x16a34a, pants: 0x334155, phase: 3.7 },
      { x: -28.0, z: -5.4, shirt: 0x0369a1, pants: 0x1e293b, phase: 4.5 },
      { x: -4.5, z: -7.1, shirt: 0xb45309, pants: 0x334155, phase: 1.9 },
      { x: 8.6, z: -6.2, shirt: 0xbe123c, pants: 0x1e293b, phase: 5.4 },
      { x: 20.5, z: -4.6, shirt: 0x047857, pants: 0x334155, phase: 2.6 },
      { x: -14.8, z: -4.4, shirt: 0x6d28d9, pants: 0x1e293b, phase: 3.9 },
      { x: 26.2, z: -6.5, shirt: 0x1d4ed8, pants: 0x334155, phase: 0.9 },
    ];
    const pedestrians: PedestrianRig[] = pedSpecs.map((ps) => {
      const rig = buildPedestrian(ps.shirt, ps.pants, textures);
      rig.baseX = ps.x;
      rig.baseZ = ps.z;
      rig.phase = ps.phase;
      rig.walkRadius = 2.4;
      rig.speed = 0.85 + (ps.phase % 0.4);
      rig.group.position.set(ps.x, 0, ps.z);
      scene.add(rig.group);
      return rig;
    });

    // InstancedMesh for Atmospheric PM2.5 / NO2 Pollution Particles
    const particleGeo = new THREE.SphereGeometry(0.14, 6, 6);
    const particleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.78,
    });
    const particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, PARTICLE_COUNT);
    particleMesh.frustumCulled = false;
    scene.add(particleMesh);

    const particles: ParticleState[] = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const x = -38 + ((i * 7.3) % 76);
      const z = -7 + ((i * 3.1) % 14);
      return {
        x,
        y: 0.35 + ((i * 0.41) % 2.4),
        z,
        vx: (Math.random() - 0.5) * 0.5,
        vy: 0.1 + Math.random() * 0.25,
        vz: -0.25 - Math.random() * 0.4,
        life: Math.random() * 6,
        maxLife: 5 + Math.random() * 4,
        cleaned: 0,
      };
    });

    // Pre-warm shaders on GPU devices
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Raycaster for clicking Bio-Solar Swarm Pods
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const hitboxes = podRigs.map((p) => p.hitbox);
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 6) return; // Ignore orbit drags
      const rect = renderer.domElement.getBoundingClientRect();
      _pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(_pointer, camera);
      const hits = raycaster.intersectObjects(hitboxes, false);
      if (hits.length > 0) {
        const nodeId = hits[0].object.userData.nodeId as string;
        onSelectNodeRef.current(nodeId);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // Resize Observer
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      sharedCameraMatrices.width = w;
      sharedCameraMatrices.height = h;
      sharedCameraMatrices.projectionMatrix.copy(camera.projectionMatrix);
      sharedCameraMatrices.version += 1;
    };
    window.addEventListener('resize', handleResize);

    // Render Loop with Software-WebGL afterDraw Pacing
    let frameId = 0;
    let disposed = false;
    let lastTime = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (sync && state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function updateCameraPreset(dt: number) {
      if (!presetTargetRef.current.active) return;
      const p = presetTargetRef.current.preset;
      const selectedId = selectedNodeRef.current;
      const selectedPod = podRigs.find((r) => r.nodeId === selectedId) ?? podRigs[2];

      if (p === 'overview') {
        _targetCamPos.set(0, 15.5, 31.5);
        _targetLook.set(0, 3.2, -5.0);
      } else if (p === 'pod_closeup') {
        _targetCamPos.set(selectedPod.group.position.x + 3.6, 3.6, selectedPod.group.position.z + 6.4);
        _targetLook.set(selectedPod.group.position.x, 2.1, selectedPod.group.position.z);
      } else if (p === 'tower_compare') {
        _targetCamPos.set(-20, 14, 21);
        _targetLook.set(6, 5.5, -11);
      } else if (p === 'top_map') {
        _targetCamPos.set(0, 44, 12);
        _targetLook.set(0, 0, -4);
      }

      const alpha = 1 - Math.exp(-5.0 * dt);
      camera.position.lerp(_targetCamPos, alpha);
      controls.target.lerp(_targetLook, alpha);

      if (camera.position.distanceTo(_targetCamPos) < 0.15) {
        presetTargetRef.current.active = false;
      }
    }

    function tick() {
      if (disposed) return;
      const now = performance.now();
      const rawDt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const snap = snapshotRef.current;
      const dt = pausedRef.current ? 0 : rawDt * snap.environment.simSpeed;
      const elapsed = now * 0.001;

      updateCameraPreset(rawDt);
      if (controls.enableDamping) controls.update();
      camera.updateMatrixWorld();
      sharedCameraMatrices.projectionMatrix.copy(camera.projectionMatrix);
      sharedCameraMatrices.matrixWorldInverse.copy(camera.matrixWorldInverse);
      sharedCameraMatrices.version += 1;
      if (cameraMatricesPropRef.current && cameraMatricesPropRef.current.current !== sharedCameraMatrices) {
        cameraMatricesPropRef.current.current = sharedCameraMatrices;
      }

      // Update Central Air Tower
      const towerOn = snap.tower.active;
      towerRig.exhaustPlume.visible = towerOn;
      towerRig.beaconMat.color.setHex(towerOn ? 0x38bdf8 : 0x64748b);
      towerRig.beaconMat.emissive.setHex(towerOn ? 0x0284c7 : 0x1e293b);
      if (towerOn && dt > 0) {
        towerRig.turbineRotor.rotation.y += dt * 7.5;
        towerRig.exhaustPlumeMat.opacity = 0.22 + 0.08 * Math.sin(elapsed * 3.5);
      }

      // Update 5 Bio-Solar Swarm Pods
      const activeSelectedId = selectedNodeRef.current;
      podRigs.forEach((rig, idx) => {
        const node = snap.nodes[idx];
        if (!node) return;

        rig.selectionHalo.visible = activeSelectedId === node.node_id;

        // Spin BLDC fan proportional to fan_duty (0 when pod deactivated)
        const podEnabled = node.enabled !== false;
        rig.fanRotor.rotation.y += dt * (podEnabled ? node.fan_duty * 28.0 : 0);

        // Remediation airflow cone visibility & pulsing
        const isPodActive = podEnabled && node.fan_duty > 0.1;
        rig.remediationCone.visible = isPodActive;
        rig.remediationConeMat.opacity = isPodActive
          ? 0.08 + node.fan_duty * 0.24 + 0.03 * Math.sin(elapsed * 4 + idx)
          : 0;

        // PBR algae core color/glow reflects strain & health & operator power
        if (!podEnabled) {
          rig.algaeCoreMat.color.setHex(0x475569);
          rig.algaeCoreMat.emissive.setHex(0x1e293b);
          rig.algaeCoreMat.emissiveIntensity = 0.08;
        } else if (node.pbr.isolated) {
          rig.algaeCoreMat.color.setHex(0x8c7a4c);
          rig.algaeCoreMat.emissive.setHex(0x4b4228);
          rig.algaeCoreMat.emissiveIntensity = 0.2;
        } else {
          const healthyHex = node.pbr.strain === 'Spirulina_platensis' ? 0x159a8c : 0x26a96c;
          rig.algaeCoreMat.color.setHex(healthyHex);
          rig.algaeCoreMat.emissive.setHex(0x16784a);
          rig.algaeCoreMat.emissiveIntensity = 0.35 + node.pbr.algae_health_score * 0.35;
        }

        // Rising O2 bubbles inside PBR
        const bubbleSpeed = !podEnabled ? 0 : node.pbr.isolated ? 0.05 : 0.45 + node.fan_duty * 0.8;
        rig.bubbles.forEach((b) => {
          if (dt > 0 && bubbleSpeed > 0) {
            b.position.y += dt * bubbleSpeed;
            if (b.position.y > 2.72) b.position.y = 1.44;
          }
        });

        // Colorimetric RGB indicator strip
        const [cr, cg, cb] = node.media.colorimetric_rgb;
        rig.colorimetricMat.color.setRGB(cr / 255, cg / 255, cb / 255);
        rig.colorimetricMat.emissive.setRGB((cr / 255) * 0.55, (cg / 255) * 0.55, (cb / 255) * 0.55);

        // Status Ring Color (Deactivated -> muted slate; Safety override -> amber; HIL -> cyan; Active -> emerald)
        if (!podEnabled) {
          rig.statusRingMat.color.setHex(0x64748b);
          rig.statusRingMat.emissive.setHex(0x334155);
        } else if (node.safety_override) {
          rig.statusRingMat.color.setHex(0xf59e0b);
          rig.statusRingMat.emissive.setHex(0xd97706);
        } else if (node.hardware_source === 'physical_hil') {
          rig.statusRingMat.color.setHex(0x06b6d4);
          rig.statusRingMat.emissive.setHex(0x0891b2);
        } else if (isPodActive) {
          rig.statusRingMat.color.setHex(0x10b981);
          rig.statusRingMat.emissive.setHex(0x059669);
        } else {
          rig.statusRingMat.color.setHex(0x94a3b8);
          rig.statusRingMat.emissive.setHex(0x475569);
        }
      });

      // Update ACO Swarm Communication Arcs
      const isSwarmMode = snap.environment.activeMode === 'swarm_pso_aco';
      swarmLinksGroup.visible = isSwarmMode;
      if (isSwarmMode) {
        linkArcs.forEach((arc, idx) => {
          const link = snap.links[idx];
          const w = link ? link.pheromoneWeight : 0.3;
          arc.mat.opacity = 0.25 + w * 0.65;
          arc.mat.emissiveIntensity = 0.35 + w * 0.9;
          const t = (elapsed * (0.45 + w * 0.8) + idx * 0.23) % 1;
          arc.curve.getPoint(t, arc.pulse.position);
          arc.pulse.visible = Boolean(link?.active);
        });
      }

      // Update Traffic Vehicles
      if (dt > 0) {
        for (const v of vehicles) {
          v.xPos += v.direction * v.speed * dt;
          if (v.xPos > 48) v.xPos = -48;
          if (v.xPos < -48) v.xPos = 48;
          v.group.position.x = v.xPos;
          const wheelRot = (v.speed * dt) / 0.32;
          for (const w of v.wheels) {
            w.rotation.z -= wheelRot;
          }
        }

        // Update Pedestrians walking along sidewalk
        for (const p of pedestrians) {
          p.phase += dt * p.speed;
          const dx = Math.sin(p.phase) * p.walkRadius;
          p.group.position.x = p.baseX + dx;
          p.group.rotation.y = Math.cos(p.phase) >= 0 ? Math.PI / 2 : -Math.PI / 2;
          const swing = Math.sin(p.phase * 4.5) * 0.38;
          p.leftLeg.rotation.x = swing;
          p.rightLeg.rotation.x = -swing;
          p.leftArm.rotation.x = -swing * 0.7;
          p.rightArm.rotation.x = swing * 0.7;
        }
      }

      // Scale visible pedestrians along sidewalk based on voice-estimated populationCount
      const visiblePedCount = Math.max(
        2,
        Math.min(pedestrians.length, Math.round((snap.populationCount / 160) * pedestrians.length))
      );
      const pedColorHex =
        snap.pedestrianAqi <= 50 ? 0x10b981 : snap.pedestrianAqi <= 100 ? 0xf59e0b : 0xef4444;
      pedestrians.forEach((p, idx) => {
        p.group.visible = idx < visiblePedCount;
        p.exposureRingMat.color.setHex(pedColorHex);
      });

      // Update InstancedMesh PM2.5 / NO2 Plume Particles
      const trafficFactor = Math.max(0.15, snap.environment.trafficPollution / 100);
      const windRad = (snap.environment.windAngleDeg * Math.PI) / 180;
      const windVx = Math.cos(windRad) * snap.environment.windSpeedMs * 1.4;
      const windVz = -Math.sin(windRad) * snap.environment.windSpeedMs * 1.1;

      const visibleParticleRatio = 0.25 + trafficFactor * 0.75;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const pt = particles[i];
        const isActiveSlot = i / PARTICLE_COUNT <= visibleParticleRatio;

        if (!isActiveSlot) {
          _dummy.position.set(0, -50, 0);
          _dummy.scale.setScalar(0.001);
          _dummy.updateMatrix();
          particleMesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }

        if (dt > 0) {
          pt.life += dt;
          if (pt.life >= pt.maxLife || Math.abs(pt.x) > 46 || pt.z < -18 || pt.z > 14) {
            // Respawn near a random moving vehicle exhaust
            const v = vehicles[i % vehicles.length];
            pt.x = v.xPos - v.direction * 1.8 + (Math.random() - 0.5) * 2.5;
            pt.y = 0.28 + Math.random() * 0.65;
            pt.z = v.laneZ + (Math.random() - 0.5) * 1.6;
            pt.vx = (Math.random() - 0.5) * 0.4;
            pt.vy = 0.12 + Math.random() * 0.25;
            pt.vz = -0.35 - Math.random() * 0.45;
            pt.life = 0;
            pt.maxLife = 5.5 + Math.random() * 4.5;
            pt.cleaned = 0;
          }

          // Drift with wind + slight upward buoyancy
          pt.x += (pt.vx + windVx) * dt;
          pt.y += pt.vy * dt;
          pt.z += (pt.vz + windVz) * dt;

          // Pull toward nearest active Bio-Solar Swarm Pod
          for (let pIdx = 0; pIdx < snap.nodes.length; pIdx++) {
            const node = snap.nodes[pIdx];
            if (node.fan_duty < 0.12) continue;
            const dx = node.position.x - pt.x;
            const dz = node.position.z - pt.z;
            const distSq = dx * dx + dz * dz;
            if (distSq < 38) {
              const dist = Math.sqrt(distSq) + 0.1;
              const pull = (node.fan_duty * 5.2 * dt) / (1 + dist * 0.4);
              pt.x += (dx / dist) * pull;
              pt.z += (dz / dist) * pull;
              if (dist < 1.8 && pt.y < 3.4) {
                pt.cleaned = Math.min(1, pt.cleaned + dt * 2.8);
                pt.y += dt * 1.2;
              }
            }
          }

          // If Centralized Tower active, weakly pull high-altitude particles toward remote tower
          if (towerOn && pt.y > 2.0) {
            const dx = snap.tower.position.x - pt.x;
            const dz = snap.tower.position.z - pt.z;
            const d = Math.hypot(dx, dz) + 0.5;
            if (d < 28) {
              pt.x += (dx / d) * dt * 2.2;
              pt.z += (dz / d) * dt * 2.2;
              pt.y += dt * 1.4;
              if (d < 4.5) pt.cleaned = Math.min(1, pt.cleaned + dt * 1.6);
            }
          }
        }

        const fade = 1 - Math.pow(pt.life / pt.maxLife, 2);
        const scale = Math.max(0.05, (0.7 + trafficFactor * 0.6) * fade * (1 - pt.cleaned * 0.45));
        _dummy.position.set(pt.x, pt.y, pt.z);
        _dummy.scale.setScalar(scale);
        _dummy.updateMatrix();
        particleMesh.setMatrixAt(i, _dummy.matrix);

        // Color transition: raw soot-amber/gray -> remediated fresh mist-emerald
        if (pt.cleaned > 0.35) {
          _color.setRGB(0.45, 0.85, 0.72);
        } else {
          const smogTone = 0.28 + (i % 5) * 0.04;
          _color.setRGB(smogTone + 0.12 * trafficFactor, smogTone + 0.03, smogTone - 0.04);
        }
        particleMesh.setColorAt(i, _color);
      }
      particleMesh.instanceMatrix.needsUpdate = true;
      if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.dispose();
      textures.dispose();
      envTexture.dispose();
      renderer.dispose();
      onCanvasReadyRef.current?.(null);
      if (cameraMatricesPropRef.current) {
        cameraMatricesPropRef.current.current = null;
      }
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [snapshotRef]);

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      <div
        ref={mountRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        data-testid="swarm-3d-viewport"
      />
      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#9AA7B4] text-[#1E293B]">
          <div className="bg-[#EEF2F6] border border-[#CBD5E1] rounded-lg px-6 py-4 text-sm font-medium">
            WebGL rendering context interrupted. Restoring 3D scene...
          </div>
        </div>
      )}
    </div>
  );
};
