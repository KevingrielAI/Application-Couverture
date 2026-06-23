'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { murEnUTC, estFuseauValide } = require('../services/temps');

test('murEnUTC convertit une heure murale Paris en été (UTC+2)', () => {
  const d = murEnUTC('2026-07-01', '10:00', 'Europe/Paris');
  assert.equal(d.toISOString(), '2026-07-01T08:00:00.000Z');
});

test('murEnUTC convertit une heure murale Paris en hiver (UTC+1)', () => {
  const d = murEnUTC('2026-01-15', '10:00', 'Europe/Paris');
  assert.equal(d.toISOString(), '2026-01-15T09:00:00.000Z');
});

test('murEnUTC gère UTC à l’identique', () => {
  const d = murEnUTC('2026-07-01', '10:00', 'UTC');
  assert.equal(d.toISOString(), '2026-07-01T10:00:00.000Z');
});

test('murEnUTC convertit New York en été (UTC-4)', () => {
  const d = murEnUTC('2026-07-01', '09:00', 'America/New_York');
  assert.equal(d.toISOString(), '2026-07-01T13:00:00.000Z');
});

test('estFuseauValide reconnaît un fuseau IANA et rejette un invalide', () => {
  assert.equal(estFuseauValide('Europe/Paris'), true);
  assert.equal(estFuseauValide('Mars/Olympus'), false);
  assert.equal(estFuseauValide(''), false);
});

test('murEnUTC renvoie null sur entrée incomplète', () => {
  assert.equal(murEnUTC('', '10:00', 'UTC'), null);
  assert.equal(murEnUTC('2026-07-01', '', 'UTC'), null);
});
