/* Nasze własne miejsca i zaległe dostawy — dwa ekrany, które widzi biuro.

   Lokalizacja firmowa to NIE klient. Klient to ktoś, do kogo wozimy towar
   i komu liczymy okna czasowe, dowody dostawy i historię. Magazyn, plac czy
   produkcja to miejsca, z których wyjeżdżamy. Trzymanie jednego i drugiego
   na tej samej liście kończy się tym, że własny magazyn wpada na trasę jako
   dostawa — dlatego to osobna kartoteka i osobny znacznik na mapie.        */

/* Bez podziału na rodzaje. Kartoteka naszych miejsc wygląda dokładnie tak samo
   jak kartoteka klientów — te same pola, ten sam układ. Różnica jest jedna
   i tylko ta ma znaczenie: to są NASZE miejsca, z których wyjeżdżamy, a nie
   odbiorcy, do których wozimy. */

/* ================================================== nasze lokalizacje */

EKRANY.lokalizacje = {
  tytul: 'Nasze lokalizacje',
  tylkoBiuro: true,
  async rysuj(pole) {
    const lista = await sprobuj(() => API.get('/api/lokalizacje?wszystkie=1')) || [];
    await odswiezLokalizacje();      // zeby wybor punktow na trasie tez byl swiezy
    const administrator = jestAdministratorem();

    pole.innerHTML = `
      <div class="pasek-narzedzi">
        <div class="male slaby" style="flex:1">
          Miejsca, z których wyjeżdżamy. Jedno z nich jest domyślną bazą całej firmy,
          a każdemu kierowcy można przypisać własne (Ustawienia → Konta).</div>
        <button class="glowny" id="l-nowa">+ Nowa lokalizacja</button>
      </div>
      ${lista.length ? lista.map(l => `
        <button class="przystanek ${l.domyslna ? 's-dostarczone' : 's-oczekuje'}"
                data-lok="${l.id}" style="${l.aktywna ? '' : 'opacity:.55'}">
          <span class="numer">${escHtml(l.nazwa[0] || '?')}</span>
          <span class="srodek">
            <span class="nazwa">${escHtml(l.nazwa)}${l.aktywna ? '' : ' <span class="male slaby">(ukryta)</span>'}</span>
            <span class="adres">${escHtml(adresJednymCiagiem(l)) || 'brak adresu'}</span>
            ${l.godziny ? `<span class="dopisek">🕒 ${escHtml(l.godziny)}</span>` : ''}
          </span>
          <span class="prawo">
            ${l.domyslna ? '<span class="plakietka p-dostarczone">baza firmy</span>' : ''}
            ${l.lat == null ? '<span class="plakietka p-nieudane">brak na mapie</span>' : ''}
          </span>
        </button>`).join('')
        : `<div class="karta"><div class="pusto"><span class="duza-ikona">🏭</span>
             Nie ma jeszcze żadnej lokalizacji. Dodaj magazyn, z którego wyjeżdżają busy.</div></div>`}

      ${lista.some(l => l.lat != null) ? `<div class="karta">
        <div class="karta-gora"><h2>Na mapie</h2></div>
        <div class="mapa" id="l-mapa"></div></div>` : ''}`;

    pole.querySelectorAll('[data-lok]').forEach(b => b.onclick =
      () => oknoLokalizacji(lista.find(l => l.id === Number(b.dataset.lok)), administrator));
    pole.querySelector('#l-nowa').onclick = () => oknoLokalizacji(null, administrator);

    const pojemnik = pole.querySelector('#l-mapa');
    if (pojemnik) {
      const mapa = Mapa.zaloz(pojemnik);
      const punkty = [];
      lista.filter(l => l.lat != null).forEach(l => {
        Mapa.znacznikFirmowy(mapa, l);
        punkty.push([l.lat, l.lon]);
      });
      Mapa.dopasujWidok(mapa, punkty);
    }
  },
};

