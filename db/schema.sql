-- Schéma de la base de données — Application Couverture
-- Toutes les données métier sont cloisonnées par utilisateur (utilisateur_id).

PRAGMA foreign_keys = ON;

-- 1. Utilisateurs
CREATE TABLE IF NOT EXISTS utilisateurs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  nom                 TEXT    NOT NULL,
  email               TEXT    NOT NULL UNIQUE,
  mot_de_passe_hash   TEXT    NOT NULL,
  google_token        TEXT,              -- JSON des tokens OAuth (access + refresh)
  google_calendar_id  TEXT,              -- calendrier ciblé (par défaut "primary")
  date_creation       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 2. Activités
CREATE TABLE IF NOT EXISTS activites (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nom             TEXT    NOT NULL,
  couleur         TEXT    NOT NULL DEFAULT '#3b82f6',
  utilisateur_id  INTEGER NOT NULL,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
);

-- 3. Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nom             TEXT    NOT NULL,
  prenom          TEXT,
  email           TEXT,
  telephone       TEXT,
  activite_id     INTEGER,
  notes           TEXT,
  utilisateur_id  INTEGER NOT NULL,
  FOREIGN KEY (activite_id)    REFERENCES activites(id)    ON DELETE SET NULL,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
);

-- 4. Rendez-vous
CREATE TABLE IF NOT EXISTS rendezvous (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id      INTEGER,
  activite_id     INTEGER,
  date            TEXT    NOT NULL,      -- AAAA-MM-JJ
  heure_debut     TEXT    NOT NULL,      -- ISO 8601 complet (avec fuseau)
  heure_fin       TEXT    NOT NULL,      -- ISO 8601 complet (avec fuseau)
  statut          TEXT    NOT NULL DEFAULT 'Planifié'
                          CHECK (statut IN ('Planifié','Confirmé','Complété','Annulé')),
  google_event_id TEXT,
  notes           TEXT,
  utilisateur_id  INTEGER NOT NULL,
  FOREIGN KEY (contact_id)     REFERENCES contacts(id)     ON DELETE SET NULL,
  FOREIGN KEY (activite_id)    REFERENCES activites(id)    ON DELETE SET NULL,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_activites_user  ON activites(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_contacts_user   ON contacts(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_rdv_user        ON rendezvous(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_rdv_date        ON rendezvous(utilisateur_id, date);
