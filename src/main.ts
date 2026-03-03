import './style.css';
import { SceneManager } from './scene/SceneManager';
import { TerrainMesh } from './terrain/TerrainMesh';
import { TerrainEditor, type ToolType } from './terrain/TerrainEditor';
import { HeightmapLoader } from './terrain/HeightmapLoader';
import { UndoManager } from './utils/UndoManager';
import { LayerExporter, type ExportOptions } from './layers/LayerExporter';
// Color presets are managed in the TerrainMesh module

// ─── App State ───
type AppMode = 'sculpt' | 'layers' | 'export';
let currentMode: AppMode = 'sculpt';
let explodedAmount = 0.5;

// ─── LocalStorage Persistence ───
const STORAGE_KEY = 'hipso-creator-state';

interface SavedState {
  heightData: number[];
  resolution: number;
  layerCount: number;
  presetKey: string;
  seaLevel: number;
  widthMM: number;
  depthMM: number;
  heightMM: number;
  thicknessMM: number;
  layerColors: string[];
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function saveState() {
  // Debounce — avoid excessive writes during sculpting
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const state: SavedState = {
        heightData: Array.from(terrain.heightData),
        resolution: terrain.resolution,
        layerCount: terrain.layerCount,
        presetKey: terrain.presetKey,
        seaLevel: terrain.seaLevel,
        widthMM: parseFloat((document.getElementById('cfg-width') as HTMLInputElement).value),
        depthMM: parseFloat((document.getElementById('cfg-depth') as HTMLInputElement).value),
        heightMM: parseFloat((document.getElementById('cfg-height') as HTMLInputElement).value),
        thicknessMM: parseFloat((document.getElementById('cfg-thickness') as HTMLInputElement).value),
        layerColors: [...terrain.layerColors],
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save state:', e);
    }
  }, 500);
}

function clearSavedState() {
  localStorage.removeItem(STORAGE_KEY);
}

function loadSavedState(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedState;
  } catch {
    return null;
  }
}

// ─── Init ───
const canvas = document.getElementById('canvas3d') as HTMLCanvasElement;
const scene = new SceneManager(canvas);
const terrain = new TerrainMesh(128);
scene.scene.add(terrain.mesh);

const editor = new TerrainEditor(terrain, scene.camera, canvas);
scene.scene.add(editor.cursorRing);

const undoManager = new UndoManager(50);
undoManager.push(new Float32Array(terrain.heightData));

const exporter = new LayerExporter(terrain);

// ─── Water Plane ───
import * as THREE from 'three';

const waterGeo = new THREE.PlaneGeometry(terrain.terrainSize * 1.3, terrain.terrainSize * 1.3);
waterGeo.rotateX(-Math.PI / 2);
const waterMat = new THREE.MeshStandardMaterial({
  color: 0x1a8fbd,
  transparent: true,
  opacity: 0.55,
  roughness: 0.15,
  metalness: 0.3,
  side: THREE.DoubleSide,
});
const waterPlane = new THREE.Mesh(waterGeo, waterMat);
waterPlane.position.y = -0.02; // hidden below terrain initially
waterPlane.visible = false;
scene.scene.add(waterPlane);

function updateWaterPlane() {
  const sl = terrain.seaLevel;
  if (sl > 0) {
    waterPlane.visible = true;
    waterPlane.position.y = sl * terrain.terrainHeightScale;
  } else {
    waterPlane.visible = false;
  }
}

// ─── Exploded View Layers ───
let explodedMeshes: THREE.Mesh[] = [];

