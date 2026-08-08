'use strict';
// index.js — le cablage du chien de garde cote serveur.
//
// Une seule instance, atteignable par ses deux appelants : event-reader (qui
// lui pousse les evenements) et les routes (qui lisent le journal). Le service
// est asynchrone a creer — il charge un module ESM — donc tant qu'il n'est pas
// pret, ou s'il n'a pas pu l'etre, `getWatchdogService()` rend null et
// l'appelant passe son chemin : un evenement manque au tout debut du demarrage
// est rattrape par catch-up.
//
// C'est ici, et nulle part ailleurs, que le detecteur et le journal se
// rencontrent. Donc c'est ici que leur horloge doit etre la MEME : le service
// ne peut pas reparer l'ecart apres coup, parce que le journal a deja relu son
// fichier quand il lui arrive. Voir `now` ci-dessous.

const { createJournal } = require('./journal');
const { createWatchdogService } = require('./service');
const { catchUpFromDisk } = require('./catch-up');

let _service = null;
let _pending = null;
let _catchingUp = false;

// Ce qui est memorise est la PROMESSE, pas la valeur resolue. Une garde posee
// sur la valeur (`if (_service) return _service`) ne tient pas : entre le test
// et l'affectation il y a un `await`, donc deux appels concurrents la
// franchissent tous les deux et fabriquent chacun leur service — chacun avec
// son propre journal, donc son propre `seen`, donc le meme fait consigne DEUX
// fois dans le meme fichier. C'est exactement le doublon que tout le reste de
// ce module existe pour empecher, et il ne se voit pas en enchainant deux
// `await` : il faut deux appels vraiment concurrents pour le produire.
//
// `opts || {}` plutot que la seule valeur par defaut du parametre : celle-ci ne
// joue que sur `undefined`. Un `null` litteral la traverse, et comme la
// deconstruction des parametres de `fabriquer` est HORS de son `try`, il y
// produit un TypeError — donc une promesse rejetee, memorisee, que personne
// n'attrape. C'est exactement le rejet non attrape que ce module ferme par
// ailleurs pour le module de detection absent, rouvert par la porte d'a cote.
function initWatchdog(opts) {
  if (!_pending) _pending = fabriquer(opts || {});
  return _pending;
}

// `journalPath` : ou vit le fichier du journal. Absent, le journal choisit son
// chemin par defaut (`~/.agent-viz/alerts.jsonl`), qui est ce que le serveur
// veut. L'option existe pour que ce module soit essayable sans ecrire dans le
// vrai `~` de l'utilisateur — sans elle, la seule branche que la production
// emprunte serait la seule qu'aucun test ne peut emprunter.
//
// Il n'y a deliberement PAS d'option pour fournir un journal deja construit :
// elle rouvrirait par la bande l'asymetrie que ce fichier ferme. Un journal
// fabrique ailleurs porte l'horloge de son fabricant, il a deja relu son
// fichier quand il arrive ici, et plus rien en aval ne peut le rattraper.
//
// `now` va au service ET au journal. Deux horloges qui se croisent ici ne
// donnent pas un decalage, elles donnent une perte de memoire : le journal
// perime a la relecture tout ce qui est vieux pour SON horloge, `seen` repart
// vide, et le rattrapage suivant reconsigne tout ce qu'il avait deja consigne.
// Le doublon ne se voit meme pas depuis `list()`, qui lit la memoire vive — il
// ne se voit que dans le fichier.
async function fabriquer({ journalPath, now = Date.now, ...rest }) {
  try {
    _service = await createWatchdogService({
      // `rest` d'abord : ce qui suit fait autorite. `isCatchingUp` en
      // particulier n'est pas surchargeable — c'est `runCatchUp` qui leve et
      // baisse ce drapeau, et un appelant qui le remplacerait rendrait le
      // balayage de demarrage muet sans que rien ne le dise.
      ...rest,
      journal: createJournal({ filePath: journalPath, now }),
      now,
      isCatchingUp: () => _catchingUp,
    });
    return _service;
  } catch (err) {
    // Le module de detection est un fichier du paquet : ne pas le charger veut
    // dire installation abimee, jamais etat normal. Mais le chien de garde est
    // un supplement — il ne doit pas emporter le serveur avec lui. On se
    // plaint une fois, on rend null, et tout le produit continue sans lui.
    // Meme parti que `journal.js` devant un journal illisible.
    //
    // La promesse rejetee reste memorisee resolue a null : pas de nouvelle
    // tentative, donc pas de seconde plainte. Un fichier absent du paquet ne
    // reapparaitra pas, et `initWatchdog` n'est appele qu'une fois au
    // demarrage.
    console.error('[watchdog] detection indisponible, les pannes ne seront pas surveillees :', err.message);
    return null;
  }
}

function getWatchdogService() { return _service; }
function setCatchingUp(v) { _catchingUp = !!v; }

