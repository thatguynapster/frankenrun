import { useCallback, useRef, useState } from 'react';
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import { Game, type UiState } from './Game';
import { ARMS, HEADS } from './sim/parts';
import type { Build } from './sim/game';
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
    <div className="app-container">
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
        <p className="title small">Connecting...</p>
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
  return <PlayOverlay game={game} ui={ui} />;
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

  const toggle = (key: keyof Build) => game.setBuild({ ...ui.build, [key]: !ui.build[key] });
  const secs = (t: number) => (t / TICK).toFixed(1);

  if (frame.phase === 'BUILD') {
    return (
      <div className="panel build">
        <h2 className="title small">Build your monster</h2>
        {ui.roomCode && (
          <p className="room">
            Room code <b>{ui.roomCode}</b> · {ui.occupied}/{ui.maxPlayers} players
          </p>
        )}
        <div className="slots">
          <button className={`slot legs ${ui.build.legs ? 'on' : ''}`} disabled={ui.ready} onClick={() => toggle('legs')}>
            <b>Legs</b>
            <span>Werewolf Legs</span>
            <small>Fast on straights, slides in corners</small>
          </button>
          <button className={`slot arms ${ui.build.arms ? 'on' : ''}`} disabled={ui.ready} onClick={() => toggle('arms')}>
            <b>Arms</b>
            <span>{ARMS.tentacles.name}</span>
            <small>Grab a pole and swing round it</small>
          </button>
          <button className={`slot head ${ui.build.head ? 'on' : ''}`} disabled={ui.ready} onClick={() => toggle('head')}>
            <b>Head</b>
            <span>{HEADS.slime.name}</span>
            <small>Drop a slick trail</small>
          </button>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => game.setReady(!ui.ready)}>
            {ui.ready ? 'Waiting... (tap to cancel)' : 'Ready'}
          </button>
          <button className="btn" onClick={() => game.leave()}>
            Leave
          </button>
        </div>
        <p className="muted small">Keys: W go · S brake · A/D steer (hold steer when stuck to turn around) · J tentacles · K slime · hold R to reset</p>
      </div>
    );
  }

  const position =
    [...frame.players]
      .sort((a, b) => (b.finishTick >= 0 ? 1 : 0) - (a.finishTick >= 0 ? 1 : 0) || b.nextCheckpoint - a.nextCheckpoint)
      .findIndex((p) => p.slot === me.slot) + 1;

  return (
    <>
      <div className="hud">
        <div className="hud-top">
          <span>
            Pos {position}/{frame.players.length}
          </span>
          <span>
            CP {Math.min(me.nextCheckpoint, ui.checkpointTotal)}/{ui.checkpointTotal}
          </span>
          <span>{Math.round(me.speed * 3.6)} km/h</span>
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
            on={me.build.arms}
            cd={me.armsCooldown}
            active={me.swingPole >= 0}
            onDown={() => game.controls.setTouchArms(true)}
            onUp={() => game.controls.setTouchArms(false)}
            secs={secs}
          />
          <AbilityButton
            label="Slime"
            hint="K"
            on={me.build.head}
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
        <SteerZone game={game} />
        <button className="gfx" onClick={() => game.cycleGraphics()}>
          Graphics: {ui.graphics}
        </button>
        <button className="gfx gfx2" onClick={() => game.toggleColliders()}>
          Colliders: {ui.showColliders ? 'on' : 'off'}
        </button>
        <div className="net">
          <div>{ui.diag}</div>
          {ui.roomCode && <div>{`room ${ui.roomCode} · ping ${ui.rttMs} ms · ${ui.connection}`}</div>}
        </div>
      </div>
      {(frame.phase === 'RESULTS' || me.finishTick >= 0) && (
        <div className="panel center results">
          <h2 className="title small">{frame.phase === 'RESULTS' ? 'Results' : 'Race complete!'}</h2>
          {frame.phase !== 'RESULTS' && <p className="muted small">Your time: {((me.finishTick - 90) / TICK).toFixed(1)}s. Waiting for the others to finish...</p>}
          <ol>
            {frame.finishOrder.map((slot, i) => {
              const t = frame.players[slot]?.finishTick ?? 0;
              return (
                <li key={i}>
                  Player {slot + 1}
                  {slot === me.slot ? ' (you)' : ''} - {((t - 90) / TICK).toFixed(1)}s
                </li>
              );
            })}
            {frame.players
              .filter((p) => p.finishTick < 0)
              .map((p) => (
                <li key={`dnf-${p.slot}`} className="muted">
                  Player {p.slot + 1} - {frame.phase === 'RESULTS' ? 'DNF' : 'racing...'}
                </li>
              ))}
          </ol>
          <button className="btn primary" onClick={() => game.leave()}>
            Back to menu
          </button>
        </div>
      )}
    </>
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

function SteerZone({ game }: { game: Game }) {
  const originX = useRef(0);
  return (
    <div
      className="steer-zone"
      onPointerDown={(e) => {
        originX.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
        game.controls.setTouchSteer(0);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 0) return;
        game.controls.setTouchSteer((e.clientX - originX.current) / 60);
      }}
      onPointerUp={() => game.controls.setTouchSteer(0)}
      onPointerCancel={() => game.controls.setTouchSteer(0)}
    />
  );
}

export default App;
