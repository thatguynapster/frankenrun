import { useCallback, useRef, useState } from 'react';
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import { Game, type Graphics, type UiState } from './Game';
import { ARM_PARTS, BODIES, HEAD_PARTS, LEG_PARTS } from './sim/parts';
import { ARM_TENTACLES, HEAD_SLIME, buildStats, lobbyStatus, type Build, type GameProjection } from './sim/game';
import './style.css';

const TICK = 30;

function applySafeArea(): void {
  try {
    const { top, right, bottom, left } = RundotGameAPI.system.getSafeArea();
    const s = document.documentElement.style;
    s.setProperty('--safe-top', `${top}px`);
    s.setProperty('--safe-right', `${right}px`);
    s.setProperty('--safe-bottom', `${bottom}px`);
    s.setProperty('--safe-left', `${left}px`);
  } catch {
    // Not ready yet (real host): the CSS fallbacks use env(safe-area-inset-*).
  }
}

function App() {
  const gameRef = useRef<Game | null>(null);
  const [ui, setUi] = useState<UiState | null>(null);
  const [code, setCode] = useState('');

  const sceneRef = useCallback((container: HTMLDivElement | null) => {
    if (container && !gameRef.current) {
      const game = new Game(container);
      gameRef.current = game;
      if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game; // dev-only test hook
      game.subscribe(setUi);
      applySafeArea();
    }
  }, []);

  const game = gameRef.current;
  return (
    <div
      className="app-container"
      onClickCapture={(e) => {
        // Every button press gets the same soft click.
        if (game && (e.target as HTMLElement).closest('button')) game.audio.playUi('click');
      }}
    >
      <div ref={sceneRef} className="scene-container" />
      {game && ui && <Overlay game={game} ui={ui} code={code} setCode={setCode} />}
    </div>
  );
}

function Overlay({ game, ui, code, setCode }: { game: Game; ui: UiState; code: string; setCode: (v: string) => void }) {
  if (ui.screen === 'title') {
    return (
      <div className="panel center">
        <h1 className="title">FRANKENRUN</h1>
        <p className="muted">Stitch a monster. Race it. Steal the win.</p>
        <button className="btn primary" onClick={() => void game.quick()}>
          Quick match
        </button>
        <button className="btn" onClick={() => void game.practice()}>
          Practice (offline)
        </button>
        <button className="btn" onClick={() => void game.host()}>
          Host private race
        </button>
        <div className="row">
          <input
            className="input"
            placeholder="Room code"
            value={code}
            maxLength={8}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button className="btn" disabled={code.length < 3} onClick={() => void game.join(code)}>
            Join
          </button>
        </div>
        <p className="credit">Map data © OpenStreetMap contributors (ODbL)</p>
      </div>
    );
  }
  if (ui.screen === 'connecting') {
    return (
      <div className="panel center">
        <p className="title small">{ui.connectNote ? 'Reconnecting...' : 'Connecting...'}</p>
        {ui.connectNote && <p className="muted small">{ui.connectNote}</p>}
      </div>
    );
  }
  if (ui.screen === 'error') {
    return (
      <div className="panel center">
        <p className="title small">Connection problem</p>
        <p className="muted">{ui.error}</p>
        {ui.errorDetail && ui.errorDetail !== ui.error && <p className="muted small">{ui.errorDetail}</p>}
        <div className="row">
          {ui.canRejoin && (
            <button className="btn primary" onClick={() => void game.rejoin()}>
              Rejoin race
            </button>
          )}
          <button className={`btn ${ui.canRejoin ? '' : 'primary'}`} onClick={() => game.leave()}>
            Back
          </button>
        </div>
      </div>
    );
  }
  return (
    <>
      <PlayOverlay game={game} ui={ui} />
      {ui.menuOpen && <MenuPanel game={game} ui={ui} />}
    </>
  );
}

const GRAPHICS_CHOICES: readonly { value: Graphics; label: string; note: string }[] = [
  { value: 'auto', label: 'Auto', note: 'adapts to your device' },
  { value: 'high', label: 'High', note: 'sharpest' },
  { value: 'medium', label: 'Medium', note: '' },
  { value: 'low', label: 'Low', note: 'fastest' },
];

