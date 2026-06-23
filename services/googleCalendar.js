'use strict';

const { google } = require('googleapis');
const { db } = require('../db/database');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

function creerOAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error(
      'Configuration Google manquante. Renseignez GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET et GOOGLE_REDIRECT_URI dans .env'
    );
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

// URL de consentement OAuth. On encode l'id utilisateur dans `state`.
function genererUrlAutorisation(utilisateurId) {
  const oauth2 = creerOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: 'offline',     // nécessaire pour obtenir un refresh_token
    prompt: 'consent',          // force la délivrance d'un refresh_token
    scope: SCOPES,
    state: String(utilisateurId),
  });
}

// Échange le code d'autorisation contre des tokens et les persiste.
async function echangerCodeEtSauver(code, utilisateurId) {
  const oauth2 = creerOAuthClient();
  const { tokens } = await oauth2.getToken(code);

  // On conserve les tokens existants (refresh_token n'est renvoyé qu'une fois).
  const existant = chargerTokens(utilisateurId);
  const fusion = { ...(existant || {}), ...tokens };

  db.prepare(
    'UPDATE utilisateurs SET google_token = ?, google_calendar_id = COALESCE(google_calendar_id, ?) WHERE id = ?'
  ).run(JSON.stringify(fusion), 'primary', utilisateurId);

  return fusion;
}

function chargerTokens(utilisateurId) {
  const row = db.prepare('SELECT google_token FROM utilisateurs WHERE id = ?').get(utilisateurId);
  if (!row || !row.google_token) return null;
  try {
    return JSON.parse(row.google_token);
  } catch {
    return null;
  }
}

// Construit un client Calendar authentifié pour l'utilisateur donné.
// Rafraîchit et persiste automatiquement les tokens si besoin.
function clientCalendarPour(utilisateurId) {
  const tokens = chargerTokens(utilisateurId);
  if (!tokens) return null;

  const oauth2 = creerOAuthClient();
  oauth2.setCredentials(tokens);

  // Persiste les tokens rafraîchis automatiquement.
  oauth2.on('tokens', (nouveaux) => {
    const fusion = { ...tokens, ...nouveaux };
    db.prepare('UPDATE utilisateurs SET google_token = ? WHERE id = ?')
      .run(JSON.stringify(fusion), utilisateurId);
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2 });
  const row = db.prepare('SELECT google_calendar_id FROM utilisateurs WHERE id = ?').get(utilisateurId);
  const calendarId = (row && row.google_calendar_id) || 'primary';
  return { calendar, calendarId };
}

function estConnecte(utilisateurId) {
  return chargerTokens(utilisateurId) !== null;
}

// Liste les événements d'une plage sur le calendrier de l'utilisateur.
async function listerEvenements(utilisateurId, timeMinISO, timeMaxISO) {
  const ctx = clientCalendarPour(utilisateurId);
  if (!ctx) throw new Error('GOOGLE_NON_CONNECTE');
  const { calendar, calendarId } = ctx;
  const res = await calendar.events.list({
    calendarId,
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
  });
  return res.data.items || [];
}

// Insère un événement et renvoie l'objet créé.
async function insererEvenement(utilisateurId, evenement) {
  const ctx = clientCalendarPour(utilisateurId);
  if (!ctx) throw new Error('GOOGLE_NON_CONNECTE');
  const { calendar, calendarId } = ctx;
  const res = await calendar.events.insert({ calendarId, requestBody: evenement });
  return res.data;
}

async function supprimerEvenement(utilisateurId, eventId) {
  const ctx = clientCalendarPour(utilisateurId);
  if (!ctx) throw new Error('GOOGLE_NON_CONNECTE');
  const { calendar, calendarId } = ctx;
  await calendar.events.delete({ calendarId, eventId });
}

module.exports = {
  SCOPES,
  genererUrlAutorisation,
  echangerCodeEtSauver,
  clientCalendarPour,
  estConnecte,
  listerEvenements,
  insererEvenement,
  supprimerEvenement,
};