function oknoLokalizacji(l, administrator) {
  const nowa = !l;
  l = l || { nazwa: '', ulica: '', kod: '', miasto: '', osoba: '', telefon: '',
             email: '', nip: '', godziny: '', uwagi: '', domyslna: 0, aktywna: 1 };
  okno({
    tytul: nowa ? 'Nowa lokalizacja' : escHtml(l.nazwa),
    tresc: `
      <label>Nazwa<input id="lo-nazwa" value="${escHtml(l.nazwa)}"
             placeholder="np. Strefa Płyt Wolsztyn"></label>
      <label>Ulica i numer<input id="lo-ulica" value="${escHtml(l.ulica)}"></label>
      <div class="dwie-kolumny">
        <label>Kod<input id="lo-kod" value="${escHtml(l.kod)}" placeholder="62-800"></label>
        <label>Miasto<input id="lo-miasto" value="${escHtml(l.miasto)}"></label>
      </div>
      <label>Osoba kontaktowa<input id="lo-osoba" value="${escHtml(l.osoba || '')}"></label>
      <div class="dwie-kolumny">
        <label>Telefon<input id="lo-telefon" value="${escHtml(l.telefon || '')}" inputmode="tel"></label>
        <label>E-mail<input id="lo-email" value="${escHtml(l.email || '')}" inputmode="email"></label>
      </div>
      <div class="dwie-kolumny">
        <label>NIP<input id="lo-nip" value="${escHtml(l.nip || '')}"></label>
        <label>Godziny<input id="lo-godziny" value="${escHtml(l.godziny || '')}"
               placeholder="np. 6:00-14:00"></label>
      </div>
      <label>Uwagi<textarea id="lo-uwagi">${escHtml(l.uwagi || '')}</textarea></label>
      <label class="plaska"><input type="checkbox" id="lo-domyslna" ${l.domyslna ? 'checked' : ''}>
        Domyślna baza wyjazdowa firmy</label>
      ${nowa ? '' : `<label class="plaska"><input type="checkbox" id="lo-aktywna"
        ${l.aktywna ? 'checked' : ''}> Lokalizacja używana</label>`}
      <p class="male slaby">Współrzędne program znajdzie sam po adresie. Domyślna baza jest
        punktem, od którego liczy się kilometry i czas trasy.</p>`,
    przyciski: [
      ...(nowa ? [] : [{ napis: '→ Przenieś do klientów', klik: async z => {
        if (!await potwierdz('Przenieść do kartoteki klientów?',
          'To miejsce przestanie być naszą lokalizacją, a stanie się zwykłym odbiorcą. '
          + 'Adres, telefon i uwagi idą razem z nim.')) return;
        const w = await sprobuj(() => API.post(`/api/lokalizacje/${l.id}/na-klienta`));
        if (!w) return;
        z();
        komunikat(w.odzyskany
          ? 'Wróciło do klientów — do tego samego wpisu, razem z historią dostaw.'
          : 'Przeniesione do klientów', 'ok');
        await odswiezLokalizacje(); stan.klienci = [];
        pokazEkran('lokalizacje');
      } }]),
      ...(!nowa && administrator ? [{ napis: 'Usuń', klasa: 'niszczacy', klik: async z => {
        if (!await potwierdz('Usunąć lokalizację?',
          'Jeśli jest gdzieś użyta, zostanie tylko ukryta.')) return;
        const w = await sprobuj(() => API.del(`/api/lokalizacje/${l.id}`));
        if (!w) return;
        z();
        komunikat(w.schowana
          ? (w.na_trasach ? `Ukryta — stoi na ${w.na_trasach} `
              + `${odmiana(w.na_trasach, 'trasie', 'trasach', 'trasach')}, więc nie kasuję`
              : 'Lokalizacja ukryta')
          : 'Lokalizacja usunięta', 'ok');
        await odswiezLokalizacje();
        pokazEkran('lokalizacje');
      } }] : []),
      { napis: 'Anuluj', klik: z => z() },
      { napis: 'Zapisz', klasa: 'glowny', klik: async z => {
        const wart = id => (document.getElementById(id) || {}).value || '';
        const dane = {
          id: l.id, nazwa: wart('lo-nazwa').trim(),
          ulica: wart('lo-ulica').trim(), kod: wart('lo-kod').trim(),
          miasto: wart('lo-miasto').trim(), osoba: wart('lo-osoba').trim(),
          telefon: wart('lo-telefon').trim(), email: wart('lo-email').trim(),
          nip: wart('lo-nip').trim(), godziny: wart('lo-godziny').trim(),
          uwagi: wart('lo-uwagi').trim(),
          domyslna: document.getElementById('lo-domyslna').checked,
          aktywna: nowa ? 1 : (document.getElementById('lo-aktywna').checked ? 1 : 0),
        };
        if (!dane.nazwa) return komunikat('Podaj nazwę lokalizacji', 'blad');
        if (!await sprobuj(() => API.post('/api/lokalizacje', dane))) return;
        z(); komunikat('Zapisane', 'ok');
        await odswiezLokalizacje();
        pokazEkran('lokalizacje');
      } },
    ],
  });
}

