'use strict';

// Exige une session authentifiée pour les routes API.
function exigerAuth(req, res, next) {
  if (req.session && req.session.utilisateurId) return next();
  return res.status(401).json({ erreur: 'Non authentifié' });
}

module.exports = { exigerAuth };
