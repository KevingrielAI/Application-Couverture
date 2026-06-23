'use strict';

// ===================== ÉTAT GLOBAL =====================
let utilisateur = null;
let activites = [];
let calendrier = null;
let verifValide = null; // créneau vérifié { heure_debut, heure_fin } ou null

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function echapper(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function fuseau() {
  return (utilisateur && utilisateur.fuseau_horaire) || 'Europe/Paris';
}

// Formate un instant ISO dans le fuseau de l'utilisateur.
function fmtHeure(iso) {
  return new Date(iso).toLocaleString('fr-FR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: fuseau(),
  });
}

// Décompose un instant ISO en { date:'AAAA-MM-JJ', heure:'HH:MM' } dans le fuseau utilisateur.
function partsDansFuseau(iso) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau(), hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso)).reduce((a, x) => ((a[x.type] = x.value), a), {});
  const heure = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, heure: `${heure}:${p.minute}` };
}

function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast visible ' + type;
  setTimeout(() => (t.className = 'toast'), 3000);
}

// ===================== AUTHENTIFICATION (UI) =====================
let modeAuth = 'login';

$$('.onglet-auth').forEach((o) =>
  o.addEventListener('click', () => {
    modeAuth = o.dataset.mode;
    $$('.onglet-auth').forEach((x) => x.classList.toggle('actif', x === o));
    $('#champ-nom').style.display = modeAuth === 'register' ? 'block' : 'none';
    $('#champ-nom input').required = modeAuth === 'register';
    $('#btn-submit-auth').textContent = modeAuth === 'register' ? "S'inscrire" : 'Se connecter';
    $('#erreur-auth').textContent = '';
  })
);

$('#form-auth').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#erreur-auth').textContent = '';
  const f = e.target;
  const corps = {
    email: f.email.value.trim(),
    mot_de_passe: f.mot_de_passe.value,
  };
  if (modeAuth === 'register') corps.nom = f.nom.value.trim();
  try {
    const url = modeAuth === 'register' ? '/api/auth/register' : '/api/auth/login';
    await API.post(url, corps);
    await demarrerApp();
  } catch (err) {
    $('#erreur-auth').textContent = err.message;
  }
});

$('#btn-logout').addEventListener('click', async () => {
  await API.post('/api/auth/logout');
  location.reload();
});

// ===================== RÉGLAGES (profil + fuseau) =====================
$('#btn-reglages').addEventListener('click', () => {
  const usuels = (utilisateur.fuseaux_usuels || ['Europe/Paris', 'UTC']);
  const actuel = fuseau();
  const liste = usuels.includes(actuel) ? usuels : [actuel, ...usuels];
  const opts = liste.map((tz) => `<option value="${tz}" ${tz === actuel ? 'selected' : ''}>${tz}</option>`).join('');
  ouvrirModale('Réglages', `
    <form id="form-reglages">
      <div class="champ"><label>Nom</label><input name="nom" value="${echapper(utilisateur.nom)}" /></div>
      <div class="champ">
        <label>Fuseau horaire</label>
        <select name="fuseau_horaire">${opts}</select>
        <small style="color:#64748b">Utilisé pour interpréter vos horaires et les envoyer à Google Calendar.</small>
      </div>
      <div class="modale-actions">
        <button type="button" class="btn btn-secondaire" onclick="fermerModale()">Annuler</button>
        <button type="submit" class="btn btn-principal">Enregistrer</button>
      </div>
    </form>`);
  $('#form-reglages').addEventListener('submit', async (e) => {
    e.preventDefault();
    await API.put('/api/auth/profil', {
      nom: e.target.nom.value.trim(),
      fuseau_horaire: e.target.fuseau_horaire.value,
    });
    fermerModale();
    await rafraichirUtilisateur();
    if (calendrier) calendrier.setOption('timeZone', fuseau());
    toast('Réglages enregistrés.', 'succes');
  });
});

// ===================== NAVIGATION =====================
$$('.lien-nav').forEach((l) =>
  l.addEventListener('click', () => allerPage(l.dataset.page))
);

