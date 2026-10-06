// Point d'entrée de la page. C'est un fichier et non un script en ligne dans
// index.html : la politique de la page n'exécute que les scripts servis par le
// serveur.
//
// Order: state → canvas (registers tick) → layout → ui → network.
// viz-ui and viz-network have a benign import cycle; ES modules handle it
// because all cross-calls happen inside event handlers.
import './viz-state.ts';
import './viz-canvas.ts';
import './viz-layout.ts';
import './viz-ui.ts';
import { loadSessions, connectSSE, poll } from './viz-network.ts';
import { garbageCollect } from './viz-layout.ts';
import { requestRender } from './viz-state.ts';
import { initAdvisor } from './observatory/advisor-view.ts';
import { initAnalysis } from './observatory/analysis-view.ts';
import { initPricing } from './observatory/pricing-view.ts';
import { initSkills } from './observatory/skills-view.ts';

initAdvisor();
initAnalysis();
initPricing();
initSkills();
loadSessions();
connectSSE();
poll();
setInterval(garbageCollect, 60000);
requestRender();
