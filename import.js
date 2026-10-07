/* Kreator wczytywania planu dostaw z Excela.

   Zalozenie: arkusz pisza ludzie i nikt go nie bedzie porzadkowal pod program.
   Dlatego nic nie zgadujemy na sile — pokazujemy pierwsze wiersze tak, jak
   wygladaja, i prosimy o wskazanie, ktora kolumna jest ktora. Potem podglad
   pokazuje dokladnie to, co powstanie, zanim cokolwiek zapiszemy.            */

const stanImportu = {
  token: '', arkusz: '', arkusze: [], podglad: null,
  wierszNaglowka: 0, mapowanie: {}, plan: null,
};

const OPISY_POL = {
  data:     ['Data *', 'dzień dostawy — rozumie 24,08,26 · 26.08.2026 · datę z Excela'],
  miejsce:  ['Klient / miejsce *', 'nazwa albo adres — po tym program dopasuje klienta w kartotece'],
  towar:    ['Towar', 'co jedzie — kierowca widzi to przy punkcie'],
  dokument: ['Numer dokumentu', 'WZ, zamówienie; może być w tej samej kolumnie co godzina'],
  godzina:  ['Godzina', 'rozumie 8;00 · 9:30 · 10.00, także razem z numerem'],
  kierowca: ['Kierowca / przewoźnik', 'wiersze z tego samego dnia i kierowcy trafią na jedną trasę'],
};

EKRANY.import = {
  tytul: 'Wczytaj z Excela',
  tylkoBiuro: true,
  async rysuj(pole) {
    pole.innerHTML = `
      <button class="tekstowy" id="im-wroc">← Trasy</button>
      <div class="karta">
        <h2>1. Wskaż plik</h2>
        <p class="male slaby">Plik <b>.xlsx</b> — ten sam, w którym układacie plan.
          Program go nie zmienia, tylko czyta. Stary format <code>.xls</code> trzeba
          najpierw zapisać w Excelu jako <code>.xlsx</code>.</p>
        <input type="file" id="im-plik" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
      </div>
      <div id="im-reszta"></div>`;
    pole.querySelector('#im-wroc').onclick = () => pokazEkran('trasy');
    pole.querySelector('#im-plik').onchange = e => wgrajArkusz(e.target.files[0]);
  },
};

async function wgrajArkusz(plik) {
  await listaKierowcow();      // zeby krok mapowania mial kogo zaproponowac
  if (!plik) return;
  if (plik.size > 12 * 1024 * 1024) {
    komunikat('Plik jest większy niż 12 MB — to raczej nie jest plan dostaw', 'blad');
    return;
  }
  const base64 = await new Promise((zwroc, odrzuc) => {
    const czytnik = new FileReader();
    czytnik.onload = () => zwroc(czytnik.result);
    czytnik.onerror = () => odrzuc(new Error('Nie udało się odczytać pliku'));
    czytnik.readAsDataURL(plik);
  });

  const w = await sprobuj(() => API.post('/api/import/wgraj', { plik: base64 }));
  if (!w) return;
  stanImportu.token = w.token;
  stanImportu.arkusze = w.arkusze;
  stanImportu.arkusz = w.arkusze[0];
  stanImportu.podglad = w.podglad;
  stanImportu.mapowanie = {};
  stanImportu.wierszNaglowka = 0;
  stanImportu.plan = null;
  rysujKrokMapowania();
}

async function przelaczArkusz(nazwa) {
  const w = await sprobuj(() => API.post('/api/import/arkusz',
    { token: stanImportu.token, arkusz: nazwa }));
  if (!w) return;
  stanImportu.arkusz = nazwa;
  stanImportu.podglad = w;
  stanImportu.mapowanie = {};
  stanImportu.plan = null;
  rysujKrokMapowania();
}

