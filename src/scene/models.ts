/**
 * Composite 3-12 Part Procedural 3D Models for Bio-Solar Swarm Digital Twin.
 * Every hero prop is a multi-part THREE.Group with varied roughness/metalness,
 * bottom-center ground pivot, and soft radial contact shadows.
 */

import * as THREE from 'three';
import { SceneTextureBundle } from './textures';

export interface SwarmPodRig {
  group: THREE.Group;
  nodeId: string;
  fanRotor: THREE.Group;
  algaeCoreMat: THREE.MeshStandardMaterial;
  colorimetricMat: THREE.MeshStandardMaterial;
  statusRingMat: THREE.MeshStandardMaterial;
  remediationCone: THREE.Mesh;
  remediationConeMat: THREE.MeshBasicMaterial;
  bubbles: THREE.Mesh[];
  hitbox: THREE.Mesh;
  selectionHalo: THREE.Mesh;
}

export interface CentralTowerRig {
  group: THREE.Group;
  turbineRotor: THREE.Group;
  exhaustPlume: THREE.Mesh;
  exhaustPlumeMat: THREE.MeshBasicMaterial;
  beaconMat: THREE.MeshStandardMaterial;
}

export interface VehicleRig {
  group: THREE.Group;
  laneZ: number;
  direction: 1 | -1;
  speed: number;
  xPos: number;
  wheels: THREE.Mesh[];
}

export interface PedestrianRig {
  group: THREE.Group;
  baseX: number;
  baseZ: number;
  walkRadius: number;
  phase: number;
  speed: number;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  exposureRingMat: THREE.MeshBasicMaterial;
}

