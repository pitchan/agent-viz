// bindPort prend un vrai port : occupé par un serveur TCP brut qui ne parle pas
// HTTP, il ne tue rien et le dit ; l'occupant est fermé par son handle, aucun
// processus fils n'est lancé.
import { expect, test } from 'vitest';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { bindPort, portInUseMessage } from '../../src/server/bind-port.ts';

async function intrusTcp() {
  const serveur = net.createServer(socket => socket.end());
  await new Promise<void>(resolve => serveur.listen(0, '127.0.0.1', resolve));
  return {
    port: (serveur.address() as AddressInfo).port,
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
    expect(resultat).toEqual({ bound: false, why: 'port-in-use' });
    expect(intrus.ecoute(), 'rien ne devait être tué').toBe(true);
    expect(serveur.listening).toBe(false);
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
    expect(resultat).toEqual({ bound: true });
    expect((serveur.address() as AddressInfo).port).toBe(port);
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
  expect(erreur, 'bindPort aurait dû rejeter').toBeTruthy();
  expect(erreur.code).toBe('ERR_SOCKET_BAD_PORT');
});

test('le message nomme le port, dit que rien n\'a été tué et donne les deux gestes', () => {
  // Arrange
  const port = 4321;
  // Act
  const message = portInUseMessage(port);
  // Assert
  expect(message).toMatch(/^agent-viz: port 4321 is already in use\. Nothing was killed\.$/m);
  expect(message).toMatch(/agent-viz stop/);
  expect(message).toMatch(/agent-viz start --port <N>/);
  expect(message).toMatch(/netstat -ano \| findstr :4321/);
  expect(message).toMatch(/lsof -iTCP:4321 -sTCP:LISTEN/);
});
