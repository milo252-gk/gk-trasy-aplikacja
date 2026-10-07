/* Statusy z bazy są jednym słowem bez ogonków — na wydruk dla klienta
   nie nadają się w takiej postaci. */
const OPIS_STATUSU = {
  oczekuje: 'DO ZROBIENIA', zaplanowane: 'ZAPLANOWANE',
  odwolany: 'ZDJĘTE Z TRASY', w_toku: 'W TRAKCIE',
};

/* Dowód dostawy: zdjęcia i podpis w programie, historia klienta, szukanie
   po numerze WZ i wydruk potwierdzenia na jedną kartkę.

   Do tej pory program zbierał dowody, których nie dało się użyć — mówił
   biuru „poszukaj w folderze pliki/ i dopasuj ręcznie". Reklamacja kończyła
   się korektą faktury, bo taniej było odpuścić niż szukać.                  */

/* Token do oglądania plików. Osobny od sesji, ważny godzinę i pozwalający
   wyłącznie czytać — adresy zdjęć trafiają do pamięci podręcznej przeglądarki,
   więc nie może być w nich tokenu sesji. */
let tokenPlikow = { wartosc: '', do: 0 };

async function tokenDoPlikow() {
  if (tokenPlikow.wartosc && Date.now() < tokenPlikow.do) return tokenPlikow.wartosc;
  const w = await API.post('/api/eksport/token', { zakres: 'pliki' });
  // Token do plików żyje 30 minut, więc odświeżamy go z zapasem po 25.
  tokenPlikow = { wartosc: w.token, do: Date.now() + 25 * 60 * 1000 };
  return tokenPlikow.wartosc;
}

/* adresDanych(): na GitHub Pages zdjęcia leżą w programie w biurze, pod adresem
   tunelu — goły „/pliki/…” pytałby o nie GitHuba i dawał puste ramki. */
function adresPliku(sciezka, token) {
  return adresDanych('/pliki/' + sciezka.split('/').map(encodeURIComponent).join('/'))
    + '?t=' + encodeURIComponent(token);
}

/* --------------------------------------------------- galeria załączników */

async function oknoZalacznikow(przystanekId, tytul) {
  const [zalaczniki, token] = await Promise.all([
    API.get(`/api/przystanki/${przystanekId}/zalaczniki`),
    tokenDoPlikow(),
  ]);
  if (!zalaczniki.length) {
    komunikat('Ten punkt nie ma zdjęć, podpisu ani zdjęcia z załadunku');
    return;
  }
  const podpisy = zalaczniki.filter(z => z.typ === 'podpis');
  const zdjecia = zalaczniki.filter(z => z.typ === 'zdjecie');
  // Zdjęcia z rampy to osobny dowód — na co bus był ładowany, a nie co
  // klient odebrał. Przy sporze „przywieźliście nie to" liczy się właśnie ono.
  const zaladunek = zalaczniki.filter(z => z.typ === 'zaladunek');

  okno({
    tytul: 'Dowód dostawy — ' + (tytul || ''),
    szerokie: true,
    tresc: `
      ${podpisy.length ? `<h3>Podpis odbierającego</h3>
        <div class="galeria">${podpisy.map(z => `
          <a class="dowod" href="${adresPliku(z.plik, token)}" target="_blank" rel="noopener">
            <img src="${adresPliku(z.plik, token)}" alt="podpis" loading="lazy">
          </a>`).join('')}</div>` : ''}
      ${zaladunek.length ? `<h3 style="margin-top:16px">Załadunek (${zaladunek.length})</h3>
        <div class="galeria">${zaladunek.map(z => `
          <a class="dowod" href="${adresPliku(z.plik, token)}" target="_blank" rel="noopener">
            <img src="${adresPliku(z.plik, token)}" alt="załadunek" loading="lazy">
          </a>`).join('')}</div>` : ''}
      ${zdjecia.length ? `<h3 style="margin-top:16px">Zdjęcia (${zdjecia.length})</h3>
        <div class="galeria">${zdjecia.map(z => `
          <a class="dowod" href="${adresPliku(z.plik, token)}" target="_blank" rel="noopener">
            <img src="${adresPliku(z.plik, token)}" alt="zdjęcie" loading="lazy">
          </a>`).join('')}</div>` : ''}
      <p class="male slaby" style="margin-top:14px">Dotknij, żeby powiększyć.
        Pliki leżą też w folderze <code>pliki/</code> obok programu.</p>`,
    przyciski: [
      { napis: 'Zamknij', klik: z => z() },
      { napis: '🖨 Wydrukuj potwierdzenie', klasa: 'glowny',
        klik: () => wydrukPotwierdzenia(przystanekId) },
    ],
  });
}