/* ==================================================== zaległe dostawy */

EKRANY.zalegle = {
  tytul: 'Zaległe dostawy',
  tylkoBiuro: true,
  async rysuj(pole) {
    const wynik = await sprobuj(() => API.get('/api/zalegle'));
    if (!wynik) return;
    // Bez tego rozwijana lista kierowców jest pusta i nadrobienie ląduje
    // na trasie bez przypisanego kierowcy — czyli u nikogo.
    await listaKierowcow();
    const zalegle = wynik.zalegle;
    if (!zalegle.length) {
      pole.innerHTML = `<div class="karta"><div class="pusto"><span class="duza-ikona">✓</span>
        Nic nie zalega. Wszystko z ostatnich ${wynik.dni} dni zostało dowiezione
        albo czeka na dziś.</div></div>`;
      return;
    }
    const zaznaczone = new Set(zalegle.map(z => z.id));

    const rysuj = () => {
      pole.innerHTML = `
        <div class="karta scisla">
          <div class="karta-gora"><h2 style="margin:0">Do nadrobienia</h2>
            <span class="plakietka p-nieudane">${zalegle.length}</span></div>
          <p class="male slaby" style="margin-top:8px">Punkty z ostatnich ${wynik.dni} dni,
            których nie udało się dowieźć. Zaznacz je i wskaż dzień — program przeniesie
            je na trasę i zapamięta, z którego dnia zalegają.</p>
        </div>
        ${zalegle.map(z => `
          <label class="przystanek s-nieudane" style="cursor:pointer">
            <input type="checkbox" data-zal="${z.id}" ${zaznaczone.has(z.id) ? 'checked' : ''}
                   style="width:22px;height:22px;flex:none;margin-right:4px">
            <span class="srodek">
              <span class="nazwa">${escHtml(z.klient_nazwa)}</span>
              <span class="adres">${escHtml(adresJednymCiagiem(z)) || 'brak adresu'}</span>
              <span class="dopisek">${escHtml(z.data)} · ${escHtml(z.kierowca_imie || 'bez kierowcy')}
                · ${z.ile_dni} ${odmiana(z.ile_dni, 'dzień', 'dni', 'dni')} temu</span>
              ${z.status === 'nieudane' && z.powod
                ? `<span class="dopisek">✕ ${escHtml(z.powod)}</span>`
                : '<span class="dopisek">nie zamknięte do końca dnia</span>'}
              ${z.towar ? `<span class="dopisek">📦 ${escHtml(z.towar)}</span>` : ''}
            </span>
          </label>`).join('')}

        <div class="karta">
          <div class="karta-gora"><h2>Wyznacz nadrobienie</h2></div>
          <div class="dwie-kolumny">
            <label>Na dzień<input type="date" id="z-data" value="${jutro()}"></label>
            <label>Kierowca<select id="z-kierowca">
              <option value="">— dowolny —</option>
              ${(stan.kierowcy || []).map(k =>
                `<option value="${k.id}">${escHtml(k.imie)}</option>`).join('')}
            </select></label>
          </div>
          <button class="glowny duzy" id="z-przenies">Przenieś zaznaczone</button>
          <p class="male slaby" style="margin-top:8px">Jeśli tego dnia jest już trasa tego
            kierowcy, punkty dopiszą się do niej. Jeśli nie — program założy nową.</p>
        </div>`;

      pole.querySelectorAll('[data-zal]').forEach(c => c.onchange = () => {
        const id = Number(c.dataset.zal);
        c.checked ? zaznaczone.add(id) : zaznaczone.delete(id);
      });
      pole.querySelector('#z-przenies').onclick = async () => {
        const punkty = Array.from(zaznaczone);
        if (!punkty.length) return komunikat('Zaznacz choć jeden punkt', 'blad');
        const data = pole.querySelector('#z-data').value;
        const kierowca = pole.querySelector('#z-kierowca').value;
        if (!data) return komunikat('Wskaż dzień', 'blad');
        if (!await potwierdz('Przenieść na nowy dzień?',
          `${punkty.length} ${odmiana(punkty.length, 'punkt', 'punkty', 'punktów')} trafi na `
          + `trasę ${data}.`)) return;
        const w = await zRyzykiemKolejki(
          { punkty, data, kierowca: kierowca ? Number(kierowca) : null },
          d => API.post('/api/zalegle/przenies', d));
        if (!w) return;
        komunikat(`Przeniesione: ${w.przeniesione.length}`, 'ok');
        pokazEkran('trasa', { id: w.trasa });
      };
    };
    rysuj();
  },
};

