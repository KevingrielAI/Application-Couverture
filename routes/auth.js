'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db, creerActivitesParDefaut } = require('../db/database');
const { exigerAuth } = require('../middleware/auth');
const { estConnecte } = require('../services/googleCalendar');
const { estFuseauValide, FUSEAUX_USUELS } = require('../services/temps');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Inscription
router.post('/register', (req, res) => {
  const { nom, email, mot_de_passe } = req.body || {};
  if (!nom || !email || !mot_de_passe) {
    return res.status(400).json({ erreur: 'Nom, email et mot de passe sont requis.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ erreur: 'Adresse email invalide.' });
  }
  if (String(mot_de_passe).length < 6) {
    return res.status(400).json({ erreur: 'Le mot de passe doit contenir au moins 6 caractères.' });
  }

  const existant = db.prepare('SELECT id FROM utilisateurs WHERE email = ?').get(email.toLowerCase());
  if (existant) {
    return res.status(409).json({ erreur: 'Un compte existe déjà avec cet email.' });
  }

  const hash = bcrypt.hashSync(String(mot_de_passe), 10);
  const info = db
    .prepare('INSERT INTO utilisateurs (nom, email, mot_de_passe_hash) VALUES (?, ?, ?)')
    .run(nom.trim(), email.toLowerCase(), hash);

  const utilisateurId = info.lastInsertRowid;
  creerActivitesParDefaut(utilisateurId); // préremplit les 3 activités

  req.session.utilisateurId = utilisateurId;
  res.status(201).json({ id: utilisateurId, nom: nom.trim(), email: email.toLowerCase() });
});

// Connexion
router.post('/login', (req, res) => {
  const { email, mot_de_passe } = req.body || {};
  if (!email || !mot_de_passe) {
    return res.status(400).json({ erreur: 'Email et mot de passe requis.' });
  }
  const u = db.prepare('SELECT * FROM utilisateurs WHERE email = ?').get(String(email).toLowerCase());
  if (!u || !bcrypt.compareSync(String(mot_de_passe), u.mot_de_passe_hash)) {
    return res.status(401).json({ erreur: 'Email ou mot de passe incorrect.' });
  }
  req.session.utilisateurId = u.id;
  res.json({ id: u.id, nom: u.nom, email: u.email });
});

// Déconnexion
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Utilisateur courant + état de la connexion Google
router.get('/me', exigerAuth, (req, res) => {
  const u = db
    .prepare('SELECT id, nom, email, google_calendar_id, fuseau_horaire, date_creation FROM utilisateurs WHERE id = ?')
    .get(req.session.utilisateurId);
  if (!u) return res.status(401).json({ erreur: 'Session invalide.' });
  res.json({ ...u, google_connecte: estConnecte(u.id), fuseaux_usuels: FUSEAUX_USUELS });
});

// Mise à jour du profil (nom + fuseau horaire)
router.put('/profil', exigerAuth, (req, res) => {
  const { nom, fuseau_horaire } = req.body || {};
  const u = db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(req.session.utilisateurId);
  if (!u) return res.status(401).json({ erreur: 'Session invalide.' });

  let fuseau = u.fuseau_horaire;
  if (fuseau_horaire !== undefined) {
    if (!estFuseauValide(fuseau_horaire)) {
      return res.status(400).json({ erreur: 'Fuseau horaire invalide.' });
    }
    fuseau = fuseau_horaire;
  }
  const nomFinal = nom && nom.trim() ? nom.trim() : u.nom;
  db.prepare('UPDATE utilisateurs SET nom = ?, fuseau_horaire = ? WHERE id = ?').run(nomFinal, fuseau, u.id);
  res.json({ id: u.id, nom: nomFinal, fuseau_horaire: fuseau });
});

module.exports = router;