/** Esc (or the Menu button): quick settings. The game does not pause online, so the monster just stops responding to input. */
function MenuPanel({ game, ui }: { game: Game; ui: UiState }) {
  return (
    <div className="panel center menu">
      <h2 className="title small">Menu</h2>
      {ui.online && <p className="muted small">The race keeps going while this is open.</p>}
      <div className="menu-section">
        <b>Graphics quality</b>
        <div className="chips">
          {GRAPHICS_CHOICES.map((choice) => (
            <button key={choice.value} className={`chip ${ui.graphics === choice.value ? 'on' : ''}`} onClick={() => game.setGraphics(choice.value)}>
              {choice.label}
            </button>
          ))}
        </div>
        <small>Lower it if the game stutters; Auto adapts to your device.</small>
      </div>
      <div className="menu-section">
        <b>Sound</b>
        <div className="chips">
          <button className={`chip ${ui.audio.sfx ? 'on' : ''}`} onClick={() => game.setAudio({ sfx: !ui.audio.sfx })}>
            Sound effects: {ui.audio.sfx ? 'on' : 'off'}
          </button>
          <button className={`chip ${ui.audio.music ? 'on' : ''}`} onClick={() => game.setAudio({ music: !ui.audio.music })}>
            Music: {ui.audio.music ? 'on' : 'off'}
          </button>
        </div>
        <label className="slider">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(ui.audio.volume * 100)}
            onChange={(e) => game.setAudio({ volume: Number(e.target.value) / 100 })}
            aria-label="Volume"
          />
          <em>{Math.round(ui.audio.volume * 100)}%</em>
        </label>
      </div>
      <div className="menu-section">
        <b>On screen</b>
        <div className="chips">
          <button className={`chip ${ui.showInfo ? 'on' : ''}`} onClick={() => game.setShowInfo(!ui.showInfo)}>
            Performance info: {ui.showInfo ? 'on' : 'off'}
          </button>
          <button className={`chip ${ui.showColliders ? 'on' : ''}`} onClick={() => game.setColliders(!ui.showColliders)}>
            Show colliders: {ui.showColliders ? 'on' : 'off'}
          </button>
        </div>
      </div>
      <div className="menu-section">
        <b>Help</b>
        <div className="chips">
          <button className="chip" onClick={() => game.replayTips()}>
            Show tips again
          </button>
        </div>
        <small>{keysHelp(ui)}</small>
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => game.toggleMenu()}>
          Resume
        </button>
        <button className="btn" onClick={() => game.leave()}>
          Leave game
        </button>
      </div>
    </div>
  );
}

/** The control keys for the scheme in use. */
function keysHelp(ui: UiState): string {
  if (ui.touch) return 'Drag on the left to steer · tap the buttons for abilities · hold Reset to return to the last checkpoint';
  return 'W go · S brake · A/D steer (hold steer when stuck to turn around) · J tentacles · K slime · hold R to reset · Esc menu';
}

function ResultsPanel({ game, frame, meSlot, mode, banner, names }: { game: Game; frame: GameProjection; meSlot: number; mode: 'live' | 'finished' | 'stale'; banner?: string; names: Readonly<Record<number, string>> }) {
  const me = frame.players[meSlot];
  const nameOf = (slot: number): string => names[slot] ?? `Player ${slot + 1}`;
  const racers = frame.players.filter((p) => p.inRace && !p.bot);
  return (
    <div className="panel center results">
      <h2 className="title small">{mode === 'finished' ? 'Race complete!' : 'Results'}</h2>
      {mode === 'finished' && me && <p className="muted small">Your time: {((me.finishTick - frame.raceStart) / TICK).toFixed(1)}s. Waiting for the others to finish...</p>}
      {banner && <p className="muted small">{banner}</p>}
      <ol>
        {frame.finishOrder.map((slot, i) => {
          const t = frame.players[slot]?.finishTick ?? 0;
          return (
            <li key={i}>
              {nameOf(slot)}
              {slot === meSlot ? ' (you)' : ''} - {((t - frame.raceStart) / TICK).toFixed(1)}s
              <small className="muted"> · parts lost {frame.players[slot]?.partsLost ?? 0}, picked up {frame.players[slot]?.partsGained ?? 0}, stolen {frame.players[slot]?.partsStolen ?? 0}</small>
            </li>
          );
        })}
        {racers
          .filter((p) => p.finishTick < 0)
          .map((p) => (
            <li key={`dnf-${p.slot}`} className="muted">
              {nameOf(p.slot)} - {mode === 'finished' ? 'racing...' : 'DNF'}
              <small> · parts lost {p.partsLost}, picked up {p.partsGained}, stolen {p.partsStolen}</small>
            </li>
          ))}
      </ol>
      <div className="row">
        {mode !== 'finished' && (
          <button className="btn primary" onClick={() => game.rematch()}>
            {mode === 'stale' ? 'Join next race' : 'Rematch'}
          </button>
        )}
        <button className={`btn ${mode === 'finished' ? 'primary' : ''}`} onClick={() => game.leave()}>
          Back to menu
        </button>
      </div>
    </div>
  );
}