// Le balayage de demarrage, drapeau compris : pendant qu'il tourne, `stuck`
// doit se taire, et il doit se retaire meme si la lecture echoue.
//
// `dir` n'a PAS de valeur par defaut, et c'est voulu. Le dossier des
// evenements est deja defini a deux endroits du produit (`lib/hook.js` et
// `lib/server/session-index.js`, qui l'exporte sous le nom `DIR`) ; en poser
// une troisieme copie ici creerait une constante qui peut diverger des deux
// autres, et un balayage qui lit le vide ne dit rien — c'est la promesse du
// produit qui tomberait sans symptome. Sans valeur par defaut, l'appelant ne
// peut pas oublier de nommer le dossier. Et s'il l'oublie quand meme, on le
// dit : sans cette plainte, l'oubli rendrait `0` comme un dossier vide.
//
// `liveFrom` traverse sans etre regarde : c'est le lecteur d'evenements qui
// sait ou son chemin vif prend la main sur chaque fichier, et `catch-up` qui
// s'arrete la. Ici on ne fait que le porter — le connaitre autrement
// qu'injecte voudrait dire dependre du lecteur d'evenements, qui depend deja de
// ce module.
async function runCatchUp(dir, liveFrom) {
  if (!dir) {
    console.error('[watchdog] rattrapage demande sans dossier d evenements : rien n a ete relu.');
    return 0;
  }
  if (!_service) return 0;
  setCatchingUp(true);
  try { return await catchUpFromDisk(_service, dir, liveFrom); }
  finally { setCatchingUp(false); }
}

// La sequence de demarrage du chien de garde, dans l'ordre qui est sa
// CONDITION : d'abord l'instance, puis le rattrapage de ce qui s'est passe
// serveur eteint, puis seulement le battement. Battre pendant un rattrapage
// ferait juger `stuck` sur une horloge qui n'est pas celle des evenements
// relus ; rattraper avant que l'instance existe ferait rendre 0 a `runCatchUp`,
// et le passe ne serait jamais relu.
//
// Pourquoi cette sequence vit ici et pas dans `lib/server.js` : `server.js` est
// un point d'entree, il se charge en ouvrant un port et en tuant le serveur
// d'avant. Aucun test ne peut l'appeler, donc rien de ce qu'on y ecrirait ne
// serait essayable — or les trois pieges de cette sequence (l'ordre, le dossier
// nomme, l'exception qui remonte) sont precisement ceux qu'on ne voit pas a la
// lecture. `server.js` garde ce qui est a lui : le vrai dossier et le vrai flux.
//
// Tout ce qui appartient au serveur est donc INJECTE, et ce module ne gagne
// aucun `require` : `dir` (c'est `session-index` qui fait autorite sur le
// dossier d'evenements), `liveFrom` (c'est le lecteur d'evenements qui sait ou
// son chemin vif prend la main), et `broadcastAlert`, qui recoit une ALERTE et
// rien d'autre — l'enveloppe du message est un detail du protocole du serveur,
// et ce module n'a pas a la connaitre pour se dire ignorant du flux.
//
// `cadenceMs` est injecte aussi, avec la valeur du client d'aujourd'hui
// (viz-watchdog-client.js) : on demenage `stuck`, on ne change pas son
// comportement en meme temps. Et `init` passe a `initWatchdog` ce qu'on lui
// aurait passe directement — meme raison que `journalPath` : sans cela, la
// seule branche que la production emprunte serait la seule qu'aucun test ne
// peut emprunter sans ecrire dans le vrai `~` de l'utilisateur.
//
// Rend le minuteur, pour que l'appelant puisse l'arreter. Le serveur ne s'en
// sert pas — il tourne jusqu'a l'extinction — mais un appelant qui lance une
// sequence doit pouvoir la rendre.
async function startWatchdog({ dir, broadcastAlert, liveFrom, cadenceMs = 5_000, init } = {}) {
  await initWatchdog(init);
  let relus = 0;
  try {
    relus = await runCatchUp(dir, liveFrom);
  } catch (err) {
    // `runCatchUp` propage l'exception du detecteur, deliberement : c'est a
    // l'appelant de decider ce qu'elle vaut. Ici elle vaut un demarrage sans le
    // passe — le chien de garde est un supplement, il ne doit pas emporter le
    // serveur avec lui. Le battement, lui, est lance quand meme : les pannes A
    // VENIR restent surveillees.
    console.error('[watchdog] rattrapage interrompu, le passe n a pas ete relu :', err.message);
  }
  // On rapporte le nombre relu, et on n'en conclut RIEN. `runCatchUp` rend 0
  // dans quatre situations differentes — pas de service, pas de dossier nomme,
  // dossier absent, dossier vide : les deux anormales se plaignent, les deux
  // normales se taisent. « Aucune panne pendant l'arret » serait donc une
  // affirmation que ce nombre ne porte pas.
  console.log(`[watchdog] rattrapage : ${relus} evenements relus`);
  // La panne du battement a-t-elle deja ete dite ? Une fois suffit : un
  // detecteur qui leve est une installation abimee, pas une condition qui
  // passe, et le battement bat toutes les cinq secondes — se plaindre a chaque
  // fois noierait la sortie sans rien apprendre de plus.
  let battementCasse = false;
  const battement = setInterval(() => {
    // Rien de ce qui suit ne doit pouvoir s'echapper. Une exception levee dans
    // un rappel de minuteur n'est attrapee par personne : elle TUE le demon —
    // le produit entier emporte par son supplement. Deux facons d'en lever une,
    // et les deux sont fermees ici : le service peut ne pas exister (relu a
    // chaque battement, pas capture une fois, car il peut arriver plus tard ou
    // jamais), et le detecteur peut lever. On se plaint, on saute ce battement,
    // le suivant reessaie.
    const wd = getWatchdogService();
    if (!wd) return;
    try {
      for (const alert of wd.tick()) broadcastAlert(alert);
    } catch (err) {
      if (!battementCasse) {
        battementCasse = true;
        console.error('[watchdog] battement en echec, les pannes qui durent ne seront plus signalees :', err.message);
      }
    }
  }, cadenceMs);
  // Le minuteur ne doit jamais retenir le processus a lui seul.
  battement.unref();
  return battement;
}

module.exports = {
  initWatchdog, getWatchdogService, setCatchingUp, runCatchUp,
  startWatchdog,
};
