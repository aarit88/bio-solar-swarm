/**
 * Procedural CanvasTexture Generators for Bio-Solar Swarm 3D Urban Scene.
 * Zero external image dependencies (zero 404s). Proper SRGBColorSpace for color maps.
 */

import * as THREE from 'three';

export interface SceneTextureBundle {
  roadAlbedo: THREE.CanvasTexture;
  sidewalkAlbedo: THREE.CanvasTexture;
  solarPanelAlbedo: THREE.CanvasTexture;
  buildingFacades: THREE.CanvasTexture[];
  metalBump: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  dispose: () => void;
}

export function createSceneTextureBundle(maxAnisotropy: number): SceneTextureBundle {
  const aniso = Math.max(1, Math.min(8, maxAnisotropy));

  const roadAlbedo = createAsphaltRoadTexture(aniso);
  const sidewalkAlbedo = createSidewalkTexture(aniso);
  const solarPanelAlbedo = createSolarPanelTexture(aniso);
  const buildingFacades = [
    createBuildingFacadeTexture('#687482', '#95A7B8', aniso),
    createBuildingFacadeTexture('#79838E', '#A8B7C5', aniso),
    createBuildingFacadeTexture('#5B6673', '#8CA0B3', aniso),
  ];
  const metalBump = createMetalMicroBumpTexture(aniso);
  const contactShadow = createContactShadowTexture();

  return {
    roadAlbedo,
    sidewalkAlbedo,
    solarPanelAlbedo,
    buildingFacades,
    metalBump,
    contactShadow,
    dispose: () => {
      roadAlbedo.dispose();
      sidewalkAlbedo.dispose();
      solarPanelAlbedo.dispose();
      buildingFacades.forEach((t) => t.dispose());
      metalBump.dispose();
      contactShadow.dispose();
    },
  };
}

function createAsphaltRoadTexture(anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Moderate mid-tone asphalt base
  ctx.fillStyle = '#3F464F';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle aggregate mineral speckle
  for (let i = 0; i < 6000; i++) {
    const x = (i * 73) % 512;
    const y = (i * 137) % 512;
    const v = 54 + ((i * 29) % 28);
    ctx.fillStyle = `rgb(${v},${v + 3},${v + 7})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Subtle curb edges
  ctx.fillStyle = '#57606B';
  ctx.fillRect(0, 0, 512, 16);
  ctx.fillRect(0, 496, 512, 16);

  // Double yellow median line
  ctx.fillStyle = '#D9A738';
  ctx.fillRect(0, 248, 512, 5);
  ctx.fillRect(0, 259, 512, 5);

  // Dashed lane markers
  ctx.fillStyle = '#CBD5E1';
  for (let x = 24; x < 512; x += 96) {
    ctx.fillRect(x, 126, 48, 4);
    ctx.fillRect(x, 382, 48, 4);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(8, 1);
  tex.anisotropy = anisotropy;
  return tex;
}

function createSidewalkTexture(anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#9AA3AE';
  ctx.fillRect(0, 0, 256, 256);

  // Paver grid
  ctx.strokeStyle = '#7E8792';
  ctx.lineWidth = 2;
  const step = 64;
  for (let x = 0; x <= 256; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  for (let y = 0; y <= 256; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }

  // Subtle tonal variance per paver
  for (let gx = 0; gx < 4; gx++) {
    for (let gy = 0; gy < 4; gy++) {
      const shade = ((gx * 3 + gy * 7) % 5) * 3;
      ctx.fillStyle = `rgba(255,255,255,${shade / 255})`;
      ctx.fillRect(gx * 64 + 2, gy * 64 + 2, 60, 60);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(22, 4);
  tex.anisotropy = anisotropy;
  return tex;
}

function createSolarPanelTexture(anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#1B2D45';
  ctx.fillRect(0, 0, 256, 256);

  // Monocrystalline silicon cell grid (6x8)
  const cols = 6;
  const rows = 8;
  const cw = 256 / cols;
  const ch = 256 / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw;
      const y = r * ch;
      ctx.fillStyle = (r + c) % 2 === 0 ? '#1E3350' : '#192B44';
      ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);

      // Fine silver busbars
      ctx.fillStyle = 'rgba(203, 213, 225, 0.35)';
      ctx.fillRect(x + cw * 0.33, y + 2, 1, ch - 4);
      ctx.fillRect(x + cw * 0.66, y + 2, 1, ch - 4);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

function createBuildingFacadeTexture(
  wallColor: string,
  windowColor: string,
  anisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = wallColor;
  ctx.fillRect(0, 0, 256, 512);

  // Architectural floor bands and recessed windows
  const cols = 4;
  const rows = 10;
  const padX = 12;
  const padY = 10;
  const cellW = 256 / cols;
  const cellH = 512 / rows;

  for (let r = 0; r < rows; r++) {
    // Subtle concrete spandrel band
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, r * cellH, 256, 5);

    for (let c = 0; c < cols; c++) {
      const wx = c * cellW + padX;
      const wy = r * cellH + padY;
      const ww = cellW - padX * 2;
      const wh = cellH - padY * 1.8;

      // Window frame
      ctx.fillStyle = '#434D59';
      ctx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);

      // Reflective glass tint
      const warmLit = (r * 7 + c * 11) % 5 === 0;
      ctx.fillStyle = warmLit ? '#C8C5B4' : windowColor;
      ctx.fillRect(wx, wy, ww, wh);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

function createMetalMicroBumpTexture(anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y++) {
    const tone = 112 + ((y * 17) % 32);
    ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
    ctx.fillRect(0, y, 128, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(20, 26, 33, 0.58)');
  grad.addColorStop(0.55, 'rgba(20, 26, 33, 0.24)');
  grad.addColorStop(1, 'rgba(20, 26, 33, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}