function PlayOverlay({ game, ui }: { game: Game; ui: UiState }) {
  const frame = ui.frame;
  const me = frame?.players[ui.localSlot];
  if (!frame || !me) {
    return (
      <div className="panel center">
        <p className="title small">Loading...</p>
      </div>
    );
  }

  const pick = (key: keyof Build, id: number) => game.setBuild({ ...ui.build, [key]: id });
  const stats = buildStats(ui.build);
  const secs = (t: number) => (t / TICK).toFixed(1);
  const raceOn = frame.phase === 'COUNTDOWN' || frame.phase === 'RACING';
  const nameOf = (slot: number): string => ui.names[slot] ?? `Player ${slot + 1}`;

  // The lobby is the build screen: everyone sees it before the first race, and after a race each player gets here by
  // pressing Rematch (the others keep their results until they do the same).
  if (frame.phase === 'BUILD' || me.rematch) {
    const lobby = lobbyStatus(frame);
    const isHost = me.host;
    const racersNow = frame.players.filter((p) => p.joined && !p.bot);
    const lobbyHint = isHost
      ? lobby.count < 2
        ? 'Waiting for another player to join. Share the room code.'
        : lobby.notReady > 0
          ? `Waiting for ${lobby.notReady} ${lobby.notReady === 1 ? 'player' : 'players'} to get ready.`
          : 'Everyone is ready. Start when you like.'
      : 'Waiting for the host to start the race.';
    return (
      <div className="panel build">
        <h2 className="title small">Build your monster</h2>
        {ui.roomCode && (
          <p className="room">
            Room code <b>{ui.roomCode}</b> · {ui.occupied}/{ui.maxPlayers} players
          </p>
        )}
        {raceOn && <p className="muted small">A race is in progress. You will be in the next one, once the host starts it.</p>}
        {frame.phase === 'RESULTS' && lobby.members.length < frame.players.filter((p) => p.joined).length && (
          <p className="muted small">Other players are still looking at the results. The host can start without them.</p>
        )}
        <div className="lobby-list">
          {racersNow.map((p) => {
            const inLobby = frame.phase === 'BUILD' || p.rematch;
            const label = !inLobby ? (p.inRace && raceOn ? 'racing' : 'viewing results') : p.host ? 'host' : p.ready ? 'ready' : 'choosing';
            return (
              <span key={p.slot} className={`lobby-player ${inLobby ? (p.host || p.ready ? 'ready' : '') : 'away'}`}>
                {nameOf(p.slot)}
                {p.slot === me.slot ? ' (you)' : ''} · {label}
              </span>
            );
          })}
        </div>
        <div className="build-grid">
        <div className="pickers">
        <div className="picker">
          <b>Body</b>
          <div className="chips">
            {BODIES.map((body, i) => (
              <button key={body.name} className={`chip ${ui.build.body === i ? 'on' : ''}`} disabled={ui.ready} onClick={() => pick('body', i)}>
                {body.name}
              </button>
            ))}
          </div>
        </div>
        {(
          [
            ['legs', 'Legs', LEG_PARTS],
            ['arms', 'Arms', ARM_PARTS],
            ['head', 'Head', HEAD_PARTS],
          ] as const
        ).map(([key, label, parts]) => (
          <div className={`picker ${key}`} key={key}>
            <b>{label}</b>
            <div className="chips">
              {parts.map((part, i) => (
                <button key={part.name} className={`chip ${ui.build[key] === i ? 'on' : ''}`} disabled={ui.ready && !isHost} onClick={() => pick(key, i)}>
                  {part.name}
                </button>
              ))}
            </div>
            <small>{parts[ui.build[key]]?.blurb}</small>
          </div>
        ))}
        </div>
        <div className="side">
        <div className="stats">
          <StatBar label="Top speed" value={stats.topKmh} max={110} text={`${stats.topKmh} km/h`} />
          <StatBar label="Acceleration" value={stats.accel} max={1.7} />
          <StatBar label="Grip" value={stats.grip} max={1.8} />
          <StatBar label="Durability" value={stats.hits} max={3} text={`${stats.hits} ${stats.hits === 1 ? 'hit' : 'hits'}`} />
        </div>
        <p className="muted small">{lobbyHint}</p>
        <div className="row">
          {isHost ? (
            <button className="btn primary" disabled={!lobby.canStart} onClick={() => game.startRace()}>
              Start race
            </button>
          ) : (
            <button className="btn primary" onClick={() => game.setReady(!ui.ready)}>
              {ui.ready ? 'Ready (tap to cancel)' : 'Ready'}
            </button>
          )}
          <button className="btn" onClick={() => game.leave()}>
            Leave
          </button>
        </div>
        </div>
        </div>
        <p className="muted small">{keysHelp(ui)}</p>
      </div>
    );
  }

  // A race is running and this player is not in it (they arrived late, or were still on the results when the host
  // started): they keep the last results they saw and can join the next race.
  if (raceOn && !me.inRace) {
    if (ui.cachedResults) {
      return <ResultsPanel game={game} names={ui.names} frame={ui.cachedResults} meSlot={ui.localSlot} mode="stale" banner="A new race is in progress without you. Tap Join next race to be in the one after." />;
    }
    return (
      <div className="panel center">
        <h2 className="title small">Race in progress</h2>
        <p className="muted small">You will be in the next one.</p>
        <div className="row">
          <button className="btn primary" onClick={() => game.rematch()}>
            Join next race
          </button>
          <button className="btn" onClick={() => game.leave()}>
            Back to menu
          </button>
        </div>
      </div>
    );
  }

  const racers = frame.players.filter((p) => p.inRace && !p.bot);
  const position =
    [...racers]
      .sort((a, b) => (b.finishTick >= 0 ? 1 : 0) - (a.finishTick >= 0 ? 1 : 0) || b.nextCheckpoint - a.nextCheckpoint)
      .findIndex((p) => p.slot === me.slot) + 1;

  return (
    <>
      <div className="hud">
        <div className="hud-top">
          <span>
            Pos {position}/{racers.length}
          </span>
          <span>
            CP {Math.min(me.nextCheckpoint, ui.checkpointTotal)}/{ui.checkpointTotal}
          </span>
          <span>{Math.round(me.speed * 3.6)} km/h</span>
        </div>
        <div className="part-slots">
          {(
            [
              ['legs', 'Legs', LEG_PARTS],
              ['arms', 'Arms', ARM_PARTS],
              ['head', 'Head', HEAD_PARTS],
            ] as const
          ).map(([key, label, parts]) => (
            <span key={key} className={`part-slot ${key} ${me.build[key] === 0 ? 'empty' : ''} ${frame.frame - me.lastLossTick < 45 ? 'flash' : ''}`}>
              <small>{label}</small>
              {me.build[key] === 0 ? 'empty' : parts[me.build[key]]?.name}
            </span>
          ))}
        </div>
        {ui.hint && me.finishTick < 0 && (
          <div className="waypoint">
            <div className="arrow" style={{ transform: `rotate(${-ui.hint.angle}deg)` }} />
            <span>{Math.round(ui.hint.distance)} m</span>
          </div>
        )}
        {frame.phase === 'COUNTDOWN' && <div className="big">{Math.max(1, Math.ceil((90 - frame.phaseTicks) / TICK))}</div>}
        {frame.phase === 'RACING' && frame.phaseTicks < 30 && <div className="big">GO!</div>}
        <div className="abilities">
          <AbilityButton
            label="Tentacles"
            hint="J"
            on={me.build.arms === ARM_TENTACLES}
            cd={me.armsCooldown}
            active={me.swingPole >= 0}
            onDown={() => game.controls.setTouchArms(true)}
            onUp={() => game.controls.setTouchArms(false)}
            secs={secs}
          />
          <AbilityButton
            label="Slime"
            hint="K"
            on={me.build.head === HEAD_SLIME}
            cd={me.headCooldown}
            active={me.trailing}
            onDown={() => game.controls.setTouchHead(true)}
            onUp={() => game.controls.setTouchHead(false)}
            secs={secs}
          />
          <button
            className="ability reset"
            onPointerDown={() => game.controls.setTouchReset(true)}
            onPointerUp={() => game.controls.setTouchReset(false)}
            onPointerLeave={() => game.controls.setTouchReset(false)}
          >
            Reset
          </button>
        </div>
        <SteerZone game={game} touch={ui.touch} />
        <button className="gfx" onClick={() => game.toggleMenu()}>
          Menu (Esc)
        </button>
        <div className="net">
          {ui.showInfo && <div>{ui.diag}</div>}
          {ui.roomCode && <div>{`room ${ui.roomCode} · ping ${ui.rttMs} ms · ${ui.connection}`}</div>}
        </div>
      </div>
      {(frame.phase === 'RESULTS' || me.finishTick >= 0) && (
        <ResultsPanel game={game} names={ui.names} frame={frame} meSlot={me.slot} mode={frame.phase === 'RESULTS' ? 'live' : 'finished'} />
      )}
      {ui.tip && me.finishTick < 0 && frame.phase !== 'RESULTS' && (
        <button className="tip" onClick={() => game.dismissTip()}>
          {ui.tip}
          <small>tap to dismiss</small>
        </button>
      )}
    </>
  );
}