function allerPage(page) {
  $$('.lien-nav').forEach((l) => l.classList.toggle('actif', l.dataset.page === page));
  $$('.page').forEach((p) => (p.style.display = 'none'));
  $('#page-' + page).style.display = 'block';
  if (page === 'agenda') chargerAgenda();
  if (page === 'rdv') chargerTableauRdv();
  if (page === 'contacts') chargerContacts();
  if (page === 'activites') chargerActivites();
  if (page === 'nouveau') preparerNouveauRdv();
}

// ===================== GOOGLE CALENDAR =====================
$('#btn-connecter-google').addEventListener('click', async () => {
  try {
    const { url } = await API.get('/api/google/connect');
    window.location.href = url;
  } catch (err) {
    toast(err.message, 'erreur');
  }
});

$('#btn-deconnecter-google').addEventListener('click', async () => {
  await API.post('/api/google/disconnect');
  await rafraichirUtilisateur();
  toast('Google Calendar délié.');
});

function majBadgeGoogle() {
  const connecte = utilisateur && utilisateur.google_connecte;
  $('#badge-google').textContent = connecte ? 'Google connecté' : 'Google non connecté';
  $('#badge-google').className = 'badge ' + (connecte ? 'badge-ok' : 'badge-attention');
  $('#btn-connecter-google').style.display = connecte ? 'none' : 'inline-block';
  $('#btn-deconnecter-google').style.display = connecte ? 'inline-block' : 'none';
}

async function rafraichirUtilisateur() {
  utilisateur = await API.get('/api/auth/me');
  $('#nom-utilisateur').textContent = utilisateur.nom;
  majBadgeGoogle();
}

// ===================== ACTIVITÉS =====================
async function chargerListeActivites() {
  activites = await API.get('/api/activites');
  // remplit les sélecteurs de filtre
  remplirSelectActivites($('#filtre-agenda-activite'), 'Toutes');
  remplirSelectActivites($('#filtre-contact-activite'), 'Toutes les activités');
}

function remplirSelectActivites(select, labelVide) {
  if (!select) return;
  const valeur = select.value;
  select.innerHTML = `<option value="">${labelVide}</option>` +
    activites.map((a) => `<option value="${a.id}">${echapper(a.nom)}</option>`).join('');
  select.value = valeur;
}

async function chargerActivites() {
  await chargerListeActivites();
  const conteneur = $('#liste-activites');
  conteneur.innerHTML = activites.map((a) => `
    <div class="carte-activite">
      <div class="infos">
        <span class="bande" style="background:${echapper(a.couleur)}"></span>
        <strong>${echapper(a.nom)}</strong>
      </div>
      <div>
        <button class="btn btn-secondaire btn-mini" onclick="editerActivite(${a.id})">Modifier</button>
        <button class="btn btn-danger btn-mini" onclick="supprimerActivite(${a.id})">Suppr.</button>
      </div>
    </div>`).join('') || '<p>Aucune activité.</p>';
}

$('#btn-nouvelle-activite').addEventListener('click', () => editerActivite(null));

window.editerActivite = function (id) {
  const a = activites.find((x) => x.id === id) || { nom: '', couleur: '#3b82f6' };
  ouvrirModale(id ? 'Modifier l’activité' : 'Nouvelle activité', `
    <form id="form-activite">
      <div class="champ"><label>Nom</label><input name="nom" value="${echapper(a.nom)}" required /></div>
      <div class="champ"><label>Couleur</label><input type="color" name="couleur" value="${a.couleur}" /></div>
      <div class="modale-actions">
        <button type="button" class="btn btn-secondaire" onclick="fermerModale()">Annuler</button>
        <button type="submit" class="btn btn-principal">Enregistrer</button>
      </div>
    </form>`);
  $('#form-activite').addEventListener('submit', async (e) => {
    e.preventDefault();
    const corps = { nom: e.target.nom.value.trim(), couleur: e.target.couleur.value };
    if (id) await API.put('/api/activites/' + id, corps);
    else await API.post('/api/activites', corps);
    fermerModale();
    await chargerActivites();
    toast('Activité enregistrée.', 'succes');
  });
};

window.supprimerActivite = async function (id) {
  if (!confirm('Supprimer cette activité ? Les contacts/rendez-vous liés seront détachés.')) return;
  await API.del('/api/activites/' + id);
  await chargerActivites();
  toast('Activité supprimée.');
};

