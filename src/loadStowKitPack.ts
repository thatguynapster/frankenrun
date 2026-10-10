import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import { StowKitLoader, AssetMemoryCache, type StowKitPack } from '@series-inc/stowkit-three-loader';

const STOWKIT_CONFIG = {
  basisPath: './stowkit/basis/',
  dracoPath: './stowkit/draco/',
  wasmPath: './stowkit/stowkit_reader.wasm',
} as const;

const packCache = new Map<string, StowKitPack>();

export async function loadStowKitPack(packName: string): Promise<StowKitPack> {
  const cached = packCache.get(packName);
  if (cached) return cached;

  if (import.meta.env.DEV) {
    await AssetMemoryCache.clear();
  }

  const blob = await RundotGameAPI.cdn.fetchAsset(`${packName}.stow`);
  const arrayBuffer = await blob.arrayBuffer();

  const cacheKey = import.meta.env.DEV
    ? `${packName}.stow::${arrayBuffer.byteLength}::${Date.now()}`
    : `${packName}.stow`;

  const pack = await StowKitLoader.loadFromMemory(arrayBuffer, STOWKIT_CONFIG, cacheKey);
  packCache.set(packName, pack);
  return pack;
}

export function disposeStowKitPack(packName: string): void {
  const pack = packCache.get(packName);
  if (pack) {
    pack.dispose();
    packCache.delete(packName);
  }
}