function rysujKrokMapowania() {
  const p = stanImportu.podglad;
  const kolumny = Array.from({ length: p.kolumn }, (_, i) => i);
  const litera = i => {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  };
  // podpowiedz: pierwsza niepusta wartosc w kolumnie, zeby wiadomo bylo co jest co
  const przyklad = i => {
    for (const w of p.wiersze.slice(stanImportu.wierszNaglowka)) {
      if (w[i] && String(w[i]).trim()) return String(w[i]).trim().slice(0, 30);
    }
    return '';
  };

  const kierowcy = stan.kierowcy || [];
  const busy = stan.pojazdy.filter(b => b.aktywny);

  document.getElementById('im-reszta').innerHTML = `
    <div class="karta">
      <div class="karta-gora"><h2>2. Który arkusz</h2>
        <span class="male slaby">${p.wierszy} ${odmiana(p.wierszy, 'wiersz', 'wiersze', 'wierszy')}
          · ${p.kolumn} ${odmiana(p.kolumn, 'kolumna', 'kolumny', 'kolumn')}${
          p.obciete ? ' · <b style="color:var(--zolty)">arkusz jest większy, czytam pierwsze 20 000</b>' : ''}</span></div>
      <div class="chipy">
        ${stanImportu.arkusze.map(a => `<button type="button" class="chip ${a === stanImportu.arkusz ? 'wybrany' : ''}"
          data-arkusz="${escHtml(a)}">${escHtml(a)}</button>`).join('')}
      </div>
      <label style="margin-top:12px">Ile wierszy na górze pominąć
        <span class="slaby">(nagłówki, notatki — wiersz 1 to pierwszy wiersz arkusza)</span>
        <input type="number" id="im-naglowek" min="0" max="200" value="${stanImportu.wierszNaglowka}"
               style="max-width:140px">
      </label>
      <div class="tabela-przewijana" style="max-height:280px;overflow-y:auto">
        <table><thead><tr><th></th>
          ${kolumny.map(i => `<th>${litera(i)}</th>`).join('')}
        </tr></thead><tbody>
          ${p.wiersze.map((w, nr) => `<tr style="${nr < stanImportu.wierszNaglowka ? 'opacity:.35' : ''}">
            <td class="male slaby">${nr + 1}</td>
            ${kolumny.map(i => `<td class="male">${escHtml(String(w[i] || '').slice(0, 34))}</td>`).join('')}
          </tr>`).join('')}
        </tbody></table>
      </div>
    </div>

    <div class="karta">
      <h2>3. Która kolumna jest która</h2>
      <p class="male slaby">Gwiazdką oznaczone są kolumny obowiązkowe. Resztę możesz zostawić pustą.</p>
      <div class="siatka">
        ${Object.entries(OPISY_POL).map(([pole, [nazwa, opis]]) => `
          <label>${escHtml(nazwa)}
            <select data-pole="${pole}">
              <option value="-1">— nie ma takiej kolumny —</option>
              ${kolumny.map(i => `<option value="${i}" ${stanImportu.mapowanie[pole] === i ? 'selected' : ''}>
                ${litera(i)}${przyklad(i) ? ' · ' + escHtml(przyklad(i)) : ''}</option>`).join('')}
            </select>
            <span class="male slaby">${escHtml(opis)}</span>
          </label>`).join('')}
      </div>
    </div>

    <div class="karta">
      <h2>4. Co wczytać</h2>
      <div class="dwie">
        <label>Tylko od dnia
          <input type="date" id="im-od" value="${dzisiaj()}">
          <span class="male slaby">stare wiersze zostają w Excelu — nie zaśmiecają programu</span>
        </label>
        <label>Przypisz trasy kierowcy
          <select id="im-kierowca">
            <option value="">— przydzielę później —</option>
            ${kierowcy.map(k => `<option value="${k.id}">${escHtml(k.imie)}</option>`).join('')}
          </select>
        </label>
        <label>Bus
          <select id="im-pojazd">
            <option value="">— nie wybieram —</option>
            ${busy.map(b => `<option value="${b.id}">${escHtml(b.nazwa)}</option>`).join('')}
          </select>
        </label>
      </div>
      <button class="glowny duzy" id="im-podglad">Pokaż, co z tego powstanie</button>
    </div>
    <div id="im-wynik"></div>`;

  const pojemnik = document.getElementById('im-reszta');
  pojemnik.querySelectorAll('[data-arkusz]').forEach(b =>
    b.onclick = () => przelaczArkusz(b.dataset.arkusz));
  pojemnik.querySelectorAll('[data-pole]').forEach(s =>
    s.onchange = () => {
      const wartosc = Number(s.value);
      stanImportu.mapowanie[s.dataset.pole] = wartosc < 0 ? null : wartosc;
    });
  pojemnik.querySelector('#im-naglowek').onchange = e => {
    stanImportu.wierszNaglowka = Math.max(0, Number(e.target.value) || 0);
    rysujKrokMapowania();
  };
  pojemnik.querySelector('#im-podglad').onclick = pokazPodgladImportu;
}