// ===================== CONTACTS =====================
let rechercheTimer = null;
$('#recherche-contact').addEventListener('input', () => {
  clearTimeout(rechercheTimer);
  rechercheTimer = setTimeout(chargerContacts, 250);
});
$('#filtre-contact-activite').addEventListener('change', chargerContacts);
$('#btn-nouveau-contact').addEventListener('click', () => editerContact(null));

async function chargerContacts() {
  await chargerListeActivites();
  const q = $('#recherche-contact').value.trim();
  const act = $('#filtre-contact-activite').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (act) params.set('activite_id', act);
  const contacts = await API.get('/api/contacts?' + params.toString());

  $('#liste-contacts').innerHTML = contacts.map((c) => `
    <tr>
      <td><strong>${echapper(c.prenom || '')} ${echapper(c.nom)}</strong></td>
      <td>${echapper(c.email || '—')}</td>
      <td>${echapper(c.telephone || '—')}</td>
      <td>${c.activite_nom ? `<span class="pastille" style="background:${echapper(c.activite_couleur)}"></span>${echapper(c.activite_nom)}` : '—'}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-secondaire btn-mini" onclick="editerContact(${c.id})">Modifier</button>
        <button class="btn btn-danger btn-mini" onclick="supprimerContact(${c.id})">Suppr.</button>
      </td>
    </tr>`).join('') ||
    '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px">Aucun contact.</td></tr>';
}

window.editerContact = async function (id) {
  await chargerListeActivites();
  let c = { nom: '', prenom: '', email: '', telephone: '', activite_id: '', notes: '' };
  if (id) c = await API.get('/api/contacts/' + id);
  const opts = `<option value="">Aucune</option>` +
    activites.map((a) => `<option value="${a.id}" ${a.id === c.activite_id ? 'selected' : ''}>${echapper(a.nom)}</option>`).join('');
  ouvrirModale(id ? 'Modifier le contact' : 'Nouveau contact', `
    <form id="form-contact">
      <div class="ligne-2">
        <div class="champ"><label>Prénom</label><input name="prenom" value="${echapper(c.prenom || '')}" /></div>
        <div class="champ"><label>Nom *</label><input name="nom" value="${echapper(c.nom || '')}" required /></div>
      </div>
      <div class="champ"><label>Email</label><input type="email" name="email" value="${echapper(c.email || '')}" /></div>
      <div class="champ"><label>Téléphone</label><input name="telephone" value="${echapper(c.telephone || '')}" /></div>
      <div class="champ"><label>Activité</label><select name="activite_id">${opts}</select></div>
      <div class="champ"><label>Notes</label><textarea name="notes" rows="3">${echapper(c.notes || '')}</textarea></div>
      <div class="modale-actions">
        <button type="button" class="btn btn-secondaire" onclick="fermerModale()">Annuler</button>
        <button type="submit" class="btn btn-principal">Enregistrer</button>
      </div>
    </form>`);
  $('#form-contact').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const corps = {
      nom: f.nom.value.trim(), prenom: f.prenom.value.trim(),
      email: f.email.value.trim(), telephone: f.telephone.value.trim(),
      activite_id: f.activite_id.value ? Number(f.activite_id.value) : null,
      notes: f.notes.value.trim(),
    };
    if (id) await API.put('/api/contacts/' + id, corps);
    else await API.post('/api/contacts', corps);
    fermerModale();
    await chargerContacts();
    toast('Contact enregistré.', 'succes');
  });
};

window.supprimerContact = async function (id) {
  if (!confirm('Supprimer ce contact ?')) return;
  await API.del('/api/contacts/' + id);
  await chargerContacts();
  toast('Contact supprimé.');
};

// ===================== NOUVEAU RENDEZ-VOUS =====================
async function preparerNouveauRdv() {
  const contacts = await API.get('/api/contacts');
  $('#rdv-contact').innerHTML = '<option value="">Sélectionner…</option>' +
    contacts.map((c) => `<option value="${c.id}">${echapper((c.prenom || '') + ' ' + c.nom)}${c.activite_nom ? ' — ' + echapper(c.activite_nom) : ''}</option>`).join('');
  reinitVerification();
}

function reinitVerification() {
  verifValide = null;
  $('#btn-creer-rdv').disabled = true;
  $('#zone-resultat').className = 'zone-resultat vide';
  $('#zone-resultat').textContent = 'Renseignez le créneau puis cliquez sur « Vérifier la disponibilité ».';
}