export function buildSwarmPodModel(
  nodeId: string,
  textures: SceneTextureBundle,
  isSoftwareGl: boolean
): SwarmPodRig {
  const group = new THREE.Group();
  group.name = nodeId;

  // Shared calibrated PBR materials (roughness delta >= 0.25 across adjacent parts)
  const steelBaseMat = new THREE.MeshStandardMaterial({
    color: 0x4b5563,
    roughness: 0.35,
    metalness: 0.78,
    bumpMap: textures.metalBump,
    bumpScale: 0.015,
  });

  const matteHousingMat = new THREE.MeshStandardMaterial({
    color: 0xdce3ea,
    roughness: 0.76,
    metalness: 0.14,
  });

  const trimDarkMat = new THREE.MeshStandardMaterial({
    color: 0x2c3540,
    roughness: 0.42,
    metalness: 0.65,
  });

  // 0. Contact shadow disc grounded at y = 0.015
  const shadowPlane = new THREE.Mesh(
    new THREE.CircleGeometry(1.35, 24),
    new THREE.MeshBasicMaterial({
      map: textures.contactShadow,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.015;
  group.add(shadowPlane);

  // Selection highlight ring (shown when pod is selected)
  const selectionHalo = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.12, 32),
    new THREE.MeshBasicMaterial({
      color: 0x10b981,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
  );
  selectionHalo.rotation.x = -Math.PI / 2;
  selectionHalo.position.y = 0.025;
  selectionHalo.visible = false;
  group.add(selectionHalo);

  // 1. Turned Steel Base Plinth (LatheGeometry)
  const plinthPoints = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.76, 0.0),
    new THREE.Vector2(0.74, 0.12),
    new THREE.Vector2(0.58, 0.2),
    new THREE.Vector2(0.54, 0.32),
    new THREE.Vector2(0.0, 0.32),
  ];
  const plinthMesh = new THREE.Mesh(new THREE.LatheGeometry(plinthPoints, 24), steelBaseMat);
  plinthMesh.castShadow = true;
  plinthMesh.receiveShadow = true;
  group.add(plinthMesh);

  // 2. Lower Particulate Intake Louver & Pre-Filter Bay
  const intakeBay = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.54, 0.62, 24), matteHousingMat);
  intakeBay.position.y = 0.63;
  intakeBay.castShadow = true;
  intakeBay.receiveShadow = true;
  group.add(intakeBay);

  // Dark louver slots collar
  const louverCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.22, 24), trimDarkMat);
  louverCollar.position.y = 0.56;
  group.add(louverCollar);

  // 3. Rotating 6-Blade BLDC Intake Fan Rotor
  const fanRotor = new THREE.Group();
  fanRotor.position.y = 0.96;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 16), steelBaseMat);
  fanRotor.add(hub);
  const bladeGeo = new THREE.BoxGeometry(0.32, 0.02, 0.08);
  for (let b = 0; b < 6; b++) {
    const blade = new THREE.Mesh(bladeGeo, trimDarkMat);
    const angle = (b / 6) * Math.PI * 2;
    blade.position.set(Math.cos(angle) * 0.2, 0, Math.sin(angle) * 0.2);
    blade.rotation.y = -angle;
    blade.rotation.x = 0.38;
    fanRotor.add(blade);
  }
  group.add(fanRotor);

  // 4. Chemical Adsorption Bay (KMnO4-impregnated Carbon + Colorimetric RGB Window)
  const chemBay = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.49, 0.42, 24), trimDarkMat);
  chemBay.position.y = 1.18;
  chemBay.castShadow = true;
  group.add(chemBay);

  const colorimetricMat = new THREE.MeshStandardMaterial({
    color: 0x7e2894,
    emissive: 0x511a63,
    emissiveIntensity: 0.45,
    roughness: 0.25,
    metalness: 0.1,
  });
  const colorimetricStrip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.472, 0.472, 0.12, 24, 1, true),
    colorimetricMat
  );
  colorimetricStrip.position.y = 1.18;
  group.add(colorimetricStrip);

  // 5. Tubular Microalgal Photobioreactor (PBR): Inner Living Algae Culture + Outer Glass Tube
  const algaeCoreMat = new THREE.MeshStandardMaterial({
    color: 0x26a96c,
    emissive: 0x16784a,
    emissiveIntensity: 0.55,
    roughness: 0.28,
    metalness: 0.05,
  });
  const algaeCore = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.38, 24), algaeCoreMat);
  algaeCore.position.y = 2.08;
  group.add(algaeCore);

  // Rising O2 / sparged CO2 micro-bubbles inside PBR annular zone
  const bubbles: THREE.Mesh[] = [];
  const bubbleGeo = new THREE.SphereGeometry(0.032, 8, 8);
  const bubbleMat = new THREE.MeshStandardMaterial({
    color: 0xd1fae5,
    emissive: 0x6ee7b7,
    emissiveIntensity: 0.7,
    roughness: 0.1,
  });
  for (let i = 0; i < 10; i++) {
    const bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
    const angle = (i / 10) * Math.PI * 2;
    bubble.position.set(Math.cos(angle) * 0.35, 1.48 + (i % 5) * 0.25, Math.sin(angle) * 0.35);
    bubble.userData.angle = angle;
    bubble.userData.offset = i * 0.21;
    group.add(bubble);
    bubbles.push(bubble);
  }

  // Outer Borosilicate Glass Vessel (depthWrite: false + renderOrder: 2 for crisp interior)
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xe6f6ef,
    roughness: 0.08,
    metalness: 0.0,
    transmission: isSoftwareGl ? 0 : 0.88,
    transparent: true,
    opacity: isSoftwareGl ? 0.38 : 1.0,
    ior: 1.5,
    thickness: 0.25,
    clearcoat: 1.0,
    depthWrite: false,
  });
  const pbrGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.46, 24), glassMat);
  pbrGlass.position.y = 2.08;
  pbrGlass.renderOrder = 2;
  group.add(pbrGlass);

  // Structural anodized vertical tie-rods framing the PBR
  const rodGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.48, 8);
  for (let r = 0; r < 3; r++) {
    const angle = (r / 3) * Math.PI * 2 + 0.4;
    const rod = new THREE.Mesh(rodGeo, steelBaseMat);
    rod.position.set(Math.cos(angle) * 0.45, 2.08, Math.sin(angle) * 0.45);
    group.add(rod);
  }

  // 6. Top ESP32 Controller + IEEE 1451 Smart Transducer Sensor Crown + Status Ring
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.46, 0.32, 24), matteHousingMat);
  crown.position.y = 2.96;
  crown.castShadow = true;
  group.add(crown);

  const statusRingMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    emissive: 0x10b981,
    emissiveIntensity: 0.85,
    roughness: 0.2,
  });
  const statusRing = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.032, 10, 28), statusRingMat);
  statusRing.rotation.x = Math.PI / 2;
  statusRing.position.y = 2.98;
  group.add(statusRing);

  // Upstream & Downstream Optical Sensor Probes
  const probeGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.28, 10);
  const probeIn = new THREE.Mesh(probeGeo, trimDarkMat);
  probeIn.rotation.z = Math.PI / 2;
  probeIn.position.set(0.56, 0.85, 0);
  group.add(probeIn);

  const probeOut = new THREE.Mesh(probeGeo, trimDarkMat);
  probeOut.rotation.z = Math.PI / 2;
  probeOut.position.set(-0.56, 2.95, 0);
  group.add(probeOut);

  // 7. Articulated Solar Mast & 50 W Bifacial PV Wing
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 1.05, 12), steelBaseMat);
  mast.position.set(0, 3.62, -0.12);
  mast.castShadow = true;
  group.add(mast);

  const pvGroup = new THREE.Group();
  pvGroup.position.set(0, 4.18, -0.05);
  pvGroup.rotation.x = 0.42; // Tilted toward urban sky/sun

  const pvFrame = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.05, 1.12), steelBaseMat);
  pvFrame.castShadow = true;
  pvGroup.add(pvFrame);

  const pvCells = new THREE.Mesh(
    new THREE.PlaneGeometry(1.62, 1.02),
    new THREE.MeshStandardMaterial({
      map: textures.solarPanelAlbedo,
      color: 0xffffff,
      roughness: 0.18,
      metalness: 0.55,
      side: THREE.DoubleSide,
    })
  );
  pvCells.rotation.x = -Math.PI / 2;
  pvCells.position.y = 0.028;
  pvGroup.add(pvCells);
  group.add(pvGroup);

  // 8. Clean-air outlet plume. It widens above the pod to make treated airflow visible.
  const remediationConeMat = new THREE.MeshBasicMaterial({
    color: 0x2dd4bf,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const remediationCone = new THREE.Mesh(
    new THREE.CylinderGeometry(1.45, 0.38, 2.85, 24, 1, true),
    remediationConeMat
  );
  remediationCone.position.set(0, 2.35, 0.5);
  remediationCone.rotation.x = -0.06;
  remediationCone.renderOrder = 3;
  group.add(remediationCone);

  // 9. Invisible Simplified Raycast Hitbox (Layer 1)
  const hitbox = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 0.95, 4.5, 12),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitbox.position.y = 2.25;
  hitbox.layers.set(1);
  hitbox.userData.nodeId = nodeId;
  group.add(hitbox);

  return {
    group,
    nodeId,
    fanRotor,
    algaeCoreMat,
    colorimetricMat,
    statusRingMat,
    remediationCone,
    remediationConeMat,
    bubbles,
    hitbox,
    selectionHalo,
  };
}