function buildExplodedView() {
  // Remove old
  for (const m of explodedMeshes) {
    scene.scene.remove(m);
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  explodedMeshes = [];

  const n = terrain.layerCount;
  const res = terrain.resolution;

  for (let i = 0; i < n; i++) {
    const geo = new THREE.PlaneGeometry(terrain.terrainSize, terrain.terrainSize, res - 1, res - 1);
    geo.rotateX(-Math.PI / 2);

    const minH = i / n;
    const maxH = (i + 1) / n;
    const pos = geo.attributes.position;

    for (let v = 0; v < pos.count; v++) {
      const h = terrain.heightData[v] || 0;
      // Clamp height to this layer's range
      const clampedH = Math.max(minH, Math.min(maxH, h));
      const layerLocalH = (clampedH - minH) / (maxH - minH);
      pos.setY(v, layerLocalH * (terrain.terrainHeightScale / n));

      // Zero out areas below this layer
      if (h < minH) {
        pos.setY(v, 0);
      }
    }

    geo.computeVertexNormals();

    const color = new THREE.Color(terrain.layerColors[i] || '#888');
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.05,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Stack vertically with explosion gap
    const baseY = i * (terrain.terrainHeightScale / n);
    const gap = explodedAmount * 1.5;
    mesh.position.y = baseY + i * gap;

    explodedMeshes.push(mesh);
    scene.scene.add(mesh);
  }
}

function updateExplodedPositions() {
  const n = terrain.layerCount;
  for (let i = 0; i < explodedMeshes.length; i++) {
    const baseY = i * (terrain.terrainHeightScale / n);
    const gap = explodedAmount * 1.5;
    explodedMeshes[i].position.y = baseY + i * gap;
  }
}

// ─── Mode Switching ───
function setMode(mode: AppMode) {
  currentMode = mode;

  // Show/hide terrain mesh vs exploded view
  terrain.mesh.visible = mode === 'sculpt';
  editor.cursorRing.visible = mode === 'sculpt';
  waterPlane.visible = mode === 'sculpt' && terrain.seaLevel > 0;

  for (const m of explodedMeshes) {
    m.visible = mode === 'layers';
  }

  if (mode === 'layers') {
    buildExplodedView();
  }

  // Toggle orbit controls behavior
  if (mode === 'sculpt') {
    scene.controls.enableRotate = true;
    scene.controls.mouseButtons = {
      LEFT: undefined as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
  } else {
    scene.controls.enableRotate = true;
    scene.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
  }

  // UI buttons
  document.getElementById('btn-mode-sculpt')!.classList.toggle('toolbar__btn--active', mode === 'sculpt');
  document.getElementById('btn-mode-layers')!.classList.toggle('toolbar__btn--active', mode === 'layers');
  document.getElementById('btn-mode-export')!.classList.toggle('toolbar__btn--active', mode === 'export');

  // Panels
  document.getElementById('panel-left')!.style.display = mode === 'sculpt' ? 'flex' : 'none';
  const explodedSection = document.getElementById('exploded-section')!;
  explodedSection.style.display = mode === 'layers' ? 'block' : 'none';

  // Export modal
  if (mode === 'export') {
    showExportModal();
  } else {
    hideExportModal();
  }
}

// ─── UI Event Bindings ───

// Tool selection
document.querySelectorAll<HTMLButtonElement>('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('tool-btn--active'));
    btn.classList.add('tool-btn--active');
    editor.activeTool = btn.dataset.tool as ToolType;
  });
});

// Tool parameters
const radiusSlider = document.getElementById('tool-radius') as HTMLInputElement;
const strengthSlider = document.getElementById('tool-strength') as HTMLInputElement;
const falloffSelect = document.getElementById('tool-falloff') as HTMLSelectElement;
const valRadius = document.getElementById('val-radius')!;
const valStrength = document.getElementById('val-strength')!;

radiusSlider.addEventListener('input', () => {
  editor.radius = parseInt(radiusSlider.value);
  valRadius.textContent = radiusSlider.value;
});
strengthSlider.addEventListener('input', () => {
  editor.strength = parseInt(strengthSlider.value);
  valStrength.textContent = strengthSlider.value;
});
falloffSelect.addEventListener('change', () => {
  editor.falloff = falloffSelect.value as 'smooth' | 'linear' | 'sharp';
});

// Undo / Redo
const btnUndo = document.getElementById('btn-undo') as HTMLButtonElement;
const btnRedo = document.getElementById('btn-redo') as HTMLButtonElement;

editor.onModified = () => {
  undoManager.push(new Float32Array(terrain.heightData));
  updateUndoButtons();
  saveState();
};

function updateUndoButtons() {
  btnUndo.disabled = !undoManager.canUndo;
  btnRedo.disabled = !undoManager.canRedo;
}

btnUndo.addEventListener('click', () => {
  const data = undoManager.undo();
  if (data) {
    terrain.heightData.set(data);
    terrain.applyHeightData();
    updateUndoButtons();
  }
});

btnRedo.addEventListener('click', () => {
  const data = undoManager.redo();
  if (data) {
    terrain.heightData.set(data);
    terrain.applyHeightData();
    updateUndoButtons();
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    btnUndo.click();
  }
  if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
    e.preventDefault();
    btnRedo.click();
  }
});

// Views
document.getElementById('btn-view-perspective')!.addEventListener('click', () => {
  scene.setPerspectiveView();
  document.getElementById('btn-view-perspective')!.classList.add('toolbar__btn--active');
  document.getElementById('btn-view-top')!.classList.remove('toolbar__btn--active');
});
document.getElementById('btn-view-top')!.addEventListener('click', () => {
  scene.setTopView();
  document.getElementById('btn-view-top')!.classList.add('toolbar__btn--active');
  document.getElementById('btn-view-perspective')!.classList.remove('toolbar__btn--active');
});