/* ============================================ odrzucone zapisy z telefonów */

/* Zapisy, których serwer nie przyjął (punkt przeniesiony do kogoś innego,
   odwołany, brak załadunku…). Kopia leży na serwerze od pierwszej odmowy —
   telefon może zginąć. Biuro je pobiera albo przyjmuje jednym przyciskiem. */
EKRANY.odrzucone = {
  tytul: 'Odrzucone zapisy',
  tylkoBiuro: true,
  async rysuj(pole) {
    const wynik = await sprobuj(() => API.get('/api/odrzucone'));
    if (!wynik) return;
    const lista = wynik.odrzucone || [];
    if (!lista.length) {
      pole.innerHTML = `<div class="karta"><div class="pusto"><span class="duza-ikona">✓</span>
        Nic nie czeka. Każdy zapis z telefonów doszedł na swoje miejsce.</div></div>`;
      return;
    }
    pole.innerHTML = `
      <div class="karta scisla"><p class="male slaby" style="margin:0">
        Zapisy z telefonów, których program nie przyjął sam. „Przyjmij” dopisuje podpis
        i zdjęcia do punktu tam, gdzie jest teraz. „Pobierz” zapisuje cały zapis
        w pliku.</p></div>
      ${lista.map(o => `<div class="karta scisla">
          <div class="karta-gora"><b>${escHtml(o.klient || (o.przystanek ? 'punkt ' + o.przystanek
            : (o.typ === 'raport' ? 'raport pracy' : 'zapis')))}</b>
            <span class="plakietka p-nieudane">${escHtml(o.typ === 'dostawa'
              ? (o.status === 'nieudane' ? 'nieudana dostawa' : 'dostawa') : (o.typ || '?'))}</span></div>
          <div class="male">${escHtml(o.kierowca || '?')} · zapisane ${escHtml(o.czas || '')}
            · odrzucone ${escHtml(o.odrzucono || '')}</div>
          <div class="male slaby">${escHtml(o.powod || (o.uszkodzony ? 'plik uszkodzony' : ''))}</div>
          ${o.data_trasy ? `<div class="male slaby">punkt jest teraz na zleceniu
            ${escHtml(polskaData(o.data_trasy))} (${escHtml(o.status_punktu)})</div>` : ''}
          <div class="male slaby">${o.podpis ? 'podpis' : 'bez podpisu'}${o.zdjec
            ? ' · ' + o.zdjec + ' ' + odmiana(o.zdjec, 'zdjęcie', 'zdjęcia', 'zdjęć') : ''}${
            o.odebral ? ' · odebrał: ' + escHtml(o.odebral) : ''}</div>
          <div class="przyciski" style="margin-top:8px">
            <button class="maly" data-pobierz="${escHtml(o.nazwa)}">Pobierz</button>
            ${o.mozna_przyjac ? `<button class="maly glowny" data-przyjmij="${escHtml(o.nazwa)}">
              Przyjmij</button>` : ''}
          </div>
        </div>`).join('')}`;

    pole.querySelectorAll('[data-pobierz]').forEach(b => b.onclick = async () => {
      const zapis = await sprobuj(() => API.get('/api/odrzucone/' + encodeURIComponent(b.dataset.pobierz)));
      if (!zapis) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(zapis, null, 1)],
        { type: 'application/json' }));
      link.download = b.dataset.pobierz;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    });
    pole.querySelectorAll('[data-przyjmij]').forEach(b => b.onclick = async () => {
      if (!await potwierdz('Przyjąć ten dowód?',
        'Podpis i zdjęcia trafią do punktu, a punkt zamknie się tym zapisem kierowcy.')) return;
      const w = await sprobuj(() => API.post(
        '/api/odrzucone/' + encodeURIComponent(b.dataset.przyjmij) + '/przyjmij'), 'Przyjęte');
      if (w) pokazEkran('odrzucone');
    });
  },
};

function jutro() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dataLokalna(d);              // nie UTC — po północy „jutro” było dzisiaj
}
