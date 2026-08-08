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
function initWatchdog(opts = {}) {
  if (!_pending) _pending = fabriquer(opts);
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
async function runCatchUp(dir) {
  if (!dir) {
    console.error('[watchdog] rattrapage demande sans dossier d evenements : rien n a ete relu.');
    return 0;
  }
  if (!_service) return 0;
  setCatchingUp(true);
  try { return await catchUpFromDisk(_service, dir); }
  finally { setCatchingUp(false); }
}

module.exports = { initWatchdog, getWatchdogService, setCatchingUp, runCatchUp };
