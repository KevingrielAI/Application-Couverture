'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'app.sqlite');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Applique le schéma (idempotent grâce aux IF NOT EXISTS).
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Activités préremplies à la création de chaque compte.
const ACTIVITES_PAR_DEFAUT = [
  { nom: 'Consultation digitale', couleur: '#3b82f6' },
  { nom: 'Immobilier commercial', couleur: '#16a34a' },
  { nom: 'EffAzur nettoyage', couleur: '#f59e0b' },
];

function creerActivitesParDefaut(utilisateurId) {
  const stmt = db.prepare(
    'INSERT INTO activites (nom, couleur, utilisateur_id) VALUES (?, ?, ?)'
  );
  const tx = db.transaction(() => {
    for (const a of ACTIVITES_PAR_DEFAUT) stmt.run(a.nom, a.couleur, utilisateurId);
  });
  tx();
}

module.exports = { db, creerActivitesParDefaut, ACTIVITES_PAR_DEFAUT };