/* ------------------------------------------ wydruk potwierdzenia na A4 */

async function wydrukPotwierdzenia(przystanekId) {
  const [p, token] = await Promise.all([
    API.get(`/api/przystanki/${przystanekId}/potwierdzenie`),
    tokenDoPlikow(),
  ]);
  const podpis = (p.zalaczniki || []).find(z => z.typ === 'podpis');
  const zdjecia = (p.zalaczniki || []).filter(
    z => z.typ === 'zdjecie' || z.typ === 'zaladunek').slice(0, 4);
  const adres = adresJednymCiagiem(p);   // ta sama funkcja co wszędzie indziej

  const okienko = window.open('', '_blank');
  if (!okienko) { komunikat('Przeglądarka zablokowała nowe okno — pozwól na wyskakujące okna', 'blad'); return; }
  /* To jest DOKUMENT DO DRUKU dla klienta, nie ekran programu. Osobne okno,
     osobne drzewo DOM, własny <style> bez odnośnika do style.css — nic tu nie
     dziedziczy tokenów motywu i dziedziczyć nie ma. Zostaje jasny także wtedy,
     gdy biuro pracuje na motywie ciemnym; color-scheme:light jest po to, żeby
     przeglądarka z wymuszonym trybem ciemnym nie zainwertowała klientowi
     potwierdzenia odbioru towaru. Nie podpinać tego pod motyw.              */
  okienko.document.write(`<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8">
    <meta name="color-scheme" content="light">
    <title>Potwierdzenie dostawy — ${escHtml(p.klient_nazwa)}</title>
    <style>
      *{box-sizing:border-box}
      body{font:13px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;
           color:#16232f;background:#fff;
           margin:0;padding:18mm 16mm}
      h1{font-size:21px;margin:0 0 2px}
      .pod{color:#63707e;margin:0 0 18px;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-bottom:16px}
      th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #dfe5ec;vertical-align:top}
      th{width:34%;color:#63707e;font-weight:600}
      .status{display:inline-block;padding:3px 10px;border-radius:99px;font-weight:700}
      .ok{background:#e4f4ea;color:#1d7a45}
      .zle{background:#fceaeb;color:#b5232f}
      .podpis{border:1px solid #dfe5ec;border-radius:6px;max-width:320px;max-height:150px}
      .zdjecia{display:flex;gap:8px;flex-wrap:wrap}
      .zdjecia img{width:150px;height:150px;object-fit:cover;border:1px solid #dfe5ec;border-radius:6px}
      .stopka{margin-top:26px;color:#63707e;font-size:11px;border-top:1px solid #dfe5ec;padding-top:8px}
      @media print{body{padding:10mm} .nodruku{display:none}}
    </style></head><body>
    <h1>Potwierdzenie dostawy</h1>
    <p class="pod">${escHtml(p.firma || '')}${p.baza_adres ? ' · ' + escHtml(p.baza_adres) : ''}</p>
    <table>
      <tr><th>Klient</th><td><b>${escHtml(p.klient_nazwa)}</b>${p.nip ? '<br>NIP ' + escHtml(p.nip) : ''}</td></tr>
      <tr><th>Adres dostawy</th><td>${escHtml(adres) || '—'}</td></tr>
      <tr><th>Data</th><td>${escHtml(polskaData(p.data))}${
        p.zamkniete_o ? ', godz. ' + escHtml(String(p.zamkniete_o).slice(11, 16)) : ''}</td></tr>
      <tr><th>Status</th><td><span class="status ${p.status === 'dostarczone' ? 'ok' : 'zle'}">${
        p.status === 'dostarczone' ? 'DOSTARCZONE'
        : p.status === 'nieudane' ? 'NIEUDANA: ' + escHtml(p.powod || '')
        : escHtml(OPIS_STATUSU[p.status] || p.status.toUpperCase())}</span></td></tr>
      ${p.towar ? `<tr><th>Towar</th><td>${escHtml(p.towar)}</td></tr>` : ''}
      ${p.dokument ? `<tr><th>Dokument</th><td>${escHtml(p.dokument)}</td></tr>` : ''}
      ${p.odebral ? `<tr><th>Odebrał</th><td><b>${escHtml(p.odebral)}</b></td></tr>` : ''}
      ${p.notatka ? `<tr><th>Uwagi</th><td>${escHtml(p.notatka)}</td></tr>` : ''}
      <tr><th>Kierowca</th><td>${escHtml(p.kierowca_imie || '—')}${
        p.pojazd_nazwa ? ' · ' + escHtml(p.pojazd_nazwa) : ''}${
        p.rejestracja ? ' (' + escHtml(p.rejestracja) + ')' : ''}</td></tr>
    </table>
    ${podpis ? `<p><b>Podpis odbierającego</b></p>
      <img class="podpis" src="${adresPliku(podpis.plik, token)}" alt="podpis">` : ''}
    ${zdjecia.length ? `<p style="margin-top:16px"><b>Zdjęcia z dostawy</b></p>
      <div class="zdjecia">${zdjecia.map(z =>
        `<img src="${adresPliku(z.plik, token)}" alt="zdjęcie">`).join('')}</div>` : ''}
    <div class="stopka">Wydrukowano ${escHtml(czasTeraz())} z programu GK Trasy.</div>
    <p class="nodruku" style="margin-top:20px">
      <button onclick="window.print()" style="padding:10px 18px;font-size:14px">Drukuj</button></p>
    </body></html>`);
  okienko.document.close();
}

