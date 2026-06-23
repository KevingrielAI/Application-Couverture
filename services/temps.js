'use strict';

// Gestion des fuseaux horaires sans dépendance externe (Intl natif).
// Permet de convertir une heure « murale » (saisie par l'utilisateur dans SON
// fuseau) en instant UTC fiable, indépendamment du fuseau du serveur ou du
// navigateur. C'est cet instant UTC qui est stocké et envoyé à Google Calendar.

// Décalage (ms) d'un fuseau IANA à un instant donné.
function offsetMsPourZone(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(date).reduce((acc, x) => ((acc[x.type] = x.value), acc), {});
  const heure = p.hour === '24' ? '00' : p.hour; // certains environnements renvoient 24
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +heure, +p.minute, +p.second);
  return asUTC - date.getTime();
}

// Convertit une heure murale (date 'AAAA-MM-JJ' + 'HH:MM' dans `timeZone`)
// en Date (instant UTC). Renvoie null si invalide.
function murEnUTC(dateStr, hhmm, timeZone) {
  if (!dateStr || !hhmm) return null;
  if (!estFuseauValide(timeZone)) timeZone = 'UTC';
  const naive = new Date(`${dateStr}T${hhmm}:00Z`); // heure murale traitée comme UTC
  if (Number.isNaN(naive.getTime())) return null;
  const offset = offsetMsPourZone(naive, timeZone);
  return new Date(naive.getTime() - offset);
}

function estFuseauValide(timeZone) {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

// Quelques fuseaux usuels proposés dans l'interface (le champ accepte n'importe
// quel fuseau IANA valide côté serveur).
const FUSEAUX_USUELS = [
  'Europe/Paris',
  'Europe/Brussels',
  'Europe/Zurich',
  'Europe/London',
  'America/Montreal',
  'America/New_York',
  'America/Los_Angeles',
  'Africa/Casablanca',
  'Indian/Reunion',
  'UTC',
];

const FUSEAU_DEFAUT = 'Europe/Paris';

module.exports = { murEnUTC, estFuseauValide, FUSEAUX_USUELS, FUSEAU_DEFAUT };