['#rdv-contact', '#rdv-date', '#rdv-debut', '#rdv-fin', '#rdv-notes'].forEach((sel) =>
  $(sel).addEventListener('change', reinitVerification)
);

// Lit le créneau saisi sous forme d'heure murale (interprétée côté serveur
// dans le fuseau de l'utilisateur).
function lireCreneau() {
  return {
    date: $('#rdv-date').value,
    heure_debut: $('#rdv-debut').value,
    heure_fin: $('#rdv-fin').value,
  };
}

$('#btn-verifier').addEventListener('click', async () => {
  if (!utilisateur.google_connecte) {
    return toast('Connectez d’abord votre Google Calendar.', 'erreur');
  }
  const creneau = lireCreneau();
  if (!creneau.date || !creneau.heure_debut || !creneau.heure_fin) {
    return toast('Renseignez date, début et fin.', 'erreur');
  }
  if (creneau.heure_fin <= creneau.heure_debut) {
    return toast('La fin doit être après le début.', 'erreur');
  }

  const zone = $('#zone-resultat');
  zone.className = 'zone-resultat vide';
  zone.textContent = 'Vérification en cours…';
  $('#btn-creer-rdv').disabled = true;

  try {
    const r = await API.post('/api/rendezvous/verifier', creneau);
    if (r.libre) {
      verifValide = creneau;
      zone.className = 'zone-resultat libre';
      zone.innerHTML = `<strong>✅ Créneau libre</strong><p>Plage protégée respectée (tampon de ${r.tampon_minutes} min avant/après). Vous pouvez créer le rendez-vous.</p>`;
      $('#btn-creer-rdv').disabled = false;
    } else {
      verifValide = null;
      const conflitsHtml = r.conflits.map((c) =>
        `<li><strong>${echapper(c.titre)}</strong><br>${fmtHeure(c.debut)} → ${fmtHeure(c.fin)}</li>`).join('');
      const sugg = (r.suggestions || []).map((s) =>
        `<span class="suggestion-chip" onclick="appliquerSuggestion('${s.debut}','${s.fin}')">${fmtHeure(s.debut)}</span>`).join('');
      zone.className = 'zone-resultat conflit';
      zone.innerHTML = `
        <strong>⛔ Conflit détecté</strong>
        <p>${echapper(r.message)} Le créneau empiète sur la plage protégée (30 min avant/après) :</p>
        <ul class="liste-conflits">${conflitsHtml}</ul>
        <div class="suggestions">
          <p><strong>Prochains créneaux libres :</strong></p>
          ${sugg || '<em>Aucune suggestion sous 7 jours. Choisissez un autre créneau.</em>'}
        </div>`;
    }
  } catch (err) {
    zone.className = 'zone-resultat conflit';
    if (err.data && err.data.erreur === 'GOOGLE_NON_CONNECTE') {
      zone.innerHTML = '<strong>Google non connecté</strong><p>Connectez votre Google Calendar pour vérifier la disponibilité.</p>';
    } else {
      zone.textContent = err.message;
    }
  }
});

window.appliquerSuggestion = function (debutISO, finISO) {
  const d = partsDansFuseau(debutISO);
  const f = partsDansFuseau(finISO);
  $('#rdv-date').value = d.date;
  $('#rdv-debut').value = d.heure;
  $('#rdv-fin').value = f.heure;
  reinitVerification();
  $('#btn-verifier').click();
};

$('#btn-creer-rdv').addEventListener('click', async () => {
  if (!verifValide) return;
  const contactId = $('#rdv-contact').value;
  if (!contactId) return toast('Sélectionnez un contact.', 'erreur');
  const btn = $('#btn-creer-rdv');
  btn.disabled = true;
  try {
    await API.post('/api/rendezvous', {
      contact_id: Number(contactId),
      date: verifValide.date,
      heure_debut: verifValide.heure_debut,
      heure_fin: verifValide.heure_fin,
      notes: $('#rdv-notes').value.trim(),
    });
    toast('Rendez-vous créé et ajouté à Google Calendar.', 'succes');
    $('#form-rdv').reset();
    reinitVerification();
    allerPage('agenda');
  } catch (err) {
    btn.disabled = false;
    if (err.data && err.data.erreur === 'CONFLIT') {
      toast('Un conflit est apparu entre-temps. Revérifiez le créneau.', 'erreur');
      reinitVerification();
    } else {
      toast(err.message, 'erreur');
    }
  }
});

