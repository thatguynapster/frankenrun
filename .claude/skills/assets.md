---
name: asset-pipeline
description: Processes non-UI assets (3D models, textures for meshes, audio files) through the StowKit pipeline. Use when the user provides, drops, or asks to implement any FBX, OBJ, GLTF, GLB, PNG/JPG texture for a 3D model, WAV, MP3, OGG, or other game asset. NEVER use Three.js loaders (FBXLoader, GLTFLoader, OBJLoader, AudioLoader, TextureLoader) for game assets. ALL non-UI assets MUST go through StowKit.
---

# Asset Pipeline Skill

When the user provides a non-UI asset file (3D model, mesh texture, audio), process it through StowKit. Never load these assets directly with Three.js loaders.

## Hard Rules

- **NEVER** use `FBXLoader`, `GLTFLoader`, `OBJLoader`, `DRACOLoader`, `AudioLoader`, or `TextureLoader` from Three.js to load game assets
- **NEVER** import from `three/examples/jsm/loaders/`
- **ALWAYS** process 3D models, mesh textures, and audio through StowKit
- **ALWAYS** load these assets at runtime via `StowKitPack` (from `loadStowKitPack` or `StowKitLoader`)
- The only exception is **UI assets** (icons, button images, 2D sprites for the HUD) — those go directly into `public/cdn-assets/` and are loaded via `RundotGameAPI.cdn.fetchAsset()`

## Recognized Asset Types

| Category | Extensions | StowKit Type |
|----------|-----------|--------------|
| Static Mesh | `.fbx`, `.obj`, `.gltf`, `.glb` | `staticMesh` |
| Skinned Mesh | `.fbx` | `skinnedMesh` |
| Animation | `.fbx` | `animationClip` |
| Texture (for 3D) | `.png`, `.jpg`, `.jpeg`, `.bmp`, `.tga`, `.webp` | `texture` |
| Audio | `.wav`, `.mp3`, `.ogg`, `.flac`, `.aac`, `.m4a` | `audio` |
| Material | `.stowmat` | `materialSchema` |

## Workflow: User Provides an Asset File

### Step 1 — Save the file to `assets/`

Place the raw source file in the `assets/` directory at the project root.

### Step 2 — Scan

```bash
npx stowkit scan
```

This generates a `.stowmeta` sidecar for the new file with default settings.

### Step 3 — Configure the `.stowmeta` (if needed)

Edit the generated `.stowmeta` to set a meaningful `stringId`, adjust quality, or assign materials.

**Mesh example** (`assets/Robot.fbx.stowmeta`):
```json
{
  "version": 1,
  "type": "staticMesh",
  "stringId": "robot",
  "pack": "default",
  "dracoQuality": "balanced",
  "materialOverrides": {
    "0": "M_Robot.stowmat"
  }
}
```

**Texture example** (`assets/T_Robot_Diffuse.png.stowmeta`):
```json
{
  "version": 1,
  "type": "texture",
  "stringId": "robot_diffuse",
  "pack": "default",
  "quality": "normal",
  "resize": "full",
  "generateMipmaps": false
}
```

**Audio example** (`assets/sfx_jump.wav.stowmeta`):
```json
{
  "version": 1,
  "type": "audio",
  "stringId": "sfx_jump",
  "pack": "default",
  "aacQuality": "medium",
  "sampleRate": "auto"
}
```

### Step 4 — Create `.stowmat` files (textured meshes only)

If the mesh needs materials, create a `.stowmat` file in `assets/`:

```json
{
  "version": 1,
  "schemaName": "",
  "properties": [
    {
      "fieldName": "Diffuse",
      "fieldType": "texture",
      "previewFlag": "mainTex",
      "value": [1, 1, 1, 1],
      "textureAsset": "T_Robot_Diffuse.png"
    }
  ]
}
```

Then run `npx stowkit scan` again to register it.

### Step 5 — Build

```bash
npx stowkit build
```

Output goes to `public/cdn-assets/default.stow`.

### Step 6 — Load in code

Use `loadStowKitPack`:

```typescript
import { loadStowKitPack } from '../loadStowKitPack';

const pack = await loadStowKitPack('default');

// Mesh
const mesh = await pack.loadMesh('robot');
scene.add(mesh);

// Skinned mesh
const character = await pack.loadSkinnedMesh('hero_model');
scene.add(character);

// Animation
const { mixer, action, clip } = await pack.loadAnimation(character, 'hero_idle');

// Texture (for a 3D material)
const texture = await pack.loadTexture('robot_diffuse');

// Audio
const listener = new THREE.AudioListener();
camera.add(listener);
const audio = await pack.loadAudio('sfx_jump', listener);
audio.play();
```

## What NOT to Do

```typescript
// WRONG — never do this
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
const loader = new FBXLoader();
loader.load('model.fbx', (group) => { scene.add(group); });

// WRONG — never do this
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
const loader = new GLTFLoader();
loader.load('model.glb', (gltf) => { scene.add(gltf.scene); });

// WRONG — never do this for 3D textures
const texture = new THREE.TextureLoader().load('texture.png');

// WRONG — never do this
const audioLoader = new THREE.AudioLoader();
audioLoader.load('sound.mp3', (buffer) => { /* ... */ });
```

## Quick Reference

| I need to... | Do this |
|---|---|
| Add a 3D model | Save to `assets/` → `npx stowkit scan` → edit `.stowmeta` → `npx stowkit build` → `pack.loadMesh(id)` |
| Add a skinned character | Save `.fbx` to `assets/` → scan → set type to `skinnedMesh` → build → `pack.loadSkinnedMesh(id)` |
| Add an animation | Save `.fbx` to `assets/` → scan → set type to `animationClip` → build → `pack.loadAnimation(group, id)` |
| Add a texture for a mesh | Save to `assets/` → scan → create `.stowmat` → assign to mesh via `materialOverrides` → build → loads automatically with mesh |
| Add audio | Save to `assets/` → scan → build → `pack.loadAudio(id, listener)` |
| Add a UI image | Save directly to `public/cdn-assets/` → `RundotGameAPI.cdn.fetchAsset('filename.png')` |