function parametryImportu() {
  return {
    token: stanImportu.token,
    arkusz: stanImportu.arkusz,
    wiersz_naglowka: stanImportu.wierszNaglowka,
    od_daty: document.getElementById('im-od').value || dzisiaj(),
    mapowanie: stanImportu.mapowanie,
    kierowca: document.getElementById('im-kierowca').value || null,
    pojazd: document.getElementById('im-pojazd').value || null,
    wczytaj_duplikaty: !!(document.getElementById('im-duplikaty') || {}).checked,
  };
}

async function pokazPodgladImportu() {
  const plan = await sprobuj(() => API.post('/api/import/podglad', parametryImportu()));
  if (!plan) return;
  stanImportu.plan = plan;

  const nowi = plan.nowi_klienci.length;
  document.getElementById('im-wynik').innerHTML = `
    <div class="karta">
      <h2>5. Podgląd — nic jeszcze nie jest zapisane</h2>
      <div class="trzy">
        ${kafelek('Trasy', plan.trasy.length, '')}
        ${kafelek('Punkty do wczytania', plan.razem_przystankow, '')}
        ${kafelek('Nowi klienci', nowi, nowi ? 'var(--zolty)' : '')}
      </div>

      ${plan.duplikatow ? `<div class="wstega uwaga" style="margin-top:14px">
        <b>Pomijam ${plan.duplikatow} ${odmiana(plan.duplikatow, 'powtórkę', 'powtórki', 'powtórek')}.</b>
        Te punkty już są w programie — rozpoznaję je po numerze dokumentu, a gdy go nie ma,
        po parze dzień&nbsp;+&nbsp;klient. Dzięki temu możesz wczytać ten sam plik drugi raz
        i dojdą tylko nowe pozycje.
        <label class="plaska" style="margin:10px 0 0">
          <input type="checkbox" id="im-duplikaty">
          <span>Wczytaj je mimo to <span class="slaby">(zrobi trasy podwójnie —
            zaznacz tylko jeśli wiesz, że to naprawdę osobne dostawy)</span></span>
        </label>
      </div>` : ''}

      ${plan.trasy.length ? `
        <h3 style="margin-top:18px">Co powstanie</h3>
        <div class="tabela-przewijana" style="max-height:340px;overflow-y:auto">
          <table><thead><tr><th>Dzień</th><th>Nazwa trasy</th><th>Punkty</th></tr></thead>
          <tbody>${plan.trasy.slice(0, 60).map(t => `<tr>
            <td>${polskaData(t.data)}</td>
            <td>${escHtml(t.kierowca_tekst || '—')}</td>
            <td class="male">${t.przystanki.map(x => x.duplikat
              ? `<span class="slaby" style="text-decoration:line-through">${escHtml(x.klient.nazwa)}</span>
                 <span class="slaby">— ${escHtml(x.duplikat)}</span>`
              : `${escHtml(x.klient.nazwa)}${x.godzina ? ' <span class="slaby">' + x.godzina + '</span>' : ''}`
            ).join('<br>')}</td>
          </tr>`).join('')}</tbody></table>
        </div>
        ${plan.trasy.length > 60 ? `<p class="male slaby">…i jeszcze ${plan.trasy.length - 60}
          ${odmiana(plan.trasy.length - 60, 'trasa', 'trasy', 'tras')}.</p>` : ''}
      ` : '<div class="wstega uwaga">Nic nie wychodzi. Sprawdź mapowanie kolumn i datę, od której wczytujemy.</div>'}

      ${nowi ? `<h3 style="margin-top:18px">Nowi klienci, których program założy</h3>
        <p class="male slaby">Adresy rozebrane z tekstu — przejrzyj je potem w kartotece,
          bo od nich zależy układanie kolejności na mapie.</p>
        <div class="tabela-przewijana" style="max-height:240px;overflow-y:auto">
          <table><thead><tr><th>Nazwa</th><th>Ulica</th><th>Kod</th><th>Miasto</th></tr></thead>
          <tbody>${plan.nowi_klienci.map(k => `<tr>
            <td><b>${escHtml(k.nazwa)}</b></td><td>${escHtml(k.ulica)}</td>
            <td>${escHtml(k.kod)}</td><td>${escHtml(k.miasto)}</td>
            ${!k.kod ? '<td class="male" style="color:var(--zolty)">bez kodu — nie trafi na mapę</td>' : '<td></td>'}
          </tr>`).join('')}</tbody></table>
        </div>` : ''}

      ${plan.ile_pominietych ? `
        <details style="margin-top:16px">
          <summary class="male" style="cursor:pointer">Pominięte wiersze: ${plan.ile_pominietych}</summary>
          <div class="tabela-przewijana" style="max-height:220px;overflow-y:auto;margin-top:8px">
            <table><thead><tr><th>Wiersz</th><th>Dlaczego</th><th>Treść</th></tr></thead>
            <tbody>${plan.pominiete.map(x => `<tr>
              <td>${x.wiersz}</td><td class="male">${escHtml(x.powod)}</td>
              <td class="male slaby">${escHtml(x.tresc)}</td></tr>`).join('')}</tbody></table>
          </div>
        </details>` : ''}

      ${plan.trasy.length ? `<button class="glowny duzy" id="im-wykonaj" style="margin-top:18px">
        Wczytaj ${plan.trasy.length} ${odmiana(plan.trasy.length, 'trasę', 'trasy', 'tras')}
        do programu</button>` : ''}
    </div>`;

  const wykonaj = document.getElementById('im-wykonaj');
  if (wykonaj) wykonaj.onclick = async () => {
    const zPowtorkami = !!(document.getElementById('im-duplikaty') || {}).checked;
    const ilePunktow = zPowtorkami ? plan.razem_przystankow + plan.duplikatow : plan.razem_przystankow;
    if (!ilePunktow) { komunikat('Nie ma czego wczytać', 'blad'); return; }
    if (!await potwierdz('Wczytać do programu?',
      `Powstanie ${ilePunktow} ${odmiana(ilePunktow, 'punkt', 'punkty', 'punktów')}${
        nowi ? ` i ${nowi} ${odmiana(nowi, 'nowy klient', 'nowych klientów', 'nowych klientów')}` : ''}. `
      + (plan.duplikatow && !zPowtorkami
          ? `${plan.duplikatow} ${odmiana(plan.duplikatow, 'powtórka zostanie pominięta',
              'powtórki zostaną pominięte', 'powtórek zostanie pominiętych')}. ` : '')
      + 'Istniejące trasy zostają nietknięte — te dojdą obok.')) return;
    const w = await sprobuj(() => API.post('/api/import/wykonaj', parametryImportu()));
    if (!w) return;
    komunikat(`Wczytano ${w.trasy.length} ${odmiana(w.trasy.length, 'trasę', 'trasy', 'tras')}`
      + (w.pominietych_powtorek ? `, pominięto ${w.pominietych_powtorek} `
        + odmiana(w.pominietych_powtorek, 'powtórkę', 'powtórki', 'powtórek') : ''), 'ok');
    pokazEkran('trasy', { data: w.trasy[0].data });
  };
}
