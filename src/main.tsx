import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { theme, applyTheme } from './theme';

RundotGameAPI.analytics.recordCustomEvent('game_loaded');

RundotGameAPI.lifecycles.onPause(() => {
  RundotGameAPI.analytics.recordCustomEvent('game_paused');
});
RundotGameAPI.lifecycles.onResume(() => {
  RundotGameAPI.analytics.recordCustomEvent('game_resumed');
});
RundotGameAPI.lifecycles.onSleep(() => {
  RundotGameAPI.analytics.recordCustomEvent('game_sleep');
});
RundotGameAPI.lifecycles.onQuit(() => {
  RundotGameAPI.analytics.recordCustomEvent('game_quit');
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('[Template React Simple] Root element not found');
}

const root = createRoot(rootElement);

const render = (node: ReactNode) => {
  root.render(<StrictMode>{node}</StrictMode>);
};

applyTheme(theme);

render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