function StatBar({ label, value, max, text }: { label: string; value: number; max: number; text?: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <div className="bar">
        <i style={{ width: `${Math.max(4, Math.min(100, (value / max) * 100))}%` }} />
      </div>
      <em>{text ?? value.toFixed(1)}</em>
    </div>
  );
}

function AbilityButton(props: {
  label: string;
  hint: string;
  on: boolean;
  cd: number;
  active: boolean;
  onDown: () => void;
  onUp: () => void;
  secs: (t: number) => string;
}) {
  const { label, hint, on, cd, active, onDown, onUp, secs } = props;
  return (
    <button
      className={`ability ${on ? '' : 'off'} ${active ? 'active' : ''} ${cd > 0 ? 'cooling' : ''}`}
      disabled={!on}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={onUp}
    >
      <b>{label}</b>
      <small>{!on ? 'empty' : cd > 0 ? `${secs(cd)}s` : hint}</small>
    </button>
  );
}

function SteerZone({ game, touch }: { game: Game; touch: boolean }) {
  const originX = useRef(0);
  const knob = useRef<HTMLDivElement | null>(null);
  const moveKnob = (dx: number) => {
    if (knob.current) knob.current.style.transform = `translateX(${Math.max(-1, Math.min(1, dx)) * 42}px)`;
  };
  return (
    <div
      className="steer-zone"
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return; // the mouse is for aiming, not steering
        originX.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
        game.controls.setTouchSteer(0);
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse' || e.buttons === 0) return;
        const value = (e.clientX - originX.current) / 60;
        game.controls.setTouchSteer(value);
        moveKnob(value);
      }}
      onPointerUp={() => {
        game.controls.setTouchSteer(0);
        moveKnob(0);
      }}
      onPointerCancel={() => {
        game.controls.setTouchSteer(0);
        moveKnob(0);
      }}
    >
      {touch && (
        <div className="joystick" aria-hidden="true">
          <span className="joy-arrow left">◀</span>
          <span className="joy-arrow right">▶</span>
          <div className="joy-knob" ref={knob} />
          <small>drag to steer</small>
        </div>
      )}
    </div>
  );
}

export default App;
