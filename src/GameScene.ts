import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import { loadStowKitPack, disposeStowKitPack } from './loadStowKitPack';
import { GameEventEmitter, type GameState } from './GameEvents';

const FUNNEL = 'onboarding';
const FUNNEL_ORDER = 1;
const SCORE_TO_WIN = 10;

export class GameScene {
  readonly events = new GameEventEmitter();

  private state: GameState = 'loading';
  private score = 0;

  private gameStartedFired = false;
  private firstScoreFired = false;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private animationFrameId = 0;
  private resizeObserver: ResizeObserver;
  private envMap: THREE.Texture | null = null;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  // --- Demo asset (replace with your game objects) ---
  private diceContainer: THREE.Group | null = null;

  constructor(container: HTMLDivElement) {
    const { clientWidth: w, clientHeight: h } = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: true,
    });

    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setSize(w * dpr, h * dpr, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;

    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.5;

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 1, 500);
    this.camera.position.set(3, 2, 3);

    this.scene = new THREE.Scene();

    const sunPosition = new THREE.Vector3(5, 8, 5);
    this.setupSky(sunPosition);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.15));

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.copy(sunPosition);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 20;
    dirLight.shadow.camera.left = -5;
    dirLight.shadow.camera.right = 5;
    dirLight.shadow.camera.top = 5;
    dirLight.shadow.camera.bottom = -5;
    dirLight.shadow.bias = -0.0005;
    dirLight.shadow.normalBias = 0.02;
    this.scene.add(dirLight);
    this.scene.add(dirLight.target);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.ShadowMaterial({ opacity: 0.3 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;

    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(container);

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);

    this.start();
    this.loadAssets();
  }

  // ---------------------------------------------------------------------------
  // State machine
  // ---------------------------------------------------------------------------

  getState(): GameState {
    return this.state;
  }

  getScore(): number {
    return this.score;
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.setState('playing');
  }

  gameOver(): void {
    if (this.state !== 'playing') return;
    this.setState('gameover');
    RundotGameAPI.analytics.recordCustomEvent('game_over', { final_score: this.score });
    RundotGameAPI.analytics.trackFunnelStep(4, 'game_over', FUNNEL, FUNNEL_ORDER);
  }

  restart(): void {
    this.setScore(0);

    // Reset demo dice rotation
    if (this.diceContainer) {
      this.diceContainer.rotation.set(0, 0, 0);
    }

    this.setState('playing');
    RundotGameAPI.analytics.recordCustomEvent('game_restarted');
  }

  private setState(next: GameState): void {
    if (this.state === next) return;
    this.state = next;
    this.events.emit('stateChange', next);

    if (next === 'playing' && !this.gameStartedFired) {
      this.gameStartedFired = true;
      RundotGameAPI.analytics.recordCustomEvent('game_started');
      RundotGameAPI.analytics.trackFunnelStep(2, 'game_started', FUNNEL, FUNNEL_ORDER);
    }
  }

  /** Call from game logic to change the score. Emits `scoreChange`. */
  setScore(value: number): void {
    this.score = value;
    this.events.emit('scoreChange', value);
    RundotGameAPI.analytics.recordCustomEvent('score_change', { value });
  }

  /** Shorthand: add to current score. */
  addScore(delta: number): void {
    if (!this.firstScoreFired) {
      this.firstScoreFired = true;
      RundotGameAPI.analytics.recordCustomEvent('first_score');
      RundotGameAPI.analytics.trackFunnelStep(3, 'first_score', FUNNEL, FUNNEL_ORDER);
    }
    this.setScore(this.score + delta);
  }

  // ---------------------------------------------------------------------------
  // Scene setup
  // ---------------------------------------------------------------------------

  private setupSky(sunPosition: THREE.Vector3) {
    const sky = new Sky();
    sky.scale.setScalar(450);

    const uniforms = sky.material.uniforms;
    uniforms['turbidity']!.value = 2;
    uniforms['rayleigh']!.value = 1;
    uniforms['mieCoefficient']!.value = 0.005;
    uniforms['mieDirectionalG']!.value = 0.8;
    uniforms['sunPosition']!.value.copy(sunPosition.clone().normalize());

    this.scene.add(sky);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileCubemapShader();
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    const envRT = pmrem.fromScene(envScene, 0, 0.1, 100);
    this.envMap = envRT.texture;
    this.scene.environment = this.envMap;
    this.scene.background = this.envMap;
    pmrem.dispose();
  }

  private onResize = (entries: ResizeObserverEntry[]) => {
    const entry = entries[0];
    if (!entry) return;
    const { width: w, height: h } = entry.contentRect;
    if (w === 0 || h === 0) return;

    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setSize(w * dpr, h * dpr, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private onPointerDown = (e: PointerEvent) => {
    if (this.state !== 'playing' || !this.diceContainer) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.diceContainer, true);
    if (hits.length === 0) return;

    this.addScore(1);
    RundotGameAPI.analytics.recordCustomEvent('dice_tapped', { score: this.score });

    if (this.score >= SCORE_TO_WIN) {
      this.gameOver();
    }
  };

  // ---------------------------------------------------------------------------
  // Asset loading
  // ---------------------------------------------------------------------------

  private async loadAssets() {
    try {
      const pack = await loadStowKitPack('default');
      const mesh = await pack.loadMesh('sm_dice');

      mesh.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });

      this.diceContainer = new THREE.Group();
      this.diceContainer.add(mesh);
      this.scene.add(this.diceContainer);

      RundotGameAPI.analytics.recordCustomEvent('assets_loaded');
      RundotGameAPI.analytics.trackFunnelStep(1, 'assets_loaded', FUNNEL, FUNNEL_ORDER);

      this.setState('playing');
    } catch (err) {
      RundotGameAPI.error('[GameScene] Error loading assets:', err);
      RundotGameAPI.analytics.recordCustomEvent('assets_load_failed', { message: String(err) });
    }
  }

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------

  private update = () => {
    this.animationFrameId = requestAnimationFrame(this.update);
    const delta = this.clock.getDelta();

    switch (this.state) {
      case 'loading':
        break;
      case 'playing':
        this.updatePlaying(delta);
        break;
      case 'paused':
        break;
      case 'gameover':
        break;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  /** Main game tick — put your game logic here. */
  private updatePlaying(delta: number): void {
    // Demo: spin the dice. Replace with your game logic.
    if (this.diceContainer) {
      this.diceContainer.rotation.x += delta * 0.5;
      this.diceContainer.rotation.y += delta * 0.7;
    }
  }

  private start() {
    this.clock.start();
    this.update();
  }

  dispose() {
    cancelAnimationFrame(this.animationFrameId);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.controls.dispose();
    this.envMap?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.events.removeAll();
    disposeStowKitPack('default');
  }
}
