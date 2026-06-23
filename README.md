# Application Couverture

SaaS de **gestion intelligente de rendez-vous**. L'application se connecte au
Google Calendar de chaque utilisateur, gère une base de contacts rattachés à des
activités, et garantit un **tampon de 30 minutes avant et après chaque
rendez-vous** (temps de trajet).

Quand un rendez-vous est créé, l'app vérifie qu'aucun événement n'existe dans la
plage `(début − 30 min)` → `(fin + 30 min)`, puis crée l'événement dans Google
Calendar si le créneau est libre.

## Fonctionnalités

- **Multi-utilisateurs** : authentification email + mot de passe, chaque
  utilisateur lie **son propre** Google Calendar (OAuth 2.0). Les données sont
  totalement cloisonnées par utilisateur.
- **Contacts** : liste filtrable par activité, recherche par nom, CRUD complet.
- **Activités** : préremplies à l'inscription (Consultation digitale, Immobilier
  commercial, EffAzur nettoyage), couleur personnalisable.
- **Nouveau rendez-vous** : vérification du créneau contre Google Calendar avec
  tampon de 30 min, alerte de conflit + proposition de créneaux libres, puis
  création de l'événement.
- **Agenda** : vue jour / semaine / mois, événements colorés par activité,
  filtrable par activité.

## Stack technique

| Couche      | Choix                                          |
|-------------|------------------------------------------------|
| Serveur     | Node.js + Express                              |
| Base        | SQLite (`better-sqlite3`)                      |
| Sessions    | `express-session` + `connect-sqlite3`          |
| Auth        | `bcryptjs` (hash mot de passe)                 |
| Google      | `googleapis` (OAuth 2.0 + Calendar v3)         |
| Frontend    | HTML/CSS/JS, FullCalendar (vue agenda)         |

## Base de données (4 tables)

1. **utilisateurs** — nom, email, mot_de_passe_hash, google_token,
   google_calendar_id, date_creation.
2. **activites** — nom, couleur, utilisateur_id.
3. **contacts** — nom, prenom, email, telephone, activite_id, notes,
   utilisateur_id.
4. **rendezvous** — contact_id, activite_id, date, heure_debut, heure_fin,
   statut (`Planifié`/`Confirmé`/`Complété`/`Annulé`), google_event_id, notes,
   utilisateur_id.

## Installation

```bash
npm install
cp .env.example .env   # puis renseigner les valeurs
npm start              # http://localhost:3000
npm test               # exécute la suite de tests
```

### Déploiement (Docker)

```bash
# Variables requises : SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
export SESSION_SECRET=... GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
docker compose up --build
```

La base SQLite et les sessions sont persistées dans le volume `app-data`.

### Fuseaux horaires

Chaque utilisateur définit son **fuseau horaire** (réglages ⚙️). Les horaires
saisis sont interprétés comme heure « murale » dans ce fuseau, convertis en
instant UTC fiable côté serveur (indépendamment du fuseau du serveur ou du
navigateur), et envoyés à Google Calendar avec le `timeZone` correspondant.
L'agenda et le tableau de bord affichent également les heures dans ce fuseau.

### Configuration Google OAuth

1. Créez un projet sur [Google Cloud Console](https://console.cloud.google.com/).
2. Activez l'API **Google Calendar**.
3. Créez des identifiants **OAuth 2.0 (application Web)**.
4. Ajoutez l'URI de redirection autorisé :
   `http://localhost:3000/api/google/callback`
5. Scopes utilisés : `calendar.events.readonly` + `calendar.events`.
6. Reportez `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et
   `GOOGLE_REDIRECT_URI` dans `.env`.

## Logique métier centrale

À la vérification d'un nouveau rendez-vous (`POST /api/rendezvous/verifier`) :

1. `plage_protegee_debut = heure_debut − 30 min`
2. `plage_protegee_fin = heure_fin + 30 min`
3. Appel `events.list` avec `timeMin/timeMax` = plage protégée.
4. Aucun événement → **Créneau libre**, bouton « Créer le rendez-vous » activé.
5. Sinon → **alerte de conflit** listant les événements en cause +
   propositions de prochains créneaux libres respectant le tampon.

À la création (`POST /api/rendezvous`) : `events.insert` sur le calendrier de
l'utilisateur, titre `"[Prénom Nom] — [Activité]"`, stockage du
`google_event_id`, statut initial `Planifié`.

## Structure du projet

```
server.js              Point d'entrée Express
db/
  schema.sql           Schéma SQL
  database.js          Connexion + activités par défaut
services/
  googleCalendar.js    OAuth + appels Calendar
  creneaux.js          Tampon 30 min, conflits, créneaux libres
  temps.js             Conversion heure murale ↔ UTC (fuseaux IANA)
middleware/auth.js     Garde de session
routes/                auth, google, activites, contacts, rendezvous
public/                Frontend (index.html, css, js)
tests/                 Tests (node:test) — logique tampon + fuseaux
Dockerfile, docker-compose.yml
```

## Pages

- **Agenda** — vue calendrier jour/semaine/mois, colorée par activité.
- **Rendez-vous** — tableau de bord listant les RDV, filtres par statut,
  activité et recherche ; changement de statut et suppression.
- **Nouveau rendez-vous** — vérification du créneau + création.
- **Contacts** — CRUD, filtre par activité, recherche.
- **Activités** — CRUD, couleur.
- **Réglages** — nom + fuseau horaire.

## API (résumé)

| Méthode | Route                          | Description                       |
|---------|--------------------------------|-----------------------------------|
| POST    | `/api/auth/register`           | Inscription                       |
| POST    | `/api/auth/login`              | Connexion                         |
| GET     | `/api/auth/me`                 | Utilisateur courant + état Google |
| GET     | `/api/google/connect`          | URL de consentement OAuth         |
| GET     | `/api/google/callback`         | Callback OAuth                    |
| GET/POST/PUT/DELETE | `/api/activites`  | CRUD activités                    |
| GET/POST/PUT/DELETE | `/api/contacts`   | CRUD contacts (filtres `q`, `activite_id`) |
| POST    | `/api/rendezvous/verifier`     | Vérification du créneau           |
| POST    | `/api/rendezvous`              | Création (Google + base)          |
| GET     | `/api/rendezvous`              | Liste (agenda)                    |
| PUT     | `/api/rendezvous/:id/statut`   | Changement de statut              |
| DELETE  | `/api/rendezvous/:id`          | Suppression (Google + base)       |