// Modes
document.getElementById('btn-mode-sculpt')!.addEventListener('click', () => setMode('sculpt'));
document.getElementById('btn-mode-layers')!.addEventListener('click', () => setMode('layers'));
document.getElementById('btn-mode-export')!.addEventListener('click', () => setMode('export'));

// Reset
document.getElementById('btn-reset')!.addEventListener('click', () => {
  if (confirm('Czy na pewno chcesz zresetować teren?')) {
    terrain.heightData.fill(0);
    terrain.applyHeightData();
    undoManager.clear();
    undoManager.push(new Float32Array(terrain.heightData));
    updateUndoButtons();
    clearSavedState();
  }
});

// Import heightmap
document.getElementById('btn-import')!.addEventListener('click', () => {
  (document.getElementById('heightmap-input') as HTMLInputElement).click();
});

document.getElementById('heightmap-input')!.addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  if (!input.files?.length) return;
  const file = input.files[0];
  try {
    const data = await HeightmapLoader.load(file, terrain.resolution);
    terrain.heightData.set(data);
    terrain.applyHeightData();
    undoManager.push(new Float32Array(terrain.heightData));
    updateUndoButtons();
    saveState();
  } catch (err) {
    console.error('Failed to load heightmap:', err);
  }
  input.value = '';
});

// ─── Layer Panel ───
const cfgLayers = document.getElementById('cfg-layers') as HTMLInputElement;
const valLayers = document.getElementById('val-layers')!;
const cfgResolution = document.getElementById('cfg-resolution') as HTMLSelectElement;
const layerListEl = document.getElementById('layer-list')!;
const cfgWidth = document.getElementById('cfg-width') as HTMLInputElement;
const cfgDepth = document.getElementById('cfg-depth') as HTMLInputElement;
const cfgHeight = document.getElementById('cfg-height') as HTMLInputElement;
const cfgThickness = document.getElementById('cfg-thickness') as HTMLInputElement;

function rebuildLayerList() {
  layerListEl.innerHTML = '';
  const n = terrain.layerCount;
  const maxH = parseFloat((document.getElementById('cfg-height') as HTMLInputElement).value);

  for (let i = n - 1; i >= 0; i--) {
    const minHmm = ((i / n) * maxH).toFixed(1);
    const maxHmm = (((i + 1) / n) * maxH).toFixed(1);

    const item = document.createElement('div');
    item.className = 'layer-item';
    item.innerHTML = `
      <div class="layer-item__color" style="background:${terrain.layerColors[i]}; position:relative">
        <input type="color" class="layer-item__color-input" value="${terrain.layerColors[i]}" data-layer="${i}" />
      </div>
      <div class="layer-item__info">
        <div class="layer-item__name">Warstwa ${i + 1}</div>
        <div class="layer-item__range">${minHmm}–${maxHmm} mm</div>
      </div>
    `;

    // Color picker
    const colorDiv = item.querySelector('.layer-item__color') as HTMLElement;
    const colorInput = item.querySelector('.layer-item__color-input') as HTMLInputElement;
    colorDiv.addEventListener('click', () => colorInput.click());
    colorInput.addEventListener('input', () => {
      terrain.layerColors[i] = colorInput.value;
      colorDiv.style.background = colorInput.value;
      terrain.applyHeightData();
      saveState();
    });

    layerListEl.appendChild(item);
  }
}

cfgLayers.addEventListener('input', () => {
  const n = parseInt(cfgLayers.value);
  terrain.layerCount = n;
  valLayers.textContent = String(n);
  terrain.updateLayerColors();
  terrain.applyHeightData();
  rebuildLayerList();
  syncThicknessFromLayers();
  saveState();
});

// Preset selection
document.querySelectorAll<HTMLButtonElement>('.preset-btn[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('preset-btn--active'));
    btn.classList.add('preset-btn--active');
    terrain.presetKey = btn.dataset.preset!;
    terrain.updateLayerColors();
    terrain.applyHeightData();
    rebuildLayerList();
    saveState();
  });
});

// Resolution change
cfgResolution.addEventListener('change', () => {
  const r = parseInt(cfgResolution.value);
  terrain.rebuild(r);
  undoManager.clear();
  undoManager.push(new Float32Array(terrain.heightData));
  updateUndoButtons();
  (document.getElementById('status-verts')!).textContent = `Wierzchołki: ${(r * r).toLocaleString('pl-PL')}`;
  saveState();
});