export function buildCentralTowerModel(textures: SceneTextureBundle): CentralTowerRig {
  const group = new THREE.Group();
  group.name = 'CENTRAL_AIR_TOWER';

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.82,
    metalness: 0.12,
  });
  const alloyMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.34,
    metalness: 0.72,
    bumpMap: textures.metalBump,
    bumpScale: 0.02,
  });

  // Contact shadow
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 24),
    new THREE.MeshBasicMaterial({
      map: textures.contactShadow,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  // 1. Stepped octagonal plinth
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 1.4, 8), concreteMat);
  plinth.position.y = 0.7;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  // 2. Main fluted vertical shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 2.0, 13.5, 12), alloyMat);
  shaft.position.y = 8.15;
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  group.add(shaft);

  // 3. Intake louver rings
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.72, 1.72, 0.65, 16), concreteMat);
    ring.position.y = 12.2 + i * 1.1;
    group.add(ring);
  }

  // 4. Turbine crown shroud
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.55, 1.6, 16), alloyMat);
  crown.position.y = 15.6;
  crown.castShadow = true;
  group.add(crown);

  // 5. Spinning turbine rotor
  const turbineRotor = new THREE.Group();
  turbineRotor.position.y = 16.45;
  const bladeGeo = new THREE.BoxGeometry(2.6, 0.08, 0.35);
  for (let b = 0; b < 4; b++) {
    const blade = new THREE.Mesh(bladeGeo, concreteMat);
    blade.rotation.y = (b / 4) * Math.PI;
    turbineRotor.add(blade);
  }
  group.add(turbineRotor);

  // 6. Status beacon
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });
  const beacon = new THREE.Mesh(new THREE.TorusGeometry(1.88, 0.12, 10, 28), beaconMat);
  beacon.rotation.x = Math.PI / 2;
  beacon.position.y = 16.35;
  group.add(beacon);

  // 7. Tall vertical exhaust plume (visible when centralized tower active)
  const exhaustPlumeMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const exhaustPlume = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 1.35, 9.0, 20, 1, true),
    exhaustPlumeMat
  );
  exhaustPlume.position.y = 20.9;
  group.add(exhaustPlume);

  return {
    group,
    turbineRotor,
    exhaustPlume,
    exhaustPlumeMat,
    beaconMat,
  };
}

