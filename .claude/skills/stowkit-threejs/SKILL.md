# StowKit Three.js Loader

Use `@series-inc/stowkit-three-loader` to load `.stow` asset packs in Three.js applications.

## How Assets Get Into the Game

Assets are NEVER loaded as raw files (no `THREE.FBXLoader`, no `THREE.TextureLoader` on PNGs, no `fetch('assets/model.fbx')`). The workflow is:

1. Source files (FBX, GLB, PNG, WAV) go into the project's `srcArtDir`
2. `stowkit build` compresses and packs them into `.stow` binary files
3. At runtime, this loader reads from the `.stow` pack using the asset's `stringId`

If you need to add an asset to the game, the pipeline step (`stowkit build`) must happen first. Then use the methods below to load from the pack.

## Quick Reference

| I need to... | Method |
|---|---|
| Load a pack | `await StowKitLoader.load('cdn-assets/default.stow')` |
| Add a static mesh to the scene | `scene.add(await pack.loadMesh('level_geometry'))` |
| Add a skinned character | `scene.add(await pack.loadSkinnedMesh('hero_model'))` |
| Play an animation on a character | `const { mixer } = await pack.loadAnimation(character, 'idle')` — call `mixer.update(dt)` each frame |
| Load a texture | `material.map = await pack.loadTexture('hero_diffuse')` |
| Play audio | `const audio = await pack.loadAudio('bgm', listener); audio.play()` |
| See what's in a pack | `pack.listAssets()` — returns array of `{ index, name, id, type, dataSize }` |
| Clean up | `pack.dispose()` |

## Common Mistakes

| Mistake | Fix |
|---|---|
| Using `THREE.FBXLoader` / `THREE.TextureLoader` / `THREE.GLTFLoader` to load raw source files | StowKit projects load everything from `.stow` packs — use `pack.loadMesh()`, `pack.loadTexture()`, etc. |
| Forgetting `mixer.update(dt)` in render loop | Animations won't play without it — add `mixer.update(clock.getDelta())` to your animate function |
| Loading audio before adding `AudioListener` to camera | Create listener, attach to camera, then load audio |
| Calling `loadAnimation` with wrong group | Pass the group returned by `loadSkinnedMesh`, not a child mesh |
| Not awaiting `StowKitLoader.load()` | All load methods are async — always `await` them |
| Manually decoding KTX2/Draco | The loader handles all decoding internally — just call `loadMesh`/`loadTexture` |

## Installation

```bash
npm install @series-inc/stowkit-three-loader three
```

The postinstall script copies WASM/Basis/Draco files to `public/stowkit/`.

## Loading a Pack

```typescript
import { StowKitLoader } from '@series-inc/stowkit-three-loader';

const pack = await StowKitLoader.load('cdn-assets/default.stow');
```

Options (all optional):
- `wasmPath` — path to `stowkit_reader.wasm` (default: `'/stowkit/stowkit_reader.wasm'`)
- `basisPath` — path to Basis transcoder dir (default: `'/stowkit/basis/'`)
- `dracoPath` — path to Draco decoder dir (default: `'/stowkit/draco/'`)

Load from memory (e.g. after a custom fetch):
```typescript
const buffer = await fetch(url).then(r => r.arrayBuffer());
const pack = await StowKitLoader.loadFromMemory(buffer, undefined, url);
```

## Asset Types

| Type | Enum | Load Method |
|------|------|-------------|
| Static Mesh | `AssetType.STATIC_MESH` (1) | `pack.loadMesh(id)` / `pack.loadMeshByIndex(i)` |
| Skinned Mesh | `AssetType.SKINNED_MESH` (5) | `pack.loadSkinnedMesh(id)` / `pack.loadSkinnedMeshByIndex(i)` |
| Animation | `AssetType.ANIMATION_CLIP` (6) | `pack.loadAnimation(group, id)` / `pack.loadAnimationByIndex(group, i)` |
| Texture | `AssetType.TEXTURE_2D` (2) | `pack.loadTexture(id)` / `pack.loadTextureByIndex(i)` |
| Audio | `AssetType.AUDIO` (3) | `pack.loadAudio(id, listener)` |
| Material | `AssetType.MATERIAL_SCHEMA` (4) | Embedded in mesh metadata |

Assets are referenced by their `stringId` from `.stowmeta` files (e.g. `"hero_model"`, `"level_geometry"`).

## Static Meshes

```typescript
const mesh = await pack.loadMesh('level_geometry');
scene.add(mesh);
```

Returns `THREE.Group` with Draco-decoded geometry, materials, textures, and node hierarchy.

## Skinned Meshes

```typescript
const character = await pack.loadSkinnedMesh('hero_model');
scene.add(character);
```

Returns `THREE.Group` containing a `BoneContainer` group and a `THREE.SkinnedMesh`. The skeleton is bound at load time with correct bind pose.

Access internals via `character.userData.skinnedMesh` and bone names via `character.userData.boneOriginalNames`.