// Sea level slider
const cfgSeaLevel = document.getElementById('cfg-sealevel') as HTMLInputElement;
const valSeaLevel = document.getElementById('val-sealevel')!;

cfgSeaLevel.addEventListener('input', () => {
  const val = parseInt(cfgSeaLevel.value);
  valSeaLevel.textContent = String(val);
  terrain.seaLevel = val / 100;
  terrain.applyHeightData();
  updateWaterPlane();
  rebuildLayerList();
  saveState();
});

// Exploded view slider
document.getElementById('cfg-explode')?.addEventListener('input', (e) => {
  const val = parseInt((e.target as HTMLInputElement).value);
  explodedAmount = val / 100;
  document.getElementById('val-explode')!.textContent = String(val);
  updateExplodedPositions();
});

// ─── Model Dimension Controls ───

/** Sync layer count from thickness: layerCount = floor(maxHeight / thickness) */
function syncLayersFromThickness() {
  const maxH = parseFloat(cfgHeight.value);
  const thick = parseFloat(cfgThickness.value);
  if (thick <= 0 || maxH <= 0) return;
  const n = Math.max(2, Math.min(20, Math.floor(maxH / thick)));
  cfgLayers.value = String(n);
  valLayers.textContent = String(n);
  terrain.layerCount = n;
  terrain.updateLayerColors();
  terrain.applyHeightData();
  rebuildLayerList();
}

/** Sync thickness from layer count: thickness = maxHeight / layerCount */
function syncThicknessFromLayers() {
  const maxH = parseFloat(cfgHeight.value);
  const n = terrain.layerCount;
  if (n <= 0) return;
  cfgThickness.value = (maxH / n).toFixed(1);
}

// Width / Depth → visual proportions via mesh.scale
function updateTerrainDimensions() {
  const w = parseFloat(cfgWidth.value);
  const d = parseFloat(cfgDepth.value);
  terrain.updateTerrainScale(w, d);
  // Scale water plane proportionally
  const maxDim = Math.max(w, d);
  waterPlane.scale.set(w / maxDim, 1, d / maxDim);
}

// Size presets (A4, A3, Square)
const SIZE_PRESETS: Record<string, [number, number]> = {
  a4: [210, 297],
  a3: [297, 420],
  square: [200, 200],
};

document.querySelectorAll<HTMLButtonElement>('.size-preset-btn[data-size]').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.size!;
    const preset = SIZE_PRESETS[key];
    if (!preset) return;

    // Update active state
    document.querySelectorAll('.size-preset-btn').forEach(b => b.classList.remove('size-preset-btn--active'));
    btn.classList.add('size-preset-btn--active');

    // Set values
    cfgWidth.value = String(preset[0]);
    cfgDepth.value = String(preset[1]);
    updateTerrainDimensions();
    rebuildLayerList();
    saveState();
  });
});

cfgWidth.addEventListener('input', () => {
  // Clear active preset when manual edit
  document.querySelectorAll('.size-preset-btn').forEach(b => b.classList.remove('size-preset-btn--active'));
  updateTerrainDimensions();
  saveState();
});
cfgDepth.addEventListener('input', () => {
  document.querySelectorAll('.size-preset-btn').forEach(b => b.classList.remove('size-preset-btn--active'));
  updateTerrainDimensions();
  saveState();
});

// Max height → terrain height scale (100mm default → 5 Three.js units)
cfgHeight.addEventListener('input', () => {
  const maxH = parseFloat(cfgHeight.value);
  terrain.terrainHeightScale = maxH / 20;
  terrain.applyHeightData();
  updateWaterPlane();
  syncLayersFromThickness();
  saveState();
});

// Layer thickness → sync layer count
cfgThickness.addEventListener('input', () => {
  syncLayersFromThickness();
  saveState();
});

// ─── Export Modal ───
function getExportOptions(): ExportOptions {
  return {
    format: (document.getElementById('export-format') as HTMLSelectElement).value as 'pdf' | 'png',
    paperSize: (document.getElementById('export-paper') as HTMLSelectElement).value as 'a4' | 'a3',
    scale: (document.getElementById('export-scale') as HTMLSelectElement).value as '1' | 'fit',
    showGrid: (document.getElementById('export-grid') as HTMLInputElement).checked,
    terrainWidthMM: parseFloat(cfgWidth.value),
    terrainDepthMM: parseFloat(cfgDepth.value),
    terrainHeightMM: parseFloat(cfgHeight.value),
    layerThicknessMM: parseFloat(cfgThickness.value),
  };
}

