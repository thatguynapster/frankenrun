import { useRef, useState, useCallback } from 'react';
import { GameScene } from './GameScene';
import type { GameState } from './GameEvents';
import './style.css';

function App() {
  const gameRef = useRef<GameScene | null>(null);
  const [score, setScore] = useState(0);
  const [gameState, setGameState] = useState<GameState>('loading');

  const sceneRef = useCallback((container: HTMLDivElement | null) => {
    if (container && !gameRef.current) {
      const game = new GameScene(container);
      gameRef.current = game;
      game.events.on('stateChange', setGameState);
      game.events.on('scoreChange', setScore);
    }
  }, []);

  const handleRestart = useCallback(() => {
    gameRef.current?.restart();
  }, []);

  return (
    <div className="app-container">
      <div ref={sceneRef} className="scene-container" />

      {gameState !== 'loading' && (
        <div className="hud">
          <div className="hud-score">{score}</div>

          {gameState === 'gameover' && (
            <div className="hud-gameover">
              <div className="hud-gameover-title">Game Over</div>
              <div className="hud-gameover-score">{score}</div>
              <button className="hud-gameover-btn" onClick={handleRestart}>
                Play Again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