export function buildUrbanVehicle(
  variant: 'sedan' | 'bus' | 'van',
  bodyColorHex: number,
  textures: SceneTextureBundle
): VehicleRig {
  const group = new THREE.Group();
  const wheels: THREE.Mesh[] = [];

  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColorHex,
    roughness: 0.32,
    metalness: 0.45,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.12,
    metalness: 0.75,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x1f242b,
    roughness: 0.85,
    metalness: 0.05,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.25,
    metalness: 0.85,
  });

  const length = variant === 'bus' ? 6.6 : variant === 'van' ? 4.4 : 3.9;
  const width = variant === 'bus' ? 2.1 : 1.75;
  const chassisH = variant === 'bus' ? 1.9 : variant === 'van' ? 1.45 : 0.68;

  // Contact shadow
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(length * 1.12, width * 1.25),
    new THREE.MeshBasicMaterial({
      map: textures.contactShadow,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.018;
  group.add(shadow);

  // Main chassis
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(length, chassisH, width), bodyMat);
  chassis.position.y = 0.32 + chassisH / 2;
  chassis.castShadow = true;
  group.add(chassis);

  // Upper cabin / windows
  if (variant === 'sedan') {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.56, width * 0.88), glassMat);
    cabin.position.set(-0.15, 0.32 + chassisH + 0.26, 0);
    cabin.castShadow = true;
    group.add(cabin);
  } else {
    const windowStrip = new THREE.Mesh(
      new THREE.BoxGeometry(length * 0.88, chassisH * 0.42, width + 0.03),
      glassMat
    );
    windowStrip.position.set(0.1, 0.32 + chassisH * 0.68, 0);
    group.add(windowStrip);
  }

  // Headlights & Taillights
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    emissive: 0xfde68a,
    emissiveIntensity: 0.6,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 0.55,
  });
  const lightGeo = new THREE.BoxGeometry(0.08, 0.16, 0.26);
  for (const zSign of [-1, 1]) {
    const hl = new THREE.Mesh(lightGeo, headMat);
    hl.position.set(length / 2 + 0.01, 0.62, zSign * (width * 0.34));
    group.add(hl);
    const tl = new THREE.Mesh(lightGeo, tailMat);
    tl.position.set(-length / 2 - 0.01, 0.62, zSign * (width * 0.34));
    group.add(tl);
  }

  // 4 Wheels (radius 0.32, grounded at y = 0)
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 16);
  wheelGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.24, 12);
  rimGeo.rotateX(Math.PI / 2);

  const xAxles = variant === 'bus' ? [-2.1, 2.0] : [-1.2, 1.2];
  for (const ax of xAxles) {
    for (const wz of [-width / 2 - 0.02, width / 2 + 0.02]) {
      const wheel = new THREE.Mesh(wheelGeo, tireMat);
      wheel.position.set(ax, 0.32, wz);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      wheel.add(rim);
      group.add(wheel);
      wheels.push(wheel);
    }
  }

  return {
    group,
    laneZ: 0,
    direction: 1,
    speed: 6,
    xPos: 0,
    wheels,
  };
}