function showExportModal() {
  document.getElementById('export-modal')!.style.display = 'flex';
  updateExportPreview();
}
function hideExportModal() {
  document.getElementById('export-modal')!.style.display = 'none';
}

function updateExportPreview() {
  const previewCanvas = document.getElementById('export-canvas') as HTMLCanvasElement;
  const ctx = previewCanvas.getContext('2d')!;
  const opts = getExportOptions();
  exporter.drawLayerOnCanvas(ctx, previewCanvas.width, previewCanvas.height, 0, opts, false);
}

document.getElementById('export-close')!.addEventListener('click', () => {
  hideExportModal();
  setMode('sculpt');
});
document.querySelector('.modal__backdrop')?.addEventListener('click', () => {
  hideExportModal();
  setMode('sculpt');
});

document.getElementById('btn-export-go')!.addEventListener('click', async () => {
  const opts = getExportOptions();
  if (opts.format === 'pdf') {
    await exporter.exportPDF(opts);
  } else {
    await exporter.exportPNG(opts);
  }
});

// Update preview when options change
['export-format', 'export-paper', 'export-scale', 'export-grid'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', updateExportPreview);
});

// ─── Status Bar ───
const statusPos = document.getElementById('status-pos')!;
const statusHeight = document.getElementById('status-height')!;
const statusLayer = document.getElementById('status-layer')!;

// ─── Animation Loop ───
function animate() {
  requestAnimationFrame(animate);

  // Disable orbit when sculpting
  scene.controls.enableRotate = !editor.isSculpting || currentMode !== 'sculpt';

  scene.update();
  scene.render();

  // Update status bar
  if (currentMode === 'sculpt') {
    const info = editor.getCursorInfo();
    if (info) {
      const maxH = parseFloat((document.getElementById('cfg-height') as HTMLInputElement).value);
      statusPos.textContent = `X: ${info.wx.toFixed(1)} Z: ${info.wz.toFixed(1)}`;
      statusHeight.textContent = `H: ${(info.height * maxH).toFixed(1)}mm`;
      statusLayer.textContent = `Warstwa: ${info.layer}`;
    }
  }
}

// ─── Restore Saved State ───
const savedState = loadSavedState();
if (savedState) {
  // Resolution — must rebuild geometry if different
  if (savedState.resolution !== terrain.resolution) {
    terrain.rebuild(savedState.resolution);
    cfgResolution.value = String(savedState.resolution);
  }

  // Restore heightData
  terrain.heightData.set(new Float32Array(savedState.heightData));

  // Restore settings
  terrain.layerCount = savedState.layerCount;
  terrain.presetKey = savedState.presetKey;
  terrain.seaLevel = savedState.seaLevel;
  terrain.layerColors = savedState.layerColors;

  // Restore UI inputs
  cfgWidth.value = String(savedState.widthMM);
  cfgDepth.value = String(savedState.depthMM);
  cfgHeight.value = String(savedState.heightMM);
  cfgThickness.value = String(savedState.thicknessMM);
  cfgLayers.value = String(savedState.layerCount);
  valLayers.textContent = String(savedState.layerCount);
  (document.getElementById('cfg-sealevel') as HTMLInputElement).value = String(Math.round(savedState.seaLevel * 100));
  (document.getElementById('val-sealevel')!).textContent = String(Math.round(savedState.seaLevel * 100));

  // Restore height scale
  terrain.terrainHeightScale = savedState.heightMM / 20;

  // Apply to geometry
  terrain.applyHeightData();
  terrain.updateTerrainScale(savedState.widthMM, savedState.depthMM);
  updateWaterPlane();

  // Scale water plane
  const maxDim = Math.max(savedState.widthMM, savedState.depthMM);
  waterPlane.scale.set(savedState.widthMM / maxDim, 1, savedState.depthMM / maxDim);

  // Activate correct preset button
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('preset-btn--active'));
  const activePreset = document.querySelector(`.preset-btn[data-preset="${savedState.presetKey}"]`);
  activePreset?.classList.add('preset-btn--active');

  // Reinit undo
  undoManager.clear();
  undoManager.push(new Float32Array(terrain.heightData));
  updateUndoButtons();
}

// ─── Init UI ───
rebuildLayerList();
const initRes = parseInt(cfgResolution.value);
(document.getElementById('status-verts')!).textContent = `Wierzchołki: ${(initRes * initRes).toLocaleString('pl-PL')}`;

// Start
animate();
