export type GameState = 'loading' | 'playing' | 'paused' | 'gameover';

export type GameEventMap = {
  stateChange: GameState;
  scoreChange: number;
};

type Handler<T> = (data: T) => void;

export class GameEventEmitter {
  private listeners = new Map<keyof GameEventMap, Set<Handler<any>>>();

  on<K extends keyof GameEventMap>(event: K, handler: Handler<GameEventMap[K]>): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
  }

  off<K extends keyof GameEventMap>(event: K, handler: Handler<GameEventMap[K]>): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit<K extends keyof GameEventMap>(event: K, data: GameEventMap[K]): void {
    this.listeners.get(event)?.forEach((fn) => fn(data));
  }

  removeAll(): void {
    this.listeners.clear();
  }
}
