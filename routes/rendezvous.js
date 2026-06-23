'use strict';

const express = require('express');
const { db } = require('../db/database');
const { exigerAuth } = require('../middleware/auth');
const {
  estConnecte,
  listerEvenements,
  insererEvenement,
  supprimerEvenement,
} = require('../services/googleCalendar');
const {
  TAMPON_MINUTES,
  plageProtegee,
  evenementsEnConflit,
  prochainsCreneauxLibres,
} = require('../services/creneaux');
const { murEnUTC, FUSEAU_DEFAUT } = require('../services/temps');

const router = express.Router();
router.use(exigerAuth);

function valideISO(s) {
  if (!s) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function fuseauUtilisateur(uid) {
  const r = db.prepare('SELECT fuseau_horaire FROM utilisateurs WHERE id = ?').get(uid);
  return (r && r.fuseau_horaire) || FUSEAU_DEFAUT;
}

// Résout le créneau en instants UTC à partir du corps de requête.
// Accepte l'heure murale { date:'AAAA-MM-JJ', heure_debut:'HH:MM', heure_fin:'HH:MM' }
// interprétée dans le fuseau de l'utilisateur, ou des ISO complets (rétro-compat).
function resoudreCreneau(body, tz) {
  const { date, heure_debut, heure_fin } = body || {};
  const estHHMM = (s) => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s);
  if (date && estHHMM(heure_debut) && estHHMM(heure_fin)) {
    const debut = murEnUTC(date, heure_debut, tz);
    const fin = murEnUTC(date, heure_fin, tz);
    return { debut, fin };
  }
  // Rétro-compatibilité : ISO complets.
  const debut = valideISO(heure_debut) ? new Date(heure_debut) : null;
  const fin = valideISO(heure_fin) ? new Date(heure_fin) : null;
  return { debut, fin };
}

// ---------------------------------------------------------------------------
// VÉRIFICATION DU CRÉNEAU (logique métier centrale)
// POST /api/rendezvous/verifier  { heure_debut, heure_fin }
// ---------------------------------------------------------------------------
router.post('/verifier', async (req, res) => {
  const uid = req.session.utilisateurId;
  const tz = fuseauUtilisateur(uid);
  const { debut: debutD, fin: finD } = resoudreCreneau(req.body, tz);

  if (!debutD || !finD) {
    return res.status(400).json({ erreur: 'Dates de début/fin invalides.' });
  }
  if (finD <= debutD) {
    return res.status(400).json({ erreur: "L'heure de fin doit être après l'heure de début." });
  }
  if (!estConnecte(uid)) {
    return res.status(409).json({ erreur: 'GOOGLE_NON_CONNECTE', message: 'Connectez votre Google Calendar.' });
  }
  const heure_debut = debutD.toISOString();
  const heure_fin = finD.toISOString();

  // 1 & 2. Plage protégée = [debut - 30min, fin + 30min]
  const { plageProtegeeDebut, plageProtegeeFin } = plageProtegee(heure_debut, heure_fin);

  try {
    // 3. events.list sur la plage protégée
    const evenementsPlage = await listerEvenements(
      uid,
      plageProtegeeDebut.toISOString(),
      plageProtegeeFin.toISOString()
    );

    const conflits = evenementsEnConflit(evenementsPlage, plageProtegeeDebut, plageProtegeeFin);

    if (conflits.length === 0) {
      // 4. Créneau libre
      return res.json({
        libre: true,
        tampon_minutes: TAMPON_MINUTES,
        plage_protegee: {
          debut: plageProtegeeDebut.toISOString(),
          fin: plageProtegeeFin.toISOString(),
        },
        message: 'Créneau libre',
      });
    }

    // 5. Conflit — on propose des créneaux libres alternatifs.
    // On récupère une fenêtre large pour calculer les alternatives.
    const horizonFin = new Date(new Date(heure_debut).getTime() + 7 * 24 * 60 * 60 * 1000);
    const evenementsLarge = await listerEvenements(
      uid,
      plageProtegeeDebut.toISOString(),
      horizonFin.toISOString()
    );
    const suggestions = prochainsCreneauxLibres(heure_debut, heure_fin, evenementsLarge);

    return res.json({
      libre: false,
      tampon_minutes: TAMPON_MINUTES,
      conflits,
      suggestions,
      message: `${conflits.length} événement(s) en conflit avec la plage protégée.`,
    });
  } catch (e) {
    if (e.message === 'GOOGLE_NON_CONNECTE') {
      return res.status(409).json({ erreur: 'GOOGLE_NON_CONNECTE' });
    }
    console.error('Erreur vérification créneau:', e.message);
    return res.status(502).json({ erreur: 'Erreur lors de la consultation de Google Calendar.' });
  }
});

