'use strict';

const express = require('express');
const { exigerAuth } = require('../middleware/auth');
const {
  genererUrlAutorisation,
  echangerCodeEtSauver,
  estConnecte,
} = require('../services/googleCalendar');
const { db } = require('../db/database');

const router = express.Router();

// Démarre le flux OAuth — renvoie l'URL de consentement.
router.get('/connect', exigerAuth, (req, res) => {
  try {
    const url = genererUrlAutorisation(req.session.utilisateurId);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ erreur: e.message });
  }
});

// Callback de redirection Google.
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/?google=erreur');
  if (!code || !state) return res.redirect('/?google=erreur');

  // `state` contient l'id utilisateur ; on vérifie qu'il correspond à la session.
  const utilisateurId = Number(state);
  if (!req.session.utilisateurId || req.session.utilisateurId !== utilisateurId) {
    return res.redirect('/?google=session');
  }

  try {
    await echangerCodeEtSauver(code, utilisateurId);
    res.redirect('/?google=ok');
  } catch (e) {
    console.error('Echec OAuth Google:', e.message);
    res.redirect('/?google=erreur');
  }
});

// État de la connexion Google
router.get('/status', exigerAuth, (req, res) => {
  res.json({ connecte: estConnecte(req.session.utilisateurId) });
});

// Déconnexion du calendrier Google (efface le token)
router.post('/disconnect', exigerAuth, (req, res) => {
  db.prepare('UPDATE utilisateurs SET google_token = NULL WHERE id = ?').run(
    req.session.utilisateurId
  );
  res.json({ ok: true });
});

module.exports = router;
