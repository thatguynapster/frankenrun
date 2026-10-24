// Plain Web Audio engine (no React, nothing in the simulation). Sounds are small mp3 files on the CDN, decoded once.
// Any sound whose file is missing simply does not play, so the game works with a partial or empty audio folder.

import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import type { GameProjection } from '../sim/game.js';
import type { SoundEvent } from './events.js';
import { MUSIC, SOUNDS, soundFile, type SoundDef } from './manifest.js';
import { distanceGain } from './spatial.js';

export type Scene = 'title' | 'lobby' | 'race';
export interface AudioSettings {
  readonly sfx: boolean;
  readonly music: boolean;
  /** Master volume, 0 (silent) to 1 (full). Set with the slider in the menu. */
  readonly volume: number;
  /** Separate sliders for the effects and the music, 0 to 1, on top of the master volume. */
  readonly sfxVolume: number;
  readonly musicVolume: number;
}

export const DEFAULT_VOLUME = 0.7;
const DEFAULT_BUS_VOLUME = 0.85;

/** The slider is linear but loudness is not: squaring it makes the lower half usefully quiet. */
export function gainForVolume(volume: number): number {
  const v = Math.max(0, Math.min(1, volume));
  return v * v;
}
const STORAGE_KEY = 'frankenrun.audio';
const MAX_VOICES = 14;
const MUSIC_FADE_S = 1.2;
const SOUND_BY_ID = new Map<string, SoundDef>(SOUNDS.map((s) => [s.id, s]));

/**
 * A music track made to loop without a seam: a fade-out at the end is trimmed away, and the last second is blended into
 * the first second (equal power), so the end flows straight into the start.
 */
export function loopable(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  const rate = buffer.sampleRate;
  const win = Math.floor(rate * 0.05);
  const first = buffer.getChannelData(0);
  const rmsAt = (start: number): number => {
    let t = 0;
    const end = Math.min(first.length, start + win);
    for (let i = start; i < end; i += 1) t += first[i]! * first[i]!;
    return Math.sqrt(t / Math.max(1, end - start));
  };
  // The usual loudness: the median of the window levels over the track.
  const levels: number[] = [];
  for (let s = 0; s + win <= first.length; s += win * 4) levels.push(rmsAt(s));
  const median = [...levels].sort((a, b) => a - b)[Math.floor(levels.length / 2)] ?? 0;
  // Trim a fade-out: drop trailing windows that are much quieter than the track usually is.
  let length = first.length;
  while (length - win > rate * 5 && rmsAt(length - win) < median * 0.6) length -= win;
  const fade = Math.min(Math.floor(rate * 1.2), Math.floor(length / 4));
  const loopLength = length - fade;
  const out = ctx.createBuffer(buffer.numberOfChannels, loopLength, rate);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < loopLength; i += 1) dst[i] = src[i]!;
    for (let i = 0; i < fade; i += 1) {
      const t = (i / fade) * (Math.PI / 2);
      dst[i] = src[i]! * Math.sin(t) + src[loopLength + i]! * Math.cos(t);
    }
  }
  return out;
}

export class AudioEngine {
  settings: AudioSettings = { sfx: true, music: true, volume: DEFAULT_VOLUME, sfxVolume: DEFAULT_BUS_VOLUME, musicVolume: DEFAULT_BUS_VOLUME };
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private sfxBus: GainNode | undefined;
  private musicBus: GainNode | undefined;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Set<string>();
  private missing = new Set<string>();
  private scene: Scene = 'title';
  private music: { id: string; gain: GainNode; source: AudioBufferSourceNode } | undefined;
  private voices = 0;
  private suspended = false;
  private onChange: () => void = () => undefined;

  constructor() {
    if (typeof window === 'undefined') return;
    // Browsers only start audio after a user gesture: the first tap or key press creates and resumes the context.
    const unlock = (): void => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('visibilitychange', () => this.setSuspended(document.hidden));
    void this.loadSettings();
  }

  /** Called when settings change so the UI can refresh. */
  setChangeListener(listener: () => void): void {
    this.onChange = listener;
  }

