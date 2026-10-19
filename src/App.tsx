import { ROUTES, routeInfo } from './routes.js';
import { SHOW_LEADERBOARD, formatTime } from './leaderboard.js';
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
  if (ui.screen === 'title' && ui.invite !== null) {
    return (
      <div className="panel center">
        <h1 className="title small">{ui.invite.host ? `${ui.invite.host} invited you` : 'You are invited'}</h1>
        <p className="muted">
          Join the race in room <b>{ui.invite.room}</b>?
        </p>
        <div className="row">
          <button className="btn primary" onClick={() => void game.acceptInvite()}>
            Join race
          </button>
          <button className="btn" onClick={() => game.declineInvite()}>
            Not now
          </button>
        </div>
      </div>
    );
  }
  if (ui.screen === 'title' && ui.board !== null) {
    const b = ui.board;
    return (
      <div className="panel center routes">
        <h1 className="title small">Best times</h1>
        <div className="chips">
          {ROUTES.map((r) => (
            <button key={r.id} className={`chip ${b.route === r.id ? 'on' : ''}`} onClick={() => game.openBoard(r.id, b.period)}>
              {r.name}
            </button>
          ))}
        </div>
        <div className="chips">
          <button className={`chip ${b.period === 'alltime' ? 'on' : ''}`} onClick={() => game.openBoard(b.route, 'alltime')}>
            All time
          </button>
          <button className={`chip ${b.period === 'weekly' ? 'on' : ''}`} onClick={() => game.openBoard(b.route, 'weekly')}>
            This week
          </button>
        </div>
        {b.loading && <p className="muted">Loading...</p>}
        {!b.loading && b.data === null && <p className="muted">The leaderboard is not available right now.</p>}
        {b.data !== null && b.data.entries.length === 0 && <p className="muted">No times yet. Be the first to finish this route!</p>}
        {b.data !== null && b.data.entries.length > 0 && (
          <ol className="board">
            {b.data.entries.map((e) => (
              <li key={e.rank} className={e.mine ? 'mine' : ''}>
                <span className="rk">{e.rank}</span>
                <span className="nm">{e.name}</span>
                <span className="tm">{formatTime(e.ms)}</span>
              </li>
            ))}
          </ol>
        )}
        {b.data !== null && b.data.myRank !== null && <p className="muted small">Your rank: {b.data.myRank} of {b.data.total}</p>}
        <button className="btn" onClick={() => game.closeBoard()}>
          Back
        </button>
      </div>
    );
  }
  if (ui.screen === 'title' && ui.picking !== null) {
    return (
      <div className="panel center routes">
        <h1 className="title small">{ui.picking === 'host' ? 'Pick the route for your race' : 'Pick a route to practise'}</h1>
        <div className="route-carousel">
          <button className="carousel-arrow" aria-label="Previous routes" disabled={ui.routeOffset === 0} onClick={() => game.scrollRoutes(-1)}>
            ‹
          </button>
          <div className="route-list">
            {ROUTES.slice(ui.routeOffset, ui.routeOffset + 3).map((r) => (
              <button key={r.id} className="route" onClick={() => void game.startOn(r.id)}>
                <img src={`route-previews/${r.id}.svg`} alt={`Map of ${r.name}`} draggable={false} />
                <b>{r.name}</b>
                <span className="km">{r.km.toFixed(1)} km</span>
                <small>{r.blurb}</small>
              </button>
            ))}
          </div>
          <button className="carousel-arrow" aria-label="Next routes" disabled={ui.routeOffset >= ROUTES.length - 3} onClick={() => game.scrollRoutes(1)}>
            ›
          </button>
        </div>
        <button className="btn" onClick={() => game.cancelRoutePick()}>
          Back
        </button>
      </div>
    );
  }
  if (ui.screen === 'title') {
    return (
      <div className="panel center">
        <h1 className="title">FRANKENRUN</h1>
        <p className="muted">Stitch a monster. Race it. Steal the win.</p>
        <button className="btn primary" onClick={() => void game.quick()}>
          Quick match
          <small className="sub">Today: {routeInfo(ui.featuredRoute)?.name}</small>
        </button>
        {SHOW_LEADERBOARD && (
          <button className="btn" onClick={() => game.openBoard()}>
            Best times
          </button>
        )}
        <button className="btn" onClick={() => game.chooseRoute('practice')}>
          Practice (offline)
        </button>
        <button className="btn" onClick={() => game.chooseRoute('host')}>
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
  if (ui.touch) return 'Drag on the left to steer · tap the buttons for abilities · swipe Slime up to throw it ahead, down to throw it behind · hold Reset to return to the last checkpoint';
  return 'W go · S brake · A/D steer (hold steer when stuck to turn around) · J tentacles · K slime behind · I slime ahead · hold R to reset · Space to get up if you fall over · Esc menu';
}

function ResultsPanel({ game, frame, meSlot, mode, banner, names, shareNote, sub }: { game: Game; frame: GameProjection; meSlot: number; mode: 'live' | 'finished' | 'stale'; banner?: string; names: Readonly<Record<number, string>>; shareNote: string; sub: UiState['lastSubmission'] }) {
  const me = frame.players[meSlot];
  const nameOf = (slot: number): string => names[slot] ?? `Player ${slot + 1}`;
  const racers = frame.players.filter((p) => p.inRace && !p.bot);
  return (
    <div className="panel center results">
      <h2 className="title small">{mode === 'finished' ? 'Race complete!' : 'Results'}</h2>
      {frame.mapId && <p className="muted small">{routeInfo(frame.mapId)?.name ?? frame.mapId}</p>}
      {mode === 'finished' && me && <p className="muted small">Your time: {((me.finishTick - frame.raceStart) / TICK).toFixed(1)}s. Waiting for the others to finish...</p>}
      {banner && <p className="muted small">{banner}</p>}
      {shareNote && <p className="muted small">{shareNote}</p>}
      {SHOW_LEADERBOARD && sub && sub.route === frame.mapId && me && me.finishTick >= 0 && (
        <p className="muted small">
          {sub.result === null
            ? 'Recording your time...'
            : sub.result.accepted
              ? `New best time ${formatTime(sub.ms)}${sub.result.rank !== null ? ` · rank ${sub.result.rank} on ${routeInfo(frame.mapId)?.name ?? 'this route'}` : ''}`
              : `Your time ${formatTime(sub.ms)} is not your best on this route`}
        </p>
      )}
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
        {me && me.finishTick >= 0 && (
          <button className="btn" onClick={() => void game.shareMyResult()}>
            Share result
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
  const dragX = useRef<number | null>(null); // the pointer position while the lobby monster is being turned
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
    const lobbyHint = isHost
      ? lobby.count < 2
        ? 'Waiting for another player to join. Share the room code.'
        : lobby.notReady > 0
          ? `Waiting for ${lobby.notReady} ${lobby.notReady === 1 ? 'player' : 'players'} to get ready.`
          : 'Everyone is ready. Start when you like.'
      : 'Waiting for the host to start the race.';
    const tabs = [
      { key: 'body', label: 'Body', items: BODIES.map((x, i) => ({ id: i, name: x.name, blurb: i === 0 ? 'Heavy: takes 3 hits before a part falls off' : 'Light and quick: loses a part on the first hit' })) },
      { key: 'legs', label: 'Legs', items: LEG_PARTS.map((x, i) => ({ id: i, name: x.name, blurb: x.blurb })) },
      { key: 'arms', label: 'Arms', items: ARM_PARTS.map((x, i) => ({ id: i, name: x.name, blurb: x.blurb })) },
      { key: 'head', label: 'Head', items: HEAD_PARTS.map((x, i) => ({ id: i, name: x.name, blurb: x.blurb })) },
    ] as const;
    const tab = tabs.find((t) => t.key === ui.lobbyTab) ?? tabs[0];
    const locked = tab.key === 'body' ? ui.ready : ui.ready && !isHost;
    return (
      <div className="panel lobby">
        <div
          className="lobby-drag"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragX.current = e.clientX;
          }}
          onPointerMove={(e) => {
            if (dragX.current === null) return;
            game.rotateLobby(e.clientX - dragX.current);
            dragX.current = e.clientX;
          }}
          onPointerUp={() => {
            dragX.current = null;
          }}
          onPointerCancel={() => {
            dragX.current = null;
          }}
        />
        <div className="lobby-names">
          {ui.labels.map((l) => {
            const p = frame.players[l.slot];
            const inLobby = frame.phase === 'BUILD' || p?.rematch === true;
            return (
              <span key={l.slot} className={`name-tag ${p?.host || p?.ready ? 'ready' : ''} ${inLobby ? '' : 'away'}`} style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%` }}>
                {nameOf(l.slot)}
                {l.slot === me.slot ? ' (you)' : ''}
                {p?.host ? ' ★' : ''}
              </span>
            );
          })}
        </div>
        <div className="lobby-side">
          <div className="lobby-head">
            <div>
              <h2 className="title small">Stitch your monster</h2>
              {frame.mapId && <p className="muted small">Route: {routeInfo(frame.mapId)?.name ?? frame.mapId}</p>}
            </div>
            {ui.roomCode && (
              <p className="room">
                Room <b>{ui.roomCode}</b> · {ui.occupied}/{ui.maxPlayers}
                <button className="chip share" onClick={() => void game.shareRoomLink()}>
                  Share link
                </button>
              </p>
            )}
          </div>
          {ui.shareNote && <p className="muted small">{ui.shareNote}</p>}
          {raceOn && <p className="muted small">A race is in progress. You will be in the next one, once the host starts it.</p>}
          {frame.phase === 'RESULTS' && lobby.members.length < frame.players.filter((p) => p.joined).length && (
            <p className="muted small">Other players are still looking at the results. The host can start without them.</p>
          )}
          <div className="tabs">
            {tabs.map((t) => (
              <button key={t.key} className={`tab ${t.key} ${tab.key === t.key ? 'on' : ''}`} onClick={() => game.setLobbyTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="option-grid">
            {tab.items.map((item) => (
              <button key={item.name} className={`option ${tab.key} ${ui.build[tab.key] === item.id ? 'on' : ''}`} disabled={locked} onClick={() => pick(tab.key, item.id)}>
                {ui.icons[`${tab.key}:${item.id}`] ? <img src={ui.icons[`${tab.key}:${item.id}`]} alt="" draggable={false} /> : <span className="icon-fallback" />}
                <b>{item.name}</b>
              </button>
            ))}
          </div>
          <p className="blurb">{tab.items[ui.build[tab.key]]?.blurb}</p>
          <div className="stats compact">
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
    );
  }

  // A race is running and this player is not in it (they arrived late, or were still on the results when the host
  // started): they keep the last results they saw and can join the next race.
  if (raceOn && !me.inRace) {
    if (ui.cachedResults) {
      return <ResultsPanel game={game} names={ui.names} shareNote={ui.shareNote} sub={ui.lastSubmission} frame={ui.cachedResults} meSlot={ui.localSlot} mode="stale" banner="A new race is in progress without you. Tap Join next race to be in the one after." />;
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
        {me.tipped && frame.phase === 'RACING' && me.finishTick < 0 && (
          <button
            className="getup"
            onPointerDown={() => game.controls.setTouchGetUp(true)}
            onPointerUp={() => game.controls.setTouchGetUp(false)}
            onPointerLeave={() => game.controls.setTouchGetUp(false)}
          >
            Get up
            {!ui.touch && <small>Space</small>}
          </button>
        )}
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
          <SlimeButton
            hint={ui.touch ? 'swipe' : 'K / I'}
            on={me.build.head === HEAD_SLIME}
            cd={me.headCooldown}
            active={me.trailing}
            onThrow={(forward) => game.controls.pulseSlime(forward)}
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
        <ResultsPanel game={game} names={ui.names} shareNote={ui.shareNote} sub={ui.lastSubmission} frame={frame} meSlot={me.slot} mode={frame.phase === 'RESULTS' ? 'live' : 'finished'} />
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

/**
 * The slime button. A tap throws the slime behind you; swiping the button up throws it ahead, swiping it down throws it
 * behind. The throw happens when the swipe passes a short distance, or when the finger lifts after a tap.
 */
function SlimeButton(props: { hint: string; on: boolean; cd: number; active: boolean; onThrow: (forward: boolean) => void; secs: (t: number) => string }) {
  const { hint, on, cd, active, onThrow, secs } = props;
  const start = useRef<{ y: number; done: boolean } | null>(null);
  return (
    <button
      className={`ability ${on ? '' : 'off'} ${active ? 'active' : ''} ${cd > 0 ? 'cooling' : ''}`}
      disabled={!on}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, done: false };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s === null || s.done) return;
        const dy = e.clientY - s.y;
        if (Math.abs(dy) >= 24) {
          s.done = true;
          onThrow(dy < 0);
        }
      }}
      onPointerUp={() => {
        const s = start.current;
        start.current = null;
        if (s !== null && !s.done) onThrow(false);
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
    >
      <b>Slime</b>
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