## Animations

Load and auto-play:
```typescript
const { mixer, action, clip } = await pack.loadAnimation(character, 'hero_idle');

// In your render loop:
mixer.update(clock.getDelta());
```

`loadAnimation` automatically:
- Creates an `AnimationMixer` on the group
- Retargets bone names if they don't match exactly (suffix matching)
- Sets `LoopRepeat` and starts playback

Load clip only (no playback):
```typescript
const clip = await pack.loadAnimationClip('hero_walk');
```

## Textures

```typescript
const texture = await pack.loadTexture('hero_diffuse');
material.map = texture;
```

Returns `THREE.CompressedTexture` (KTX2/Basis Universal). Textures are cached per-pack — loading the same ID twice returns the same instance.

## Audio

```typescript
const listener = new THREE.AudioListener();
camera.add(listener);

const audio = await pack.loadAudio('bgm_main', listener);
audio.setLoop(true);
audio.play();
```

Audio is AAC format (M4A container), decoded via Web Audio API.

For HTML5 preview: `const el = await pack.createAudioPreview(index);`

## Pack Manifest

```typescript
const assets = pack.listAssets();
// Each: { index, name, id, type, dataSize, hasMetadata }

const count = pack.getAssetCount();
const info = pack.getAssetInfo(0);
const rawData = pack.readAssetData(0);
const rawMeta = pack.readAssetMetadata(0);
```

## Metadata Helpers

```typescript
// Animation
const anim = pack.getAnimationMetadata(index);
// { stringId, targetMeshId, duration, ticksPerSecond, channelCount, boneCount }

// Audio
const audio = pack.getAudioMetadata('bgm_main');
// { sampleRate, channels, durationMs }

// Texture
const tex = pack.getTextureMetadata(index);
// { width, height, channels, channelFormat }
```

## Multiple Packs

Each pack has its own WASM reader instance — fully isolated:
```typescript
const [env, chars] = await Promise.all([
    StowKitLoader.load('cdn-assets/environment.stow'),
    StowKitLoader.load('cdn-assets/characters.stow')
]);
```

## Cleanup

```typescript
pack.dispose(); // Clears texture cache, closes WASM reader
```

## Caching

Decoded Draco geometries and transcoded Basis textures are cached in IndexedDB (`StowKitAssetCache`). Cache invalidates when pack file size changes. Use `AssetMemoryCache.clear()` to reset.

## Exports

```typescript
import {
    StowKitLoader,    // Static loader class
    StowKitPack,      // Pack instance (returned by load)
    AssetMemoryCache, // IndexedDB cache
    AssetType,        // Enum: STATIC_MESH, TEXTURE_2D, AUDIO, etc.
    PerfLogger        // Performance logging
} from '@series-inc/stowkit-three-loader';

// Types
import type {
    StowKitLoaderOptions,
    MeshGeometryInfo,
    MaterialPropertyValue,
    MaterialData,
    Node,
    MeshMetadata
} from '@series-inc/stowkit-three-loader';
```

## Complete Example

```typescript
import * as THREE from 'three';
import { StowKitLoader } from '@series-inc/stowkit-three-loader';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
const clock = new THREE.Clock();

const listener = new THREE.AudioListener();
camera.add(listener);

const pack = await StowKitLoader.load('cdn-assets/default.stow');

// Environment
const level = await pack.loadMesh('level_geometry');
scene.add(level);

// Character with animation
const hero = await pack.loadSkinnedMesh('hero_model');
scene.add(hero);
const { mixer } = await pack.loadAnimation(hero, 'hero_idle');

// Background music
const bgm = await pack.loadAudio('bgm_main', listener);
bgm.setLoop(true);
bgm.play();

function animate() {
    requestAnimationFrame(animate);
    mixer.update(clock.getDelta());
    renderer.render(scene, camera);
}
animate();
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Animations offset from origin | Old pack format with wrong bone parent indices | Rebuild with latest `stowkit build` |
| Textures not loading / white meshes | Basis transcoder files missing | Verify `public/stowkit/basis/` has `basis_transcoder.js` and `.wasm`. Re-run `npm install` to trigger postinstall copy. |
| Audio not playing | No `AudioListener` on camera | Create `new THREE.AudioListener()`, add to camera before loading audio |
| Mesh has no materials / gray | No `materialOverrides` in `.stowmeta` | Assign `.stowmat` files via `materialOverrides` in the mesh's `.stowmeta`, then `stowkit build` |
| WASM file not found | Wrong `wasmPath` or files not copied | Check `public/stowkit/stowkit_reader.wasm` exists. Pass custom `wasmPath` if serving from a different location. |
| `loadAnimation` throws "no skeleton" | Passed a static mesh group, not a skinned mesh | Use the group returned by `loadSkinnedMesh`, not `loadMesh` |
| Second load of same texture looks different | Texture cache returns same instance | This is intentional — textures are cached per pack. Clone if you need different settings. |