/* ----------------------------------------------- historia dostaw klienta */

async function oknoHistoriiKlienta(klientId, nazwa) {
  const historia = await API.get(`/api/klienci/${klientId}/historia`);
  const wiersz = (h) => `<tr>
      <td>${escHtml(polskaData(h.data))}</td>
      <td><span class="plakietka p-${h.status}">${
        h.status === 'dostarczone' ? '✓' : h.status === 'nieudane' ? '✕ ' + escHtml(h.powod || '') : escHtml(h.status)
      }</span></td>
      <td class="male">${escHtml(h.dokument || '')}</td>
      <td class="male">${escHtml((h.towar || '').slice(0, 40))}</td>
      <td class="male">${escHtml(h.odebral || '')}</td>
      <td class="male">${escHtml(h.kierowca_imie || '')}</td>
      <td>${h.ile_zalacznikow
        ? `<button class="maly" data-dowod="${h.id}">📎 ${h.ile_zalacznikow}</button>` : ''}</td>
    </tr>`;

  okno({
    tytul: 'Historia dostaw — ' + (nazwa || ''),
    szerokie: true,
    tresc: historia.length ? `
      <p class="male slaby">${historia.length} ${odmiana(historia.length, 'dostawa', 'dostawy', 'dostaw')}
        · ${historia.filter(h => h.status === 'nieudane').length} nieudanych</p>
      <div class="tabela-przewijana" style="max-height:60vh;overflow-y:auto">
        <table><thead><tr><th>Dzień</th><th>Status</th><th>Dokument</th><th>Towar</th>
          <th>Odebrał</th><th>Kierowca</th><th></th></tr></thead>
        <tbody>${historia.map(wiersz).join('')}</tbody></table>
      </div>`
      : '<div class="pusto">Ten klient nie miał jeszcze żadnej dostawy.</div>',
    przyciski: [{ napis: 'Zamknij', klik: z => z() }],
    poOtwarciu: pole => {
      pole.querySelectorAll('[data-dowod]').forEach(b =>
        b.onclick = () => oknoZalacznikow(Number(b.dataset.dowod), nazwa));
    },
  });
}

