'use strict';

const express = require('express');
const { db } = require('../db/database');
const { exigerAuth } = require('../middleware/auth');

const router = express.Router();
router.use(exigerAuth);

// Liste des activités de l'utilisateur
router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM activites WHERE utilisateur_id = ? ORDER BY nom')
    .all(req.session.utilisateurId);
  res.json(rows);
});

// Créer une activité
router.post('/', (req, res) => {
  const { nom, couleur } = req.body || {};
  if (!nom || !nom.trim()) return res.status(400).json({ erreur: 'Le nom est requis.' });
  const info = db
    .prepare('INSERT INTO activites (nom, couleur, utilisateur_id) VALUES (?, ?, ?)')
    .run(nom.trim(), couleur || '#3b82f6', req.session.utilisateurId);
  res.status(201).json(db.prepare('SELECT * FROM activites WHERE id = ?').get(info.lastInsertRowid));
});

// Modifier une activité
router.put('/:id', (req, res) => {
  const { nom, couleur } = req.body || {};
  const a = db
    .prepare('SELECT * FROM activites WHERE id = ? AND utilisateur_id = ?')
    .get(req.params.id, req.session.utilisateurId);
  if (!a) return res.status(404).json({ erreur: 'Activité introuvable.' });
  db.prepare('UPDATE activites SET nom = ?, couleur = ? WHERE id = ?').run(
    nom != null ? nom.trim() : a.nom,
    couleur || a.couleur,
    a.id
  );
  res.json(db.prepare('SELECT * FROM activites WHERE id = ?').get(a.id));
});

// Supprimer une activité
router.delete('/:id', (req, res) => {
  const a = db
    .prepare('SELECT id FROM activites WHERE id = ? AND utilisateur_id = ?')
    .get(req.params.id, req.session.utilisateurId);
  if (!a) return res.status(404).json({ erreur: 'Activité introuvable.' });
  db.prepare('DELETE FROM activites WHERE id = ?').run(a.id);
  res.json({ ok: true });
});

module.exports = router;
