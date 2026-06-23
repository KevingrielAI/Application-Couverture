// Petit wrapper fetch JSON pour l'API.
const API = {
  async req(methode, url, corps) {
    const opts = { method: methode, headers: {}, credentials: 'same-origin' };
    if (corps !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(corps);
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch { /* corps vide */ }
    if (!res.ok) {
      const err = new Error((data && (data.message || data.erreur)) || `Erreur ${res.status}`);
      err.statut = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },
  get(url) { return this.req('GET', url); },
  post(url, c) { return this.req('POST', url, c); },
  put(url, c) { return this.req('PUT', url, c); },
  del(url) { return this.req('DELETE', url); },
};
