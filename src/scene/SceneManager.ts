import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class SceneManager {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    public controls: OrbitControls;

    private canvas: HTMLCanvasElement;
    private resizeObserver: ResizeObserver;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1c1a17);

        // Camera
        this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
        this.camera.position.set(8, 10, 12);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false,
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;

        // Controls
        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 3;
        this.controls.maxDistance = 40;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
        this.controls.target.set(0, 0, 0);

        // Lights
        this.setupLights();

        // Grid helper
        this.setupGrid();

        // Resize
        this.resizeObserver = new ResizeObserver(() => this.onResize());
        this.resizeObserver.observe(canvas.parentElement!);
        this.onResize();
    }

    private setupLights() {
        const ambient = new THREE.AmbientLight(0xfff5e6, 0.4);
        this.scene.add(ambient);

        const hemi = new THREE.HemisphereLight(0xffeedd, 0x3a2e20, 0.5);
        this.scene.add(hemi);

        const dir = new THREE.DirectionalLight(0xfff0d4, 1.2);
        dir.position.set(8, 12, 5);
        dir.castShadow = true;
        dir.shadow.mapSize.set(2048, 2048);
        dir.shadow.camera.left = -15;
        dir.shadow.camera.right = 15;
        dir.shadow.camera.top = 15;
        dir.shadow.camera.bottom = -15;
        this.scene.add(dir);

        const fill = new THREE.DirectionalLight(0xb5c9dd, 0.3);
        fill.position.set(-5, 6, -8);
        this.scene.add(fill);
    }

    private setupGrid() {
        const gridSize = 20;
        const gridDiv = 20;
        const grid = new THREE.GridHelper(gridSize, gridDiv, 0x4a3f33, 0x332d25);
        grid.position.y = -0.01;
        (grid.material as THREE.Material).opacity = 0.4;
        (grid.material as THREE.Material).transparent = true;
        this.scene.add(grid);
    }

    private onResize() {
        const parent = this.canvas.parentElement;
        if (!parent) return;
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    /** Switch to top-down orthographic-like view */
    setTopView() {
        this.camera.position.set(0, 18, 0.01);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    /** Switch to perspective view */
    setPerspectiveView() {
        this.camera.position.set(8, 10, 12);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    update() {
        this.controls.update();
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    dispose() {
        this.resizeObserver.disconnect();
        this.controls.dispose();
        this.renderer.dispose();
    }
}