// ---------------------------------------------------------------------------
// CRÉATION DU RENDEZ-VOUS
// POST /api/rendezvous  { contact_id, heure_debut, heure_fin, notes, forcer }
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const uid = req.session.utilisateurId;
  const tz = fuseauUtilisateur(uid);
  const { contact_id, notes, forcer } = req.body || {};
  const { debut: debutD, fin: finD } = resoudreCreneau(req.body, tz);

  if (!contact_id) return res.status(400).json({ erreur: 'Un contact est requis.' });
  if (!debutD || !finD) {
    return res.status(400).json({ erreur: 'Dates de début/fin invalides.' });
  }
  if (finD <= debutD) {
    return res.status(400).json({ erreur: "L'heure de fin doit être après l'heure de début." });
  }
  const heure_debut = debutD.toISOString();
  const heure_fin = finD.toISOString();
  if (!estConnecte(uid)) {
    return res.status(409).json({ erreur: 'GOOGLE_NON_CONNECTE', message: 'Connectez votre Google Calendar.' });
  }

  const contact = db
    .prepare('SELECT * FROM contacts WHERE id = ? AND utilisateur_id = ?')
    .get(contact_id, uid);
  if (!contact) return res.status(404).json({ erreur: 'Contact introuvable.' });

  const activite = contact.activite_id
    ? db.prepare('SELECT * FROM activites WHERE id = ? AND utilisateur_id = ?').get(contact.activite_id, uid)
    : null;

  const { plageProtegeeDebut, plageProtegeeFin } = plageProtegee(heure_debut, heure_fin);

  try {
    // Re-vérification serveur (sécurité) sauf si `forcer` explicitement demandé.
    if (!forcer) {
      const evs = await listerEvenements(
        uid,
        plageProtegeeDebut.toISOString(),
        plageProtegeeFin.toISOString()
      );
      const conflits = evenementsEnConflit(evs, plageProtegeeDebut, plageProtegeeFin);
      if (conflits.length > 0) {
        return res.status(409).json({ erreur: 'CONFLIT', conflits });
      }
    }

    // Titre : "[Prénom Nom] — [Activité]"
    const nomComplet = [contact.prenom, contact.nom].filter(Boolean).join(' ').trim();
    const titre = activite ? `${nomComplet} — ${activite.nom}` : nomComplet;

    const evenement = {
      summary: titre,
      description: notes || '',
      start: { dateTime: new Date(heure_debut).toISOString(), timeZone: tz },
      end: { dateTime: new Date(heure_fin).toISOString(), timeZone: tz },
    };

    const cree = await insererEvenement(uid, evenement);

    const dateJour = new Date(heure_debut).toISOString().slice(0, 10);
    const info = db
      .prepare(
        `INSERT INTO rendezvous
         (contact_id, activite_id, date, heure_debut, heure_fin, statut, google_event_id, notes, utilisateur_id)
         VALUES (?, ?, ?, ?, ?, 'Planifié', ?, ?, ?)`
      )
      .run(
        contact.id,
        contact.activite_id || null,
        dateJour,
        new Date(heure_debut).toISOString(),
        new Date(heure_fin).toISOString(),
        cree.id,
        notes || null,
        uid
      );

    res.status(201).json(rdvComplet(info.lastInsertRowid, uid));
  } catch (e) {
    if (e.message === 'GOOGLE_NON_CONNECTE') {
      return res.status(409).json({ erreur: 'GOOGLE_NON_CONNECTE' });
    }
    console.error('Erreur création RDV:', e.message);
    return res.status(502).json({ erreur: 'Erreur lors de la création de l’événement Google Calendar.' });
  }
});

// Helper : rendez-vous enrichi (contact + activité)
function rdvComplet(id, uid) {
  return db
    .prepare(
      `SELECT r.*,
              c.nom AS contact_nom, c.prenom AS contact_prenom,
              a.nom AS activite_nom, a.couleur AS activite_couleur
       FROM rendezvous r
       LEFT JOIN contacts c ON c.id = r.contact_id
       LEFT JOIN activites a ON a.id = r.activite_id
       WHERE r.id = ? AND r.utilisateur_id = ?`
    )
    .get(id, uid);
}

// ---------------------------------------------------------------------------
// LISTE DES RENDEZ-VOUS (vue agenda) — ?activite_id=&from=&to=
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const uid = req.session.utilisateurId;
  const { activite_id, from, to } = req.query;

  let sql = `
    SELECT r.*,
           c.nom AS contact_nom, c.prenom AS contact_prenom,
           a.nom AS activite_nom, a.couleur AS activite_couleur
    FROM rendezvous r
    LEFT JOIN contacts c ON c.id = r.contact_id
    LEFT JOIN activites a ON a.id = r.activite_id
    WHERE r.utilisateur_id = ?`;
  const params = [uid];

  if (activite_id) {
    sql += ' AND r.activite_id = ?';
    params.push(activite_id);
  }
  if (from) {
    sql += ' AND r.heure_fin >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND r.heure_debut <= ?';
    params.push(to);
  }
  sql += ' ORDER BY r.heure_debut';
  res.json(db.prepare(sql).all(...params));
});

// Modifier le statut
router.put('/:id/statut', (req, res) => {
  const uid = req.session.utilisateurId;
  const { statut } = req.body || {};
  const valides = ['Planifié', 'Confirmé', 'Complété', 'Annulé'];
  if (!valides.includes(statut)) return res.status(400).json({ erreur: 'Statut invalide.' });
  const r = db
    .prepare('SELECT id FROM rendezvous WHERE id = ? AND utilisateur_id = ?')
    .get(req.params.id, uid);
  if (!r) return res.status(404).json({ erreur: 'Rendez-vous introuvable.' });
  db.prepare('UPDATE rendezvous SET statut = ? WHERE id = ?').run(statut, r.id);
  res.json(rdvComplet(r.id, uid));
});

// Supprimer un rendez-vous (et l'événement Google associé)
router.delete('/:id', async (req, res) => {
  const uid = req.session.utilisateurId;
  const r = db
    .prepare('SELECT * FROM rendezvous WHERE id = ? AND utilisateur_id = ?')
    .get(req.params.id, uid);
  if (!r) return res.status(404).json({ erreur: 'Rendez-vous introuvable.' });

  if (r.google_event_id && estConnecte(uid)) {
    try {
      await supprimerEvenement(uid, r.google_event_id);
    } catch (e) {
      // L'événement a peut-être déjà été supprimé côté Google — on poursuit.
      console.warn('Suppression événement Google ignorée:', e.message);
    }
  }
  db.prepare('DELETE FROM rendezvous WHERE id = ?').run(r.id);
  res.json({ ok: true });
});

module.exports = router;