export function buildPedestrian(
  shirtColor: number,
  pantsColor: number,
  textures: SceneTextureBundle
): PedestrianRig {
  const group = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a98b, roughness: 0.65 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.78 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.85 });

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.38, 16),
    new THREE.MeshBasicMaterial({
      map: textures.contactShadow,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  group.add(shadow);

  // Subtle exposure ring around pedestrian feet
  const exposureRingMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const exposureRing = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 20), exposureRingMat);
  exposureRing.rotation.x = -Math.PI / 2;
  exposureRing.position.y = 0.022;
  group.add(exposureRing);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.56, 0.22), shirtMat);
  torso.position.y = 1.06;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 12), skinMat);
  head.position.y = 1.52;
  head.castShadow = true;
  group.add(head);

  const legGeo = new THREE.BoxGeometry(0.13, 0.72, 0.14);
  legGeo.translate(0, -0.36, 0);
  const leftLeg = new THREE.Mesh(legGeo, pantsMat);
  leftLeg.position.set(0, 0.78, -0.08);
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, pantsMat);
  rightLeg.position.set(0, 0.78, 0.08);
  group.add(rightLeg);

  const armGeo = new THREE.BoxGeometry(0.1, 0.48, 0.1);
  armGeo.translate(0, -0.22, 0);
  const leftArm = new THREE.Mesh(armGeo, shirtMat);
  leftArm.position.set(0, 1.3, -0.18);
  group.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, shirtMat);
  rightArm.position.set(0, 1.3, 0.18);
  group.add(rightArm);

  return {
    group,
    baseX: 0,
    baseZ: -5.6,
    walkRadius: 3.5,
    phase: 0,
    speed: 1.1,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    exposureRingMat,
  };
}

export function buildStreetTree(textures: SceneTextureBundle): THREE.Group {
  const group = new THREE.Group();

  const barkMat = new THREE.MeshStandardMaterial({ color: 0x5c4636, roughness: 0.92, metalness: 0.02 });
  const leafMatA = new THREE.MeshStandardMaterial({ color: 0x457554, roughness: 0.76, metalness: 0.04 });
  const leafMatB = new THREE.MeshStandardMaterial({ color: 0x568a65, roughness: 0.72, metalness: 0.04 });

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.75, 18),
    new THREE.MeshBasicMaterial({
      map: textures.contactShadow,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  group.add(shadow);

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 10), barkMat);
  trunk.position.y = 1.1;
  trunk.castShadow = true;
  group.add(trunk);

  const canopy1 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 2), leafMatA);
  canopy1.position.set(0, 3.05, 0);
  canopy1.scale.set(1.05, 0.92, 1.05);
  canopy1.castShadow = true;
  group.add(canopy1);

  const canopy2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 2), leafMatB);
  canopy2.position.set(0.55, 3.65, 0.35);
  canopy2.castShadow = true;
  group.add(canopy2);

  const canopy3 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.88, 2), leafMatB);
  canopy3.position.set(-0.55, 3.5, -0.3);
  canopy3.castShadow = true;
  group.add(canopy3);

  return group;
}