// ===================== TABLEAU DE BORD RENDEZ-VOUS =====================
let rdvTimer = null;
['#filtre-rdv-statut', '#filtre-rdv-activite'].forEach((s) =>
  $(s).addEventListener('change', chargerTableauRdv)
);
$('#recherche-rdv').addEventListener('input', () => {
  clearTimeout(rdvTimer);
  rdvTimer = setTimeout(chargerTableauRdv, 250);
});

const COULEURS_STATUT = {
  'Planifié': '#3b82f6', 'Confirmé': '#16a34a', 'Complété': '#64748b', 'Annulé': '#dc2626',
};

async function chargerTableauRdv() {
  await chargerListeActivites();
  remplirSelectActivites($('#filtre-rdv-activite'), 'Toutes les activités');
  const params = new URLSearchParams();
  const act = $('#filtre-rdv-activite').value;
  if (act) params.set('activite_id', act);
  let rdvs = await API.get('/api/rendezvous?' + params.toString());

  const statut = $('#filtre-rdv-statut').value;
  if (statut) rdvs = rdvs.filter((r) => r.statut === statut);
  const q = $('#recherche-rdv').value.trim().toLowerCase();
  if (q) {
    rdvs = rdvs.filter((r) =>
      `${r.contact_prenom || ''} ${r.contact_nom || ''} ${r.activite_nom || ''}`.toLowerCase().includes(q)
    );
  }
  // Plus récents d'abord.
  rdvs.sort((a, b) => new Date(b.heure_debut) - new Date(a.heure_debut));

  $('#liste-rdv').innerHTML = rdvs.map((r) => {
    const d = partsDansFuseau(r.heure_debut);
    const fdeb = new Date(r.heure_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: fuseau() });
    const ffin = new Date(r.heure_fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: fuseau() });
    const nom = `${r.contact_prenom || ''} ${r.contact_nom || ''}`.trim() || '(contact supprimé)';
    return `<tr>
      <td>${d.date}</td>
      <td>${fdeb} – ${ffin}</td>
      <td>${echapper(nom)}</td>
      <td>${r.activite_nom ? `<span class="pastille" style="background:${echapper(r.activite_couleur)}"></span>${echapper(r.activite_nom)}` : '—'}</td>
      <td><span class="badge" style="background:${COULEURS_STATUT[r.statut]}22;color:${COULEURS_STATUT[r.statut]}">${r.statut}</span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-secondaire btn-mini" onclick="changerStatutRapide(${r.id},'${r.statut}')">Statut</button>
        <button class="btn btn-danger btn-mini" onclick="supprimerRdv(${r.id})">Suppr.</button>
      </td>
    </tr>`;
  }).join('') ||
    '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px">Aucun rendez-vous.</td></tr>';
}

window.changerStatutRapide = function (id, statutActuel) {
  const opts = ['Planifié', 'Confirmé', 'Complété', 'Annulé']
    .map((s) => `<option value="${s}" ${s === statutActuel ? 'selected' : ''}>${s}</option>`).join('');
  ouvrirModale('Changer le statut', `
    <div class="champ"><label>Statut</label><select id="select-statut-rapide">${opts}</select></div>
    <div class="modale-actions">
      <button class="btn btn-secondaire" onclick="fermerModale()">Annuler</button>
      <button class="btn btn-principal" id="btn-valider-statut">Enregistrer</button>
    </div>`);
  $('#btn-valider-statut').addEventListener('click', async () => {
    await API.put(`/api/rendezvous/${id}/statut`, { statut: $('#select-statut-rapide').value });
    fermerModale();
    chargerTableauRdv();
    toast('Statut mis à jour.', 'succes');
  });
};

// ===================== AGENDA =====================
$('#filtre-agenda-activite').addEventListener('change', () => calendrier && calendrier.refetchEvents());

