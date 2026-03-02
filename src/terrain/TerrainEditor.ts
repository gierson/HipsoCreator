import * as THREE from 'three';
import { TerrainMesh } from './TerrainMesh';
import type { FalloffType } from '../utils/ColorPresets';

export type ToolType = 'raise' | 'lower' | 'smooth' | 'flatten' | 'plateau';

export class TerrainEditor {
    public activeTool: ToolType = 'raise';
    public radius = 15;      // in grid cells
    public strength = 30;    // 1-100
    public falloff: FalloffType = 'smooth';

    private terrain: TerrainMesh;
    private raycaster: THREE.Raycaster;
    private mouse: THREE.Vector2;
    private isMouseDown = false;
    private camera: THREE.Camera;

    /** Visual cursor ring on terrain */
    public cursorRing: THREE.Mesh;
    private cursorVisible = false;

    /** Callback when terrain is modified */
    public onModified?: () => void;

    constructor(terrain: TerrainMesh, camera: THREE.Camera, canvas: HTMLCanvasElement) {
        this.terrain = terrain;
        this.camera = camera;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Cursor ring
        const ringGeo = new THREE.RingGeometry(0.8, 1.0, 48);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xd4a574,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
            depthTest: false,
        });
        this.cursorRing = new THREE.Mesh(ringGeo, ringMat);
        this.cursorRing.visible = false;

        // Events
        canvas.addEventListener('mousemove', (e) => this.onMouseMove(e, canvas));
        canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        canvas.addEventListener('mouseup', () => this.onMouseUp());
        canvas.addEventListener('mouseleave', () => {
            this.cursorRing.visible = false;
            this.cursorVisible = false;
        });
    }

    private onMouseMove(e: MouseEvent, canvas: HTMLCanvasElement) {
        const rect = canvas.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.updateCursor();

        if (this.isMouseDown && !e.altKey) {
            this.applyTool();
        }
    }

    private onMouseDown(e: MouseEvent) {
        if (e.button !== 0 || e.altKey) return;
        this.isMouseDown = true;
        this.applyTool();
    }

    private onMouseUp() {
        if (this.isMouseDown) {
            this.isMouseDown = false;
            this.onModified?.();
        }
    }

    private updateCursor() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const hits = this.raycaster.intersectObject(this.terrain.mesh);

        if (hits.length > 0) {
            const p = hits[0].point;
            this.cursorRing.position.set(p.x, p.y + 0.05, p.z);

            // Scale ring to match radius in world space
            const worldRadius = (this.radius / this.terrain.resolution) * this.terrain.terrainSize;
            this.cursorRing.scale.setScalar(worldRadius);
            this.cursorRing.visible = true;
            this.cursorVisible = true;
        } else {
            this.cursorRing.visible = false;
            this.cursorVisible = false;
        }
    }

    /** Get point info at current cursor position (for status bar) */
    getCursorInfo(): { wx: number; wz: number; height: number; layer: number } | null {
        if (!this.cursorVisible) return null;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const hits = this.raycaster.intersectObject(this.terrain.mesh);
        if (hits.length === 0) return null;

        const p = hits[0].point;
        const [gx, gy] = this.terrain.worldToGrid(p.x, p.z);
        const h = this.terrain.getHeight(gx, gy);
        const layer = Math.min(
            Math.floor(h * this.terrain.layerCount),
            this.terrain.layerCount - 1
        );
        return { wx: p.x, wz: p.z, height: h, layer: layer + 1 };
    }

    private applyTool() {
        if (!this.cursorVisible) return;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const hits = this.raycaster.intersectObject(this.terrain.mesh);
        if (hits.length === 0) return;

        const p = hits[0].point;
        const [cx, cy] = this.terrain.worldToGrid(p.x, p.z);
        const r = this.radius;
        const str = (this.strength / 100) * 0.02; // Normalized strength per frame

        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                const gx = cx + dx;
                const gy = cy + dy;
                if (gx < 0 || gx >= this.terrain.resolution || gy < 0 || gy >= this.terrain.resolution) continue;

                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > r) continue;

                const falloffFactor = this.getFalloff(dist / r);
                const currentH = this.terrain.getHeight(gx, gy);

                let newH = currentH;
                switch (this.activeTool) {
                    case 'raise':
                        newH = currentH + str * falloffFactor;
                        break;
                    case 'lower':
                        newH = currentH - str * falloffFactor;
                        break;
                    case 'smooth':
                        newH = this.smoothAt(gx, gy, falloffFactor * str * 10);
                        break;
                    case 'flatten': {
                        const centerH = this.terrain.getHeight(cx, cy);
                        newH = currentH + (centerH - currentH) * falloffFactor * str * 5;
                        break;
                    }
                    case 'plateau': {
                        const plateauH = this.terrain.getHeight(cx, cy);
                        if (Math.abs(currentH - plateauH) < str * falloffFactor * 2) {
                            newH = plateauH;
                        } else {
                            newH = currentH + (plateauH - currentH) * falloffFactor * str * 8;
                        }
                        break;
                    }
                }
                this.terrain.setHeight(gx, gy, newH);
            }
        }

        this.terrain.applyHeightData();
    }

    private smoothAt(gx: number, gy: number, factor: number): number {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = gx + dx;
                const ny = gy + dy;
                if (nx >= 0 && nx < this.terrain.resolution && ny >= 0 && ny < this.terrain.resolution) {
                    sum += this.terrain.getHeight(nx, ny);
                    count++;
                }
            }
        }
        const avg = sum / count;
        const current = this.terrain.getHeight(gx, gy);
        return current + (avg - current) * Math.min(factor, 1);
    }

    private getFalloff(t: number): number {
        // t is 0 at center, 1 at edge
        switch (this.falloff) {
            case 'linear':
                return 1 - t;
            case 'smooth':
                return Math.cos(t * Math.PI) * 0.5 + 0.5;
            case 'sharp':
                return (1 - t) * (1 - t);
            default:
                return 1 - t;
        }
    }

    /** Whether sculpting controls (not orbit) should be active */
    get isSculpting(): boolean {
        return this.isMouseDown;
    }
}
