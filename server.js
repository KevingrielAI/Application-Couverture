'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

require('./db/database'); // initialise la base au démarrage

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'data') }),
    secret: process.env.SESSION_SECRET || 'secret-dev-a-changer',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 jours
      sameSite: 'lax',
    },
  })
);

// Routes API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/google', require('./routes/google'));
app.use('/api/activites', require('./routes/activites'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/rendezvous', require('./routes/rendezvous'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Frontend statique
app.use(express.static(path.join(__dirname, 'public')));

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Application Couverture démarrée sur http://localhost:${PORT}`);
});
