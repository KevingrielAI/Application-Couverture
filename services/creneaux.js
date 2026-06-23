'use strict';

// Logique métier centrale : tampon de trajet de 30 minutes avant ET après
// chaque rendez-vous, détection des conflits et proposition de créneaux libres.

const TAMPON_MINUTES = 30;
const TAMPON_MS = TAMPON_MINUTES * 60 * 1000;

// Borne de début/fin d'un événement Google (gère les événements "journée entière").
function bornesEvenement(ev) {
  const debut = ev.start && (ev.start.dateTime || ev.start.date);
  const fin = ev.end && (ev.end.dateTime || ev.end.date);
  return { debut: debut ? new Date(debut) : null, fin: fin ? new Date(fin) : null };
}

// Calcule la plage protégée [debut - 30min, fin + 30min].
function plageProtegee(debutISO, finISO) {
  const debut = new Date(debutISO);
  const fin = new Date(finISO);
  return {
    plageProtegeeDebut: new Date(debut.getTime() - TAMPON_MS),
    plageProtegeeFin: new Date(fin.getTime() + TAMPON_MS),
  };
}

// Deux intervalles [aDebut,aFin] et [bDebut,bFin] se chevauchent-ils ?
function chevauche(aDebut, aFin, bDebut, bFin) {
  return aDebut < bFin && bDebut < aFin;
}

// Filtre les événements en conflit avec la plage protégée.
// On ignore l'événement `ignorerEventId` (utile lors d'une modification).
function evenementsEnConflit(evenements, plageDebut, plageFin, ignorerEventId) {
  const conflits = [];
  for (const ev of evenements) {
    if (ignorerEventId && ev.id === ignorerEventId) continue;
    if (ev.status === 'cancelled') continue;
    // Les invitations refusées ne bloquent pas le créneau.
    const refuse = (ev.attendees || []).some(
      (a) => a.self && a.responseStatus === 'declined'
    );
    if (refuse) continue;

    const { debut, fin } = bornesEvenement(ev);
    if (!debut || !fin) continue;
    if (chevauche(plageDebut, plageFin, debut, fin)) {
      conflits.push({
        id: ev.id,
        titre: ev.summary || '(sans titre)',
        debut: debut.toISOString(),
        fin: fin.toISOString(),
      });
    }
  }
  return conflits;
}

// Propose les prochains créneaux libres de même durée que le RDV souhaité,
// respectant le tampon, à partir de l'heure de début demandée.
// `evenements` doit couvrir une fenêtre suffisamment large (cf. appelant).
function prochainsCreneauxLibres(debutISO, finISO, evenements, options = {}) {
  const { maxResultats = 3, pasMinutes = 15, horizonJours = 7, heureMin = 8, heureMax = 20 } = options;

  const debutSouhaite = new Date(debutISO);
  const finSouhaite = new Date(finISO);
  const dureeMs = finSouhaite.getTime() - debutSouhaite.getTime();
  if (dureeMs <= 0) return [];

  const pasMs = pasMinutes * 60 * 1000;
  const horizon = new Date(debutSouhaite.getTime() + horizonJours * 24 * 60 * 60 * 1000);

  // Pré-calcule les bornes des événements valides.
  const occupes = evenements
    .filter((ev) => ev.status !== 'cancelled')
    .map(bornesEvenement)
    .filter((b) => b.debut && b.fin);

  const resultats = [];
  let curseur = new Date(debutSouhaite.getTime());

  while (curseur <= horizon && resultats.length < maxResultats) {
    const fin = new Date(curseur.getTime() + dureeMs);

    // Respecte une plage horaire de travail (heure locale).
    const h = curseur.getHours();
    const hFin = fin.getHours() + (fin.getMinutes() > 0 ? 1 : 0);
    if (h < heureMin || hFin > heureMax) {
      curseur = new Date(curseur.getTime() + pasMs);
      continue;
    }

    const protDebut = new Date(curseur.getTime() - TAMPON_MS);
    const protFin = new Date(fin.getTime() + TAMPON_MS);

    const libre = !occupes.some((o) => chevauche(protDebut, protFin, o.debut, o.fin));
    if (libre) {
      resultats.push({ debut: curseur.toISOString(), fin: fin.toISOString() });
    }
    curseur = new Date(curseur.getTime() + pasMs);
  }

  return resultats;
}

module.exports = {
  TAMPON_MINUTES,
  plageProtegee,
  evenementsEnConflit,
  prochainsCreneauxLibres,
};