/* ------------------------------------------------- szukanie dostawy */

function oknoSzukania() {
  okno({
    tytul: 'Szukaj dostawy',
    szerokie: true,
    tresc: `
      <p class="male slaby">Reklamacja zaczyna się zwykle od numeru WZ albo nazwy klienta,
        nie od daty. Szukam w numerach dokumentów, nazwach klientów, towarze,
        nazwisku odbierającego i notatkach kierowcy.</p>
      <input id="sz-fraza" placeholder="np. 819587, Bud-Mat, Kowalski" autocomplete="off">
      <div id="sz-wyniki" style="margin-top:14px"></div>`,
    przyciski: [{ napis: 'Zamknij', klik: z => z() }],
    poOtwarciu: pole => {
      const wejscie = pole.querySelector('#sz-fraza');
      const wyniki = pole.querySelector('#sz-wyniki');
      let zegar = null;
      wejscie.focus();
      wejscie.oninput = () => {
        clearTimeout(zegar);
        const fraza = wejscie.value.trim();
        if (fraza.length < 2) { wyniki.innerHTML = ''; return; }
        zegar = setTimeout(async () => {
          const lista = await API.get('/api/szukaj?q=' + encodeURIComponent(fraza))
            .catch(() => null);
          if (!lista) return;
          wyniki.innerHTML = lista.length ? `
            <div class="male slaby">${lista.length} ${odmiana(lista.length,
              'wynik', 'wyniki', 'wyników')}</div>
            <div class="tabela-przewijana" style="max-height:50vh;overflow-y:auto">
            <table><thead><tr><th>Dzień</th><th>Klient</th><th>Dokument</th>
              <th>Status</th><th>Kierowca</th><th>Odebrał</th><th></th></tr></thead>
            <tbody>${lista.map(h => `<tr>
              <td>${escHtml(polskaData(h.data))}</td>
              <td><b>${escHtml(h.klient_nazwa)}</b></td>
              <td class="male">${escHtml(h.dokument || '')}</td>
              <td><span class="plakietka p-${h.status}">${
                h.status === 'dostarczone' ? '✓' : h.status === 'nieudane'
                  ? '✕ ' + escHtml(h.powod || '') : escHtml(h.status)}</span>${
                // „Gdzie jest mój towar" — biuro ma odpowiedzieć bez otwierania trasy.
                h.status === 'oczekuje' && h.kolejnosc ? `<br><span class="male slaby">${
                  h.kolejnosc}. z ${h.punktow_trasy || '?'}</span>` : ''}</td>
              <td class="male">${escHtml(h.kierowca_imie || '—')}</td>
              <td class="male">${escHtml(h.odebral || '')}</td>
              <td class="przyciski">
                ${h.ile_zalacznikow ? `<button class="maly" data-dowod="${h.id}"
                  data-nazwa="${escHtml(h.klient_nazwa)}">📎 ${h.ile_zalacznikow}</button>` : ''}
                <button class="maly" data-trasa="${h.trasa}">🗺</button>
                <button class="maly" data-druk="${h.id}">🖨</button></td>
            </tr>`).join('')}</tbody></table></div>`
            : '<div class="pusto">Nic nie znalazłem.</div>';
          wyniki.querySelectorAll('[data-dowod]').forEach(b =>
            b.onclick = () => oknoZalacznikow(Number(b.dataset.dowod), b.dataset.nazwa));
          wyniki.querySelectorAll('[data-druk]').forEach(b =>
            b.onclick = () => wydrukPotwierdzenia(Number(b.dataset.druk)));
          wyniki.querySelectorAll('[data-trasa]').forEach(b =>
            b.onclick = () => { zamknijOkno(); pokazEkran('trasa', { id: Number(b.dataset.trasa) }); });
        }, 350);
      };
    },
  });
}
