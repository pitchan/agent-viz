// bindPort prend un vrai port : occupé par un serveur TCP brut qui ne parle pas
// HTTP, il ne tue rien et le dit ; l'occupant est fermé par son handle, aucun
// processus fils n'est lancé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { bindPort, portInUseMessage } from '../../src/server/bind-port.ts';

async function intrusTcp() {
  const serveur = net.createServer(socket => socket.end());
  await new Promise(resolve => serveur.listen(0, '127.0.0.1', resolve));
  return {
    port: serveur.address().port,
    ecoute: () => serveur.listening,
    ferme: () => new Promise(resolve => serveur.close(resolve)),
  };
}

test('port occupé par un serveur TCP brut : bound false, l\'occupant écoute toujours', async () => {
  // Arrange
  const intrus = await intrusTcp();
  const serveur = http.createServer();
  try {
    // Act
    const resultat = await bindPort(serveur, intrus.port);
    // Assert
    assert.deepEqual(resultat, { bound: false, why: 'port-in-use' });
    assert.equal(intrus.ecoute(), true, 'rien ne devait être tué');
    assert.equal(serveur.listening, false);
  } finally {
    await intrus.ferme();
  }
});

test('port libre : bound true et le serveur écoute sur ce port', async () => {
  // Arrange
  const intrus = await intrusTcp();
  const port = intrus.port;
  await intrus.ferme();
  const serveur = http.createServer();
  try {
    // Act
    const resultat = await bindPort(serveur, port);
    // Assert
    assert.deepEqual(resultat, { bound: true });
    assert.equal(serveur.address().port, port);
  } finally {
    await new Promise(resolve => serveur.close(resolve));
  }
});

test('toute autre erreur de bind remonte telle quelle (port hors plage)', async () => {
  // Arrange
  const serveur = http.createServer();
  // Act
  const erreur = await bindPort(serveur, 70000).then(() => null, e => e);
  // Assert
  assert.ok(erreur, 'bindPort aurait dû rejeter');
  assert.equal(erreur.code, 'ERR_SOCKET_BAD_PORT');
});

test('le message nomme le port, dit que rien n\'a été tué et donne les deux gestes', () => {
  // Arrange
  const port = 4321;
  // Act
  const message = portInUseMessage(port);
  // Assert
  assert.match(message, /^agent-viz: port 4321 is already in use\. Nothing was killed\.$/m);
  assert.match(message, /agent-viz stop/);
  assert.match(message, /agent-viz start --port <N>/);
  assert.match(message, /netstat -ano \| findstr :4321/);
  assert.match(message, /lsof -iTCP:4321 -sTCP:LISTEN/);
});
