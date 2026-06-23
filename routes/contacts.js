'use strict';

const express = require('express');
const { db } = require('../db/database');
const { exigerAuth } = require('../middleware/auth');

const router = express.Router();
router.use(exigerAuth);

// Liste des contacts — filtrable par activité (?activite_id=) et recherche (?q=)
router.get('/', (req, res) => {
  const uid = req.session.utilisateurId;
  const { activite_id, q } = req.query;

  let sql = `
    SELECT c.*, a.nom AS activite_nom, a.couleur AS activite_couleur
    FROM contacts c
    LEFT JOIN activites a ON a.id = c.activite_id
    WHERE c.utilisateur_id = ?`;
  const params = [uid];

  if (activite_id) {
    sql += ' AND c.activite_id = ?';
    params.push(activite_id);
  }
  if (q && q.trim()) {
    sql += ' AND (c.nom LIKE ? OR c.prenom LIKE ? OR c.email LIKE ?)';
    const like = `%${q.trim()}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY c.nom, c.prenom';

  res.json(db.prepare(sql).all(...params));
});

// Détail d'un contact
router.get('/:id', (req, res) => {
  const c = db
    .prepare('SELECT * FROM contacts WHERE id = ? AND utilisateur_id = ?')
    .get(req.params.id, req.session.utilisateurId);
  if (!c) return res.status(404).json({ erreur: 'Contact introuvable.' });
  res.json(c);
});

function validerActivite(uid, activiteId) {
  if (!activiteId) return null;
  const a = db
    .prepare('SELECT id FROM activites WHERE id = ? AND utilisateur_id = ?')
    .get(activiteId, uid);
  return a ? a.id : null;
}

// Créer un contact
router.post('/', (req, res) => {
  const uid = req.session.utilisateurId;
  const { nom, prenom, email, telephone, activite_id, notes } = req.body || {};
  if (!nom || !nom.trim()) return res.status(400).json({ erreur: 'Le nom est requis.' });

  const info = db
    .prepare(
      `INSERT INTO contacts (nom, prenom, email, telephone, activite_id, notes, utilisateur_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      nom.trim(),
      prenom || null,
      email || null,
      telephone || null,
      validerActivite(uid, activite_id),
      notes || null,
      uid
    );
  res.status(201).json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid));
});

// Modifier un contact
router.put('/:id', (req, res) => {
  const uid = req.session.utilisateurId;
  const c = db
    .prepare('SELECT * FROM contacts WHERE id = ? AND utilisateur_id = ?')
    .get(req.params.id, uid);
  if (!c) return res.status(404).json({ erreur: 'Contact introuvable.' });

  const { nom, prenom, email, telephone, activite_id, notes } = req.body || {};
  db.prepare(
    `UPDATE contacts SET nom = ?, prenom = ?, email = ?, telephone = ?, activite_id = ?, notes = ?
     WHERE id = ?`
  ).run(
    nom != null ? nom.trim() : c.nom,
    prenom !== undefined ? prenom : c.prenom,
    email !== undefined ? email : c.email,
    telephone !== undefined ? telephone : c.telephone,
    activite_id !== undefined ? validerActivite(uid, activite_id) : c.activite_id,
    notes !== undefined ? notes : c.notes,
    c.id
  );
  res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(c.id));
});

// Supprimer un contact
router.delete('/:id', (req, res) => {
  const c = db
    .prepare('SELECT id FROM contacts WHERE id = ? AND utilisateur_id = ?')
    .get(req.params.id, req.session.utilisateurId);
  if (!c) return res.status(404).json({ erreur: 'Contact introuvable.' });
  db.prepare('DELETE FROM contacts WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

module.exports = router;