  private unlock(): void {
    if (this.ctx === undefined) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor === undefined) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applySettings();
      void this.preload();
    }
    if (!this.suspended && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    this.applyMusic();
  }

  setSuspended(on: boolean): void {
    this.suspended = on;
    const ctx = this.ctx;
    if (ctx === undefined) return;
    if (on) void ctx.suspend().catch(() => undefined);
    else void ctx.resume().catch(() => undefined);
  }

  // ---------- settings ----------

  setSettings(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.applySettings();
    this.applyMusic();
    RundotGameAPI.deviceCache.setItem(STORAGE_KEY, JSON.stringify(this.settings)).catch(() => undefined);
    this.onChange();
  }

  private async loadSettings(): Promise<void> {
    try {
      const saved = await RundotGameAPI.deviceCache.getItem(STORAGE_KEY);
      if (!saved) return;
      const raw = JSON.parse(saved) as { sfx?: unknown; music?: unknown; volume?: unknown; sfxVolume?: unknown; musicVolume?: unknown };
      const level = (v: unknown): number => (typeof v === 'number' ? Math.max(0, Math.min(1, v)) : DEFAULT_BUS_VOLUME);
      this.settings = {
        sfx: typeof raw.sfx === 'boolean' ? raw.sfx : true,
        music: typeof raw.music === 'boolean' ? raw.music : true,
        sfxVolume: level(raw.sfxVolume),
        musicVolume: level(raw.musicVolume),
        // Older builds saved 'low' | 'medium' | 'high'; those map onto the slider.
        volume: typeof raw.volume === 'number' ? Math.max(0, Math.min(1, raw.volume)) : raw.volume === 'low' ? 0.35 : raw.volume === 'high' ? 1 : DEFAULT_VOLUME,
      };
      this.applySettings();
      this.applyMusic();
      this.onChange();
    } catch {
      // Defaults.
    }
  }

  private applySettings(): void {
    if (this.master === undefined || this.sfxBus === undefined || this.musicBus === undefined) return;
    this.master.gain.value = gainForVolume(this.settings.volume);
    this.sfxBus.gain.value = this.settings.sfx ? gainForVolume(this.settings.sfxVolume) : 0;
    this.musicBus.gain.value = this.settings.music ? gainForVolume(this.settings.musicVolume) : 0;
  }

  // ---------- loading ----------

  private async load(file: string): Promise<AudioBuffer | undefined> {
    const cached = this.buffers.get(file);
    if (cached !== undefined || this.ctx === undefined || this.missing.has(file) || this.loading.has(file)) return cached;
    this.loading.add(file);
    try {
      const blob = await RundotGameAPI.cdn.fetchAsset(file);
      const decoded = await this.ctx.decodeAudioData(await blob.arrayBuffer());
      this.buffers.set(file, decoded);
      return decoded;
    } catch {
      this.missing.add(file); // not generated yet (or not decodable): stay silent, do not retry every frame
      return undefined;
    } finally {
      this.loading.delete(file);
    }
  }

  /** Loads the short sound effects up front; music is loaded when its scene first needs it. */
  private async preload(): Promise<void> {
    const files: string[] = [];
    for (const def of SOUNDS) for (let v = 0; v < def.variants; v += 1) files.push(soundFile(def.id, v, def.variants));
    await Promise.all(files.map((f) => this.load(f)));
  }

  // ---------- one-shots ----------

  /** A UI or button sound (no position). */
  playUi(id: 'click' | 'denied'): void {
    this.playBuffer(id, 1, 0, 1);
  }

  /** Plays a game sound; other monsters' sounds get quieter with distance and are panned left or right. */
  play(event: SoundEvent, frame: GameProjection, localSlot: number): void {
    let gain = event.gain ?? 1;
    let pan = 0;
    if (event.slot !== localSlot) {
      const me = frame.players[localSlot];
      const source = frame.players[event.slot];
      if (me !== undefined && source !== undefined) {
        const dx = source.x - me.x, dz = source.z - me.z;
        gain *= distanceGain(Math.hypot(dx, dz));
        // Screen-right of the chase camera in world terms (facing +z, +x is on the left).
        const yaw = 2 * Math.atan2(me.qy, me.qw);
        const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };
        pan = Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) / 25)) * 0.8;
      }
    }
    if (gain < 0.03) return;
    this.playBuffer(event.id, gain, pan, event.rate ?? 0.95 + Math.random() * 0.1);
  }

  private playBuffer(id: string, gainScale: number, pan: number, rate: number): void {
    const ctx = this.ctx;
    const def = SOUND_BY_ID.get(id);
    if (ctx === undefined || this.sfxBus === undefined || def === undefined || !this.settings.sfx || this.suspended) return;
    if (this.voices >= MAX_VOICES) return;
    const variant = Math.floor(Math.random() * def.variants);
    const buffer = this.buffers.get(soundFile(def.id, variant, def.variants));
    if (buffer === undefined) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = def.volume * gainScale;
    source.connect(gain);
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      panner.connect(this.sfxBus);
    } else {
      gain.connect(this.sfxBus);
    }
    this.voices += 1;
    source.onended = () => {
      this.voices -= 1;
    };
    source.start();
  }

  // ---------- music ----------

  setScene(scene: Scene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.applyMusic();
  }

  private wantedTrack(): (typeof MUSIC)[number]['id'] | undefined {
    if (!this.settings.music || this.suspended) return undefined;
    return this.scene === 'race' ? 'music_race' : 'music_lobby';
  }

  private applyMusic(): void {
    const ctx = this.ctx;
    if (ctx === undefined || this.musicBus === undefined) return;
    const wanted = this.wantedTrack();
    if (this.music !== undefined && this.music.id === wanted) return;
    if (this.music !== undefined) {
      const old = this.music;
      this.music = undefined;
      old.gain.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.gain.setValueAtTime(old.gain.gain.value, ctx.currentTime);
      old.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + MUSIC_FADE_S);
      old.source.stop(ctx.currentTime + MUSIC_FADE_S + 0.1);
    }
    if (wanted === undefined) return;
    const def = MUSIC.find((m) => m.id === wanted)!;
    void this.load(soundFile(def.id)).then((buffer) => {
      // The scene may have changed while the file was loading.
      if (buffer === undefined || this.ctx === undefined || this.musicBus === undefined || this.wantedTrack() !== def.id || this.music?.id === def.id) return;
      const source = this.ctx.createBufferSource();
      source.buffer = loopable(this.ctx, buffer);
      source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(def.volume, this.ctx.currentTime + MUSIC_FADE_S);
      source.connect(gain);
      gain.connect(this.musicBus);
      source.start();
      this.music = { id: def.id, gain, source };
    });
  }
}
