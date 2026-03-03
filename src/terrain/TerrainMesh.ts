import * as THREE from 'three';
import { interpolateColors } from '../utils/ColorPresets';

export class TerrainMesh {
    public mesh: THREE.Mesh;
    public geometry: THREE.PlaneGeometry;

    /** Width in Three.js units (normalized) */
    public terrainSize = 10;
    /** How tall the tallest point is in Three.js units */
    public terrainHeightScale = 5;
    /** Grid resolution (vertices per side) */
    public resolution: number;

    /** Raw heightmap values in range [0, 1] */
    public heightData: Float32Array;

    /** Current layer colors */
    public layerColors: string[] = [];
    public layerCount = 8;
    public presetKey = 'classic';

    /** Sea level as fraction of total height [0, 1]. 0 = no water. */
    public seaLevel = 0;

    /** Water colors */
    private waterDeep = new THREE.Color('#0A3D62');
    private waterShallow = new THREE.Color('#48CAE4');

    constructor(resolution = 128) {
        this.resolution = resolution;
        this.heightData = new Float32Array(resolution * resolution);

        // Create geometry — PlaneGeometry in XZ plane
        this.geometry = new THREE.PlaneGeometry(
            this.terrainSize,
            this.terrainSize,
            resolution - 1,
            resolution - 1
        );
        // Rotate so it's flat on XZ
        this.geometry.rotateX(-Math.PI / 2);

        // Material — vertex colors
        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            flatShading: false,
            roughness: 0.8,
            metalness: 0.05,
            side: THREE.DoubleSide,
        });

        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.receiveShadow = true;
        this.mesh.castShadow = true;

        // Initialize colors
        this.updateLayerColors();
        this.applyHeightData();
    }

    /** Update layer colors from preset */
    updateLayerColors() {
        this.layerColors = interpolateColors(this.presetKey, this.layerCount);
    }

    /** Apply heightData to geometry vertices and colors */
    applyHeightData() {
        const pos = this.geometry.attributes.position;
        const count = pos.count;
        const colors = new Float32Array(count * 3);
        const sl = this.seaLevel;

        for (let i = 0; i < count; i++) {
            const h = this.heightData[i] || 0;
            // Set Y position based on height
            pos.setY(i, h * this.terrainHeightScale);

            let color: THREE.Color;

            if (sl > 0 && h < sl) {
                // Underwater — blend between deep and shallow blue
                const depth = sl > 0 ? Math.max(0, Math.min(1, h / sl)) : 0;
                color = this.waterDeep.clone().lerp(this.waterShallow, depth);
            } else {
                // Above sea level — map to land layers
                const landRange = 1 - sl;
                const landH = landRange > 0 ? (h - sl) / landRange : 0;
                const layerIdx = Math.min(
                    Math.floor(Math.max(0, landH) * this.layerCount),
                    this.layerCount - 1
                );
                color = new THREE.Color(this.layerColors[layerIdx] || '#888888');
            }

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        pos.needsUpdate = true;
        this.geometry.computeVertexNormals();
        this.geometry.computeBoundingSphere();
    }

    /** Get height at grid coordinate */
    getHeight(gx: number, gy: number): number {
        if (gx < 0 || gx >= this.resolution || gy < 0 || gy >= this.resolution) return 0;
        return this.heightData[gy * this.resolution + gx];
    }

    /** Set height at grid coordinate (clamped 0-1) */
    setHeight(gx: number, gy: number, value: number) {
        if (gx < 0 || gx >= this.resolution || gy < 0 || gy >= this.resolution) return;
        this.heightData[gy * this.resolution + gx] = Math.max(0, Math.min(1, value));
    }

    /** Convert world XZ position to grid coordinates */
    worldToGrid(wx: number, wz: number): [number, number] {
        const half = this.terrainSize / 2;
        const gx = Math.round(((wx + half) / this.terrainSize) * (this.resolution - 1));
        const gy = Math.round(((wz + half) / this.terrainSize) * (this.resolution - 1));
        return [gx, gy];
    }

    /** Convert grid coordinates to world position */
    gridToWorld(gx: number, gy: number): [number, number] {
        const half = this.terrainSize / 2;
        const wx = (gx / (this.resolution - 1)) * this.terrainSize - half;
        const wz = (gy / (this.resolution - 1)) * this.terrainSize - half;
        return [wx, wz];
    }

    /** Rebuild geometry when resolution changes */
    rebuild(newResolution: number) {
        const oldData = this.heightData;
        const oldRes = this.resolution;
        this.resolution = newResolution;
        this.heightData = new Float32Array(newResolution * newResolution);

        // Resample old data to new resolution
        for (let y = 0; y < newResolution; y++) {
            for (let x = 0; x < newResolution; x++) {
                const srcX = (x / (newResolution - 1)) * (oldRes - 1);
                const srcY = (y / (newResolution - 1)) * (oldRes - 1);
                const sx = Math.floor(srcX);
                const sy = Math.floor(srcY);
                const fx = srcX - sx;
                const fy = srcY - sy;
                const sx1 = Math.min(sx + 1, oldRes - 1);
                const sy1 = Math.min(sy + 1, oldRes - 1);

                const v00 = oldData[sy * oldRes + sx];
                const v10 = oldData[sy * oldRes + sx1];
                const v01 = oldData[sy1 * oldRes + sx];
                const v11 = oldData[sy1 * oldRes + sx1];
                this.heightData[y * newResolution + x] =
                    v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
            }
        }

        // Recreate geometry
        this.geometry.dispose();
        this.geometry = new THREE.PlaneGeometry(
            this.terrainSize,
            this.terrainSize,
            newResolution - 1,
            newResolution - 1
        );
        this.geometry.rotateX(-Math.PI / 2);
        this.mesh.geometry = this.geometry;
        this.applyHeightData();
    }

    /** Resize terrain proportions visually (scale-based, no geometry rebuild) */
    updateTerrainScale(widthMM: number, depthMM: number) {
        const maxDim = Math.max(widthMM, depthMM);
        const scaleX = widthMM / maxDim;
        const scaleZ = depthMM / maxDim;
        this.mesh.scale.set(scaleX, 1, scaleZ);
    }

    dispose() {
        this.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }
}
