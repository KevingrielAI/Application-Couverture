'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TAMPON_MINUTES,
  plageProtegee,
  evenementsEnConflit,
  prochainsCreneauxLibres,
} = require('../services/creneaux');

const DEBUT = '2026-07-01T10:00:00.000Z';
const FIN = '2026-07-01T11:00:00.000Z';

function ev(id, debut, fin, extra = {}) {
  return { id, summary: id, start: { dateTime: debut }, end: { dateTime: fin }, ...extra };
}

test('le tampon est de 30 minutes', () => {
  assert.equal(TAMPON_MINUTES, 30);
});

test('plageProtegee étend de 30 min avant et après', () => {
  const { plageProtegeeDebut, plageProtegeeFin } = plageProtegee(DEBUT, FIN);
  assert.equal(plageProtegeeDebut.toISOString(), '2026-07-01T09:30:00.000Z');
  assert.equal(plageProtegeeFin.toISOString(), '2026-07-01T11:30:00.000Z');
});

test('un événement dans le tampon (11:15) crée un conflit', () => {
  const { plageProtegeeDebut, plageProtegeeFin } = plageProtegee(DEBUT, FIN);
  const evs = [ev('a', '2026-07-01T11:15:00Z', '2026-07-01T11:45:00Z')];
  const c = evenementsEnConflit(evs, plageProtegeeDebut, plageProtegeeFin);
  assert.equal(c.length, 1);
  assert.equal(c[0].id, 'a');
});

test('un événement hors tampon (11:45) ne crée pas de conflit', () => {
  const { plageProtegeeDebut, plageProtegeeFin } = plageProtegee(DEBUT, FIN);
  const evs = [ev('b', '2026-07-01T11:45:00Z', '2026-07-01T12:15:00Z')];
  assert.equal(evenementsEnConflit(evs, plageProtegeeDebut, plageProtegeeFin).length, 0);
});

test('un événement adjacent juste à la limite (09:00-09:30) ne crée pas de conflit', () => {
  const { plageProtegeeDebut, plageProtegeeFin } = plageProtegee(DEBUT, FIN);
  const evs = [ev('c', '2026-07-01T09:00:00Z', '2026-07-01T09:30:00Z')];
  assert.equal(evenementsEnConflit(evs, plageProtegeeDebut, plageProtegeeFin).length, 0);
});

test('un événement annulé est ignoré', () => {
  const { plageProtegeeDebut, plageProtegeeFin } = plageProtegee(DEBUT, FIN);
  const evs = [ev('d', '2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z', { status: 'cancelled' })];
  assert.equal(evenementsEnConflit(evs, plageProtegeeDebut, plageProtegeeFin).length, 0);
});

test('une invitation refusée par soi-même est ignorée', () => {
  const { plageProtegeeDebut, plageProtegeeFin } = plageProtegee(DEBUT, FIN);
  const evs = [ev('e', '2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z', {
    attendees: [{ self: true, responseStatus: 'declined' }],
  })];
  assert.equal(evenementsEnConflit(evs, plageProtegeeDebut, plageProtegeeFin).length, 0);
});

test('l’événement à ignorer (modification) est exclu', () => {
  const { plageProtegeeDebut, plageProtegeeFin } = plageProtegee(DEBUT, FIN);
  const evs = [ev('moi', '2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z')];
  assert.equal(evenementsEnConflit(evs, plageProtegeeDebut, plageProtegeeFin, 'moi').length, 0);
});

test('prochainsCreneauxLibres propose des créneaux respectant le tampon', () => {
  const evs = [ev('a', '2026-07-01T11:15:00Z', '2026-07-01T11:45:00Z')];
  const libres = prochainsCreneauxLibres(DEBUT, FIN, evs, { maxResultats: 1 });
  assert.equal(libres.length, 1);
  // Le créneau proposé ne doit pas chevaucher la plage protégée de l'événement.
  const debutLibre = new Date(libres[0].debut);
  // L'événement finit à 11:45 ; +30 min de tampon => au plus tôt 12:15.
  assert.ok(debutLibre >= new Date('2026-07-01T12:15:00Z'));
});

test('prochainsCreneauxLibres respecte la durée demandée', () => {
  const evs = [];
  const libres = prochainsCreneauxLibres(DEBUT, FIN, evs, { maxResultats: 1 });
  const dureeMs = new Date(libres[0].fin) - new Date(libres[0].debut);
  assert.equal(dureeMs, 60 * 60 * 1000);
});