async function chargerAgenda() {
  await chargerListeActivites();
  if (!calendrier) {
    calendrier = new FullCalendar.Calendar($('#calendrier'), {
      initialView: 'timeGridWeek',
      locale: 'fr',
      timeZone: fuseau(),
      firstDay: 1,
      nowIndicator: true,
      slotMinTime: '07:00:00',
      slotMaxTime: '21:00:00',
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' },
      buttonText: { today: "Aujourd'hui", month: 'Mois', week: 'Semaine', day: 'Jour' },
      height: 'auto',
      events: async (info, success, failure) => {
        try {
          const params = new URLSearchParams({ from: info.startStr, to: info.endStr });
          const act = $('#filtre-agenda-activite').value;
          if (act) params.set('activite_id', act);
          const rdvs = await API.get('/api/rendezvous?' + params.toString());
          success(rdvs.map((r) => ({
            id: String(r.id),
            title: `${(r.contact_prenom || '')} ${(r.contact_nom || '')}`.trim() + (r.activite_nom ? ` — ${r.activite_nom}` : ''),
            start: r.heure_debut,
            end: r.heure_fin,
            backgroundColor: r.activite_couleur || '#2563eb',
            borderColor: r.activite_couleur || '#2563eb',
            extendedProps: { statut: r.statut, notes: r.notes },
          })));
        } catch (e) { failure(e); }
      },
      eventClick: (arg) => ouvrirDetailRdv(arg.event),
    });
    calendrier.render();
  } else {
    calendrier.refetchEvents();
    calendrier.updateSize();
  }
}

function ouvrirDetailRdv(ev) {
  const p = ev.extendedProps;
  const statutOpts = ['Planifié', 'Confirmé', 'Complété', 'Annulé']
    .map((s) => `<option value="${s}" ${s === p.statut ? 'selected' : ''}>${s}</option>`).join('');
  ouvrirModale('Rendez-vous', `
    <p><strong>${echapper(ev.title)}</strong></p>
    <p>${fmtHeure(ev.start.toISOString())} → ${fmtHeure(ev.end.toISOString())}</p>
    ${p.notes ? `<p style="color:#475569">${echapper(p.notes)}</p>` : ''}
    <div class="champ" style="margin-top:14px"><label>Statut</label><select id="detail-statut">${statutOpts}</select></div>
    <div class="modale-actions">
      <button class="btn btn-danger" onclick="supprimerRdv(${ev.id})">Supprimer</button>
      <button class="btn btn-principal" onclick="majStatutRdv(${ev.id})">Enregistrer le statut</button>
    </div>`);
}

window.majStatutRdv = async function (id) {
  await API.put(`/api/rendezvous/${id}/statut`, { statut: $('#detail-statut').value });
  fermerModale();
  calendrier.refetchEvents();
  toast('Statut mis à jour.', 'succes');
};

window.supprimerRdv = async function (id) {
  if (!confirm('Supprimer ce rendez-vous ? Il sera aussi retiré de Google Calendar.')) return;
  await API.del('/api/rendezvous/' + id);
  fermerModale();
  if (calendrier) calendrier.refetchEvents();
  if ($('#page-rdv').style.display !== 'none') chargerTableauRdv();
  toast('Rendez-vous supprimé.');
};

// ===================== MODALE =====================
function ouvrirModale(titre, html) {
  $('#modale-titre').textContent = titre;
  $('#modale-corps').innerHTML = html;
  $('#modale').style.display = 'flex';
}
window.fermerModale = function () { $('#modale').style.display = 'none'; };
$('#modale-fermer').addEventListener('click', fermerModale);
$('#modale').addEventListener('click', (e) => { if (e.target.id === 'modale') fermerModale(); });

// ===================== DÉMARRAGE =====================
async function demarrerApp() {
  await rafraichirUtilisateur();
  $('#ecran-auth').style.display = 'none';
  $('#app').style.display = 'block';
  await chargerListeActivites();
  allerPage('agenda');
}

async function init() {
  // Gestion du retour OAuth Google.
  const params = new URLSearchParams(location.search);
  if (params.has('google')) {
    const code = params.get('google');
    history.replaceState({}, '', location.pathname);
    if (code === 'ok') setTimeout(() => toast('Google Calendar connecté !', 'succes'), 400);
    else if (code === 'erreur') setTimeout(() => toast('Échec de la connexion Google.', 'erreur'), 400);
  }
  try {
    await API.get('/api/auth/me');
    await demarrerApp();
  } catch {
    $('#ecran-auth').style.display = 'flex';
  }
}

init();
