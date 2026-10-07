/* Ekrany biura: pulpit, planowanie tras, klienci, raporty, ustawienia. */

let trasaWEdycji = null;
let mapaBiura = null;

/* ================================================================ PULPIT */

EKRANY.pulpit = {
  tytul: 'Pulpit',
  tylkoBiuro: true,
  async rysuj(pole, param) {
    const data = param.data || dzisiaj();
    const p = await API.get('/api/pulpit?data=' + data);

    const razem = p.trasy.reduce((s, t) => ({
      ile: s.ile + t.ile, ok: s.ok + t.ile_ok, nie: s.nie + t.ile_nie,
    }), { ile: 0, ok: 0, nie: 0 });

    pole.innerHTML = `
      <div id="p-alarmy"></div>
      <div class="pasek-narzedzi">
        <label>Dzień<input type="date" id="p-data" value="${data}"></label>
        <button id="p-wczoraj">← Poprzedni</button>
        <button id="p-jutro">Następny →</button>
        <button class="glowny" id="p-planuj">🗺️ Planuj zlecenia</button>
      </div>

      <div class="trzy kafle-pulpitu">
        ${kafelek('Punkty na dziś', razem.ile, '')}
        ${kafelek('Dostarczone', razem.ok, 'var(--zielony)')}
        ${kafelek('Nieudane', razem.nie, razem.nie ? 'var(--czerwony)' : '')}
      </div>

      <div id="p-zywo"></div>

      ${p.nieudane.length ? `
        <h2 style="margin-top:20px">Wymaga decyzji</h2>
        <div class="karta">
          ${p.nieudane.map(n => `<div style="padding:9px 0;border-bottom:1px solid var(--ramka)">
              <b>${escHtml(n.klient_nazwa)}</b>
              <span class="plakietka p-nieudane" style="margin-left:6px">${escHtml(n.powod)}</span>
              <div class="male slaby">${samaGodzina(n.zamkniete_o)} ${escHtml(n.notatka || '')}</div>
            </div>`).join('')}
        </div>` : ''}

      <div id="p-odrzucone"></div>
      <div id="p-zalegle"></div>
      <div id="p-braki"></div>

      <h2 style="margin-top:20px">Gdzie są busy
        <span class="male slaby" style="font-weight:400">
          ${p.ostatnie_pozycje.length ? '' : '— żaden kierowca nie udostępnia teraz położenia'}</span>
      </h2>
      <div class="mapa" id="p-mapa"></div>`;

    pole.querySelector('#p-data').onchange = e => pokazEkran('pulpit', { data: e.target.value });
    pole.querySelector('#p-wczoraj').onclick = () => pokazEkran('pulpit', { data: przesunDate(data, -1) });
    pole.querySelector('#p-jutro').onclick = () => pokazEkran('pulpit', { data: przesunDate(data, 1) });
    pole.querySelector('#p-planuj').onclick = () => pokazEkran('trasy', { data });
    await rysujZywo(pole.querySelector('#p-zywo'), data);
    odswiezajZywo(data);

    // Alarmy (kopie, token GitHuba, adres na Pages, dysk) — tylko administrator
    // może coś z nimi zrobić, więc tylko on je widzi.
    if (jestAdministratorem()) API.get('/api/alarmy').then(w => {
      const pole_al = pole.querySelector('#p-alarmy');
      if (!pole_al) return;
      pole_al.innerHTML = wstegiAlarmow(w.alarmy, true);
      pole_al.querySelectorAll('[data-do-ustawien]').forEach(e =>
        e.onclick = () => pokazEkran('ustawienia'));
    }).catch(() => {});

    // Zaległości są pierwszą rzeczą, o którą pyta klient przez telefon
    // („mieliście przywieźć wczoraj"), więc widać je od razu na pulpicie.
    API.get('/api/zalegle').then(w => {
      const pole_zal = pole.querySelector('#p-zalegle');
      if (!pole_zal || !w.zalegle.length) return;
      const nazwy = w.zalegle.slice(0, 3).map(z => z.klient_nazwa).join(', ');
      pole_zal.innerHTML = `<div class="wstega blad" style="margin-top:18px;cursor:pointer"
          id="p-do-zaleglych">
          <b>Zaległe dostawy: ${w.zalegle.length}</b> — ${escHtml(nazwy)}${
            w.zalegle.length > 3 ? '…' : ''}
          <span class="slaby">(dotknij, żeby wyznaczyć nadrobienie)</span>
        </div>`;
      pole_zal.querySelector('#p-do-zaleglych').onclick = () => pokazEkran('zalegle');
    }).catch(() => {});

    // Dowody, których serwer nie przyjął — podpis odbiorcy czeka na decyzję biura.
    API.get('/api/odrzucone').then(w => {
      const pole_odrz = pole.querySelector('#p-odrzucone');
      const ile = (w.odrzucone || []).length;
      if (!pole_odrz || !ile) return;
      pole_odrz.innerHTML = `<div class="wstega blad" style="margin-top:18px;cursor:pointer"
          id="p-do-odrzuconych">
          <b>Odrzucone zapisy z telefonów: ${ile}</b>
          <span class="slaby">(dotknij, żeby przyjąć albo pobrać)</span>
        </div>`;
      pole_odrz.querySelector('#p-do-odrzuconych').onclick = () => pokazEkran('odrzucone');
    }).catch(() => {});

    // krótka zajawka listy braków — pełna jest przy raportach
    API.get('/api/braki').then(w => {
      const pole_brakow = pole.querySelector('#p-braki');
      if (!pole_brakow || !w.braki.length) return;
      const pilne = w.braki.filter(b => b.rodzaj === 'brak_raportu' || b.rodzaj === 'licznik');
      pole_brakow.innerHTML = `<div class="wstega ${pilne.length ? 'uwaga' : 'info'}"
          style="margin-top:18px;cursor:pointer" id="p-do-brakow">
          <b>Do sprawdzenia: ${w.braki.length}</b> —
          ${escHtml(w.braki.slice(0, 2).map(b => b.opis).join('; '))}${
            w.braki.length > 2 ? '…' : ''} <span class="slaby">(dotknij, żeby zobaczyć wszystko)</span>
        </div>`;
      // ten sam zakres, żeby liczba z pulpitu zgadzała się z listą po kliknięciu
      pole_brakow.querySelector('#p-do-brakow').onclick = () =>
        pokazEkran('raporty', { od: w.od, do: w.do });
    }).catch(() => {});

    const mapa = Mapa.zaloz(pole.querySelector('#p-mapa'));
    const punkty = [];
    // Najpierw NASZE miejsca (ciemne kwadraty), potem busy (zwykle pinezki).
    // Rozróżnienie jest po to, żeby na jednej mapie było widać, co jest
    // magazynem, a co jadącym samochodem.
    API.get('/api/lokalizacje').then(lokalizacje => {
      stan.lokalizacje = lokalizacje;
      const dodatkowe = [];
      lokalizacje.filter(l => l.lat != null).forEach(l => {
        Mapa.znacznikFirmowy(mapa, l);
        dodatkowe.push([l.lat, l.lon]);
      });
      if (dodatkowe.length) Mapa.dopasujWidok(mapa, punkty.concat(dodatkowe));
    }).catch(() => {});
    if (p.baza && !punkty.length) punkty.push(p.baza);
    p.ostatnie_pozycje.forEach(poz => {
      // przez moduł, nie przez Leaflet wprost — mapa może być od Google
      Mapa.znacznikPozycji(mapa, [poz.lat, poz.lon],
        `<b>${escHtml(poz.kierowca_imie)}</b><br>ostatnio: ${escHtml(poz.czas)}`
        + `<br><span style="opacity:.7">${poz.zrodlo === 'lokalizator' ? 'lokalizator w busie' : 'telefon kierowcy'}</span>`);
      punkty.push([poz.lat, poz.lon]);
    });
    Mapa.dopasujWidok(mapa, punkty);
  },
};

function kafelek(napis, wartosc, kolor) {
  return `<div class="karta" style="text-align:center">
      <div class="male slaby">${escHtml(napis)}</div>
      <div class="liczba-kafelka" style="font-size:30px;font-weight:800;color:${kolor || 'var(--tekst)'}">${wartosc}</div>
    </div>`;
}

function przesunDate(iso, oIle) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + oIle);
  return dataLokalna(d);
}

/* ================================================================= TRASY */

EKRANY.trasy = {
  tytul: 'Zlecenia',
  async rysuj(pole, param) {
    const admin = jestBiuro();
    const data = param.data || dzisiaj();
    const od = param.od || (admin ? data : przesunDate(dzisiaj(), -30));
    const doDnia = param.do || data;
    // Biuro widzi też zlecenia odwołane (na końcu, wyszarzone) — zostały
    // w historii, bo miały dowody albo czekające zapisy telefonu.
    const trasy = admin
      ? await API.get('/api/trasy?odwolane=1&data=' + data)
      : await API.get(`/api/trasy?od=${od}&do=${doDnia}`);
    if (admin) trasy.sort((a, b) => (a.status === 'odwolana') - (b.status === 'odwolana'));

    if (!admin) {
      pole.innerHTML = `
        <div class="pasek-narzedzi">
          <label>Od<input type="date" id="t-od" value="${od}"></label>
          <label>Do<input type="date" id="t-do" value="${doDnia}"></label>
        </div>
        ${trasy.length ? trasy.map(t => kartaTrasy(t)).join('')
          : '<div class="karta"><div class="pusto">Brak zleceń w tym okresie.</div></div>'}`;
      const odswiez = () => pokazEkran('trasy', {
        od: pole.querySelector('#t-od').value, do: pole.querySelector('#t-do').value,
      });
      pole.querySelector('#t-od').onchange = odswiez;
      pole.querySelector('#t-do').onchange = odswiez;
      pole.querySelectorAll('[data-trasa]').forEach(b =>
        b.onclick = () => pokazEkran('trasa', { id: Number(b.dataset.trasa) }));
      return;
    }

    const kierowcy = await listaKierowcow();
    // ZAWSZE świeżo — inaczej po skasowaniu magazynu zostaje on na liście wyboru.
    await odswiezLokalizacje();
    pole.innerHTML = `
      <div class="pasek-narzedzi">
        <label>Dzień<input type="date" id="t-data" value="${data}"></label>
        <button id="t-wczoraj">←</button><button id="t-jutro">→</button>
        <button class="glowny" id="t-nowa">+ Nowe zlecenie</button>
        <button id="t-import">📄 Wczytaj z Excela</button>
      </div>
      ${kierowcy.length ? '' : `<div class="wstega uwaga">
          Nie masz jeszcze żadnego konta kierowcy. Załóż je w Ustawieniach → Konta.</div>`}
      ${trasy.length ? trasy.map(t => kartaTrasy(t)).join('')
        : `<div class="karta"><div class="pusto"><span class="duza-ikona">🗺️</span>
             Na ${polskaData(data)} nie ma jeszcze trasy.</div></div>`}`;

    pole.querySelector('#t-data').onchange = e => pokazEkran('trasy', { data: e.target.value });
    pole.querySelector('#t-wczoraj').onclick = () => pokazEkran('trasy', { data: przesunDate(data, -1) });
    pole.querySelector('#t-jutro').onclick = () => pokazEkran('trasy', { data: przesunDate(data, 1) });
    pole.querySelector('#t-nowa').onclick = () => oknoNowejTrasy(data, kierowcy);
    pole.querySelector('#t-import').onclick = () => pokazEkran('import');
    pole.querySelectorAll('[data-trasa]').forEach(b =>
      b.onclick = () => pokazEkran('trasa', { id: Number(b.dataset.trasa) }));
  },
};

function kartaTrasy(t) {
  return `<button class="przystanek s-oczekuje" data-trasa="${t.id}" style="border-left-color:${
    t.status === 'zakonczona' ? 'var(--zielony)' : t.status === 'w_toku' ? 'var(--zolty)' : 'var(--akcent)'}">
      <span class="numer">${t.ile}</span>
      <span class="srodek">
        <span class="nazwa">${escHtml(t.nazwa || 'Zlecenie ' + polskaData(t.data))}</span>
        <span class="adres">${polskaData(t.data)} · ${escHtml(t.kierowca_imie || 'bez kierowcy')}
          ${t.pojazd_nazwa ? ' · ' + escHtml(t.pojazd_nazwa) : ''}</span>
        <span class="dopisek">${t.ile_ok} ${odmiana(t.ile_ok, 'dostarczona', 'dostarczone', 'dostarczonych')}${
          t.ile_nie ? ', ' + t.ile_nie + ' ' + odmiana(t.ile_nie, 'nieudana', 'nieudane', 'nieudanych') : ''}
          z ${t.ile}</span>
      </span>
      <span class="prawo"><span class="plakietka p-${t.status}">${escHtml(
        t.status === 'odwolana' ? 'odwołane' : t.status.replace('_', ' '))}</span></span>
    </button>`;
}

/* Wyłącznie osoby, które faktycznie jeżdżą. Konto biura na liście „Kierowca"
   kusi, żeby przypisać mu trasę — a taka trasa nie dojedzie do żadnego telefonu. */
async function listaKierowcow() {
  if (!jestBiuro()) return [];
  // Osobny, okrojony wykaz zamiast pełnej listy kont: konta widzi tylko
  // administrator, a trasy układa też biuro i musi wskazać kierowcę.
  if (!stan.kierowcy) stan.kierowcy = await API.get('/api/kierowcy');
  return stan.kierowcy;
}

/* ------------------------------------------- stan aut z GK Flota (GK Transport) */

/* GK Flota prowadzi przeglądy, terminy i usterki. GK Trasy tylko pokazuje jego
   zdanie o aucie: sprawne / uwagi / niesprawne. Bez pary w GK Flota (albo bez
   połączenia) pole flotex jest puste i nic się nie rysuje. Decyzja zostaje
   przy planiście — niesprawne auto da się przypisać, ale po pytaniu.       */
function znacznikFlotexu(f) {
  if (!f) return '';
  if (!f.sprawny) {
    return `<span class="plakietka p-nieudane" title="${escHtml((f.powody || []).join('\n'))}">`
      + '⚠ niesprawne</span>';
  }
  if ((f.uwagi || []).length) {
    return `<span class="plakietka p-w_toku" title="${escHtml(f.uwagi.join('\n'))}">! uwagi</span>`;
  }
  return '<span class="plakietka p-dostarczone" title="GK Flota: bez zastrzeżeń">✓ sprawne</span>';
}

/* Powody drobnym drukiem pod znacznikiem — title nie działa na telefonie. */
function powodyFlotexu(f) {
  if (!f) return '';
  const lista = !f.sprawny ? (f.powody || []) : (f.uwagi || []);
  return lista.length ? `<div class="male slaby">${lista.map(escHtml).join('<br>')}</div>` : '';
}

function opcjaBusa(b, wybrany) {
  const zly = b.flotex && !b.flotex.sprawny;
  return `<option value="${b.id}" ${wybrany ? 'selected' : ''}>${zly ? '⚠ ' : ''}${escHtml(b.nazwa)}${
    b.rejestracja ? ' · ' + escHtml(b.rejestracja) : ''}${zly ? ' — niesprawne' : ''}</option>`;
}

/* Pytanie przed przypisaniem auta, które GK Flota uznała za niesprawne.
   true = można zapisywać. Serwer niczego nie blokuje — to jest ostrzeżenie. */
async function zgodaNaBus(idBusa) {
  const b = stan.pojazdy.find(x => x.id === Number(idBusa));
  const f = b && b.flotex;
  if (!f || f.sprawny) return true;
  return potwierdz('Auto niesprawne',
    `GK Flota: auto ${b.rejestracja || b.nazwa} jest niesprawne — `
    + `${(f.powody || []).join('; ') || 'bez podanego powodu'}. Przypisać mimo to?`,
    { tak: 'Przypisz mimo to', nie: 'Wybiorę inne', groznie: true });
}

function oknoNowejTrasy(data, kierowcy) {
  const busy = stan.pojazdy.filter(p => p.aktywny);
  okno({
    tytul: 'Nowe zlecenie',
    tresc: `
      <label>Dzień<input type="date" id="nt-data" value="${data}"></label>
      <label>Kierowca
        <select id="nt-kierowca">
          <option value="">— przydzielę później —</option>
          ${kierowcy.map(k => `<option value="${k.id}">${escHtml(k.imie)}</option>`).join('')}
        </select>
      </label>
      <label>Bus
        <select id="nt-pojazd">
          <option value="">— nie wybrano —</option>
          ${busy.map(b => opcjaBusa(b, false)).join('')}
        </select>
      </label>
      <label>Nazwa <span class="slaby">(np. „Wschód", „Poranna")</span>
        <input id="nt-nazwa" placeholder="nieobowiązkowa">
      </label>
      <label>Układ zlecenia
        <select id="nt-uklad">${opcjeUkladu('baza_baza')}</select></label>
      <p class="male slaby">Domyślnie zlecenie wyjeżdża z bazy i do niej wraca.
        Wożąc towar między naszymi magazynami wybierz „Bez bazy" — inaczej program
        doliczy dojazd i powrót, których nikt nie jedzie. Da się to zmienić później.</p>`,
    przyciski: [
      { napis: 'Anuluj', klik: z => z() },
      { napis: 'Utwórz', klasa: 'glowny', klik: async z => {
        if (!await zgodaNaBus(document.getElementById('nt-pojazd').value)) return;
        const nowa = await sprobuj(() => API.post('/api/trasy', {
          uklad: document.getElementById('nt-uklad').value,
          data: document.getElementById('nt-data').value,
          kierowca: document.getElementById('nt-kierowca').value || null,
          pojazd: document.getElementById('nt-pojazd').value || null,
          nazwa: document.getElementById('nt-nazwa').value.trim(),
        }));
        if (nowa) { z(); pokazEkran('trasa', { id: nowa.id }); }
      } },
    ],
  });
}

/* ------------------------------------------------- jedna trasa: edytor */

EKRANY.trasa = {
  tytul: 'Zlecenie',
  async rysuj(pole, param) {
    const id = param.id || (trasaWEdycji && trasaWEdycji.id);
    if (!id) return pokazEkran('trasy');
    trasaWEdycji = await API.get('/api/trasy/' + id);
    const t = trasaWEdycji;
    const admin = jestBiuro();
    document.getElementById('tytul-ekranu').textContent =
      (t.nazwa || 'Trasa') + ' · ' + polskaData(t.data);

    const kierowcy = await listaKierowcow();
    // Świeży stan aut: GK Flota mogła od rana uznać któreś za niesprawne.
    if (admin) stan.pojazdy = await API.get('/api/pojazdy').catch(() => stan.pojazdy);
    const busy = stan.pojazdy.filter(p => p.aktywny || p.id === t.pojazd);
    ETA.policz(t);

    pole.innerHTML = `
      <button class="tekstowy" id="tr-wroc">← Wszystkie zlecenia</button>
      ${t.status === 'odwolana' ? `<div class="wstega uwaga">Zlecenie odwołane — nie ma go
        w planie ani w telefonie kierowcy. Zostaje w historii razem z dowodami.</div>` : ''}

      ${admin ? `<div class="karta">
        ${t.flotex && !t.flotex.sprawny ? `<div class="wstega blad">⚠ GK Flota: auto
          ${escHtml(t.rejestracja || t.pojazd_nazwa || '')} jest niesprawne —
          ${escHtml((t.flotex.powody || []).join('; ') || 'bez podanego powodu')}.</div>` : ''}
        <div class="dwie">
          <label>Dzień<input type="date" id="tr-data" value="${t.data}"></label>
          <label>Kierowca
            <select id="tr-kierowca">
              <option value="">— nie przydzielono —</option>
              ${kierowcy.map(k => `<option value="${k.id}" ${t.kierowca === k.id ? 'selected' : ''}>${escHtml(k.imie)}</option>`).join('')}
            </select>
          </label>
          <label>Bus
            <select id="tr-pojazd">
              <option value="">— nie wybrano —</option>
              ${busy.map(b => opcjaBusa(b, t.pojazd === b.id)).join('')}
            </select>
          </label>
          <label>Nazwa<input id="tr-nazwa" value="${escHtml(t.nazwa || '')}"></label>
          <label>Godzina wyjazdu
            <input type="time" id="tr-wyjazd" value="${escHtml(t.wyjazd_o || '')}"
                   placeholder="${escHtml(t.wyjazd || '07:00')}"></label>
          <label>Baza w tym zleceniu
            <select id="tr-baza">
              <option value="">— ${escHtml(t.baza_nazwa || 'baza domyślna')} —</option>
              ${(stan.lokalizacje || []).filter(l => l.aktywna !== 0).map(l =>
                `<option value="${l.id}" ${t.baza === l.id ? 'selected' : ''}>${escHtml(l.nazwa)}</option>`).join('')}
            </select></label>
        </div>
        <label>Układ zlecenia
          <select id="tr-uklad">
            ${opcjeUkladu(t.uklad)}
          </select></label>
        <p class="male slaby" style="margin:-6px 0 10px">Baza jest <b>podpowiedzią</b>,
          nie założeniem. Zlecenie z jednego naszego magazynu do drugiego to same punkty
          na mapie — wybierz wtedy „Bez bazy", a program przestanie doliczać przejazdy,
          których nikt nie robi. Pusta godzina znaczy: domyślna z Ustawień
          (${escHtml(stan.ustawienia.godzina_wyjazdu || '07:00')}).</p>
        <label>Uwagi dla kierowcy <span class="slaby">(widzi je na górze swojego ekranu)</span>
          <textarea id="tr-uwagi">${escHtml(t.uwagi || '')}</textarea>
        </label>
        <div class="przyciski rozstaw">
          <button class="glowny" id="tr-zapisz">Zapisz zmiany</button>
          <div class="przyciski">
            <button class="maly" id="tr-mapa-link">🧭 Wyślij do Google Maps</button>
            <button class="maly" id="tr-szablon">Zapisz jako zlecenie stałe</button>
            <button class="maly" id="tr-kopiuj">Kopiuj na inny dzień</button>
            <button class="maly" id="tr-usun">Usuń zlecenie</button>
          </div>
        </div>
      </div>` : `<div class="karta scisla">
        <b>${escHtml(t.kierowca_imie || '')}</b> · ${escHtml(t.pojazd_nazwa || 'bez busa')}
        ${t.uwagi ? `<div class="wstega info" style="margin:10px 0 0">📌 ${escHtml(t.uwagi)}</div>` : ''}
      </div>`}

      <div class="karta">
        <div class="karta-gora">
          <h2>Punkty (${t.przystanki.length})</h2>
          ${admin ? `<div class="przyciski">
            <button class="maly glowny" id="tr-dodaj">+ Dodaj punkty</button>
            <button class="maly" id="tr-optymalizuj">✨ Zaproponuj kolejność</button>
          </div>` : ''}
        </div>
        <div id="tr-lista">
          ${t.przystanki.length ? t.przystanki.map((p, i) => wierszPrzystanku(p, i, t.przystanki.length, admin)).join('')
            : '<div class="pusto">Brak punktów. Dodaj klientów albo nasze miejsca, żeby ułożyć zlecenie.</div>'}
        </div>
      </div>

      ${t.szacunek ? `<div class="karta scisla">
        <div class="karta-gora"><h2 style="margin:0">Przewidywany czas realizacji</h2>
          <span class="plakietka ${t.szacunek.doba_przekroczona
            || t.szacunek.limit_jazdy_przekroczony ? 'p-nieudane' : 'p-dostarczone'}">
            ${godzinyMinuty(t.szacunek.minuty)}</span></div>
        <div class="kafelki">
          <div><span class="etykieta">${t.szacunek.start_w_bazie ? 'Wyjazd z bazy' : 'Start'}</span>
            <b>${escHtml(t.szacunek.wyjazd)}</b></div>
          <div><span class="etykieta">${t.szacunek.powrot_do_bazy
            ? 'Powrót ok.' : 'Koniec ok.'}</span><b>${escHtml(t.szacunek.powrot || '—')}</b></div>
          <div><span class="etykieta">Trasa</span><b>${t.szacunek.km} km</b></div>
          <div><span class="etykieta">Punktów</span><b>${t.szacunek.punktow}</b></div>
        </div>
        <p class="male slaby" style="margin-top:10px">
          Jazda ${godzinyMinuty(t.szacunek.minuty_jazdy)} ·
          postoje ${godzinyMinuty(t.szacunek.minuty_postojow)}
          (${t.szacunek.postoj_na_punkt} min na punkt${t.szacunek.z_historii
            ? ' — <b>policzone z waszych dostaw</b>' : ' — z Ustawień'})${
            t.szacunek.minuty_zaladunkow ? ` · w tym załadunki u nas
            ${godzinyMinuty(t.szacunek.minuty_zaladunkow)}` : ''}${
            t.szacunek.minuty_przerw ? ` · przerwy kierowcy
            ${godzinyMinuty(t.szacunek.minuty_przerw)} (${t.szacunek.ile_przerw})` : ''}.
          ${t.szacunek.powrot_do_bazy ? '' : '<br><span class="slaby">Zlecenie kończy się '
            + 'u ostatniego punktu — powrotu do bazy nie doliczam.</span>'}
          ${t.szacunek.start_w_bazie ? '' : '<br><span class="slaby">Liczę od pierwszego '
            + 'punktu — dojazdu z bazy nie doliczam.</span>'}
          ${t.szacunek.przepisy ? '' : '<br><span class="slaby">Przy tym pojeździe '
            + 'przerw nie doliczamy (ustawienie przy buscie).</span>'}
          ${t.szacunek.limit_jazdy_przekroczony
            ? `<br><span style="color:var(--czerwony)"><b>Sama jazda przekracza
              ${godzinyMinuty(Number(stan.ustawienia.dobowy_limit_jazdy_min) || 540)}</b>
              — próg ustawiacie w Ustawieniach. Rozważ podział na dwie trasy.</span>` : ''}
          ${t.szacunek.doba_przekroczona
            ? `<br><span style="color:var(--czerwony)"><b>Cały dzień przekracza
              ${godzinyMinuty(Number(stan.ustawienia.doba_pracy_min) || 780)}</b>
              od wyjazdu do powrotu.</span>` : ''}
          ${t.szacunek.bez_mapy ? `<br><span style="color:var(--zolty)">
            ${t.szacunek.bez_mapy} ${odmiana(t.szacunek.bez_mapy, 'punkt nie ma', 'punkty nie mają',
              'punktów nie ma')} odnalezionego adresu — szacunek ich nie obejmuje.</span>` : ''}
        </p>
      </div>` : ''}

      <div class="karta">
        <div class="karta-gora"><h2>Mapa</h2>
          <button class="maly" id="tr-przebieg">Pokaż przebieg po drogach</button>
        </div>
        <div class="mapa wysoka" id="tr-mapa"></div>
        <div class="male slaby" style="margin-top:8px" id="tr-info-mapa">
          Przerywana linia to odcinki w linii prostej — tylko podgląd kolejności.
        </div>
      </div>`;

    pole.querySelector('#tr-wroc').onclick = () => pokazEkran('trasy', { data: t.data });

    if (admin) {
      pole.querySelector('#tr-zapisz').onclick = async () => {
        // Pytamy tylko przy ZMIANIE auta — o tym już przypisanym mówi wstęga
        // na górze, a pytanie przy każdej poprawce uwag nauczyłoby klikać „tak".
        const bus = pole.querySelector('#tr-pojazd').value;
        if (Number(bus) !== Number(t.pojazd || 0) && !await zgodaNaBus(bus)) return;
        const w = await sprobuj(() => API.post('/api/trasy', {
          id: t.id,
          data: pole.querySelector('#tr-data').value,
          kierowca: pole.querySelector('#tr-kierowca').value || null,
          pojazd: pole.querySelector('#tr-pojazd').value || null,
          nazwa: pole.querySelector('#tr-nazwa').value.trim(),
          uwagi: pole.querySelector('#tr-uwagi').value.trim(),
          wyjazd_o: pole.querySelector('#tr-wyjazd').value || '',
          baza: pole.querySelector('#tr-baza').value || null,
          uklad: pole.querySelector('#tr-uklad').value,
        }), 'Zapisano');
        if (w) pokazEkran('trasa', { id: t.id });
      };
      pole.querySelector('#tr-usun').onclick = async () => {
        if (!await potwierdz('Usunąć całe zlecenie?',
          'Zlecenie z załadunkiem, zdjęciami albo czekającymi zapisami telefonu '
          + 'zostanie tylko odwołane — dowody zostają w historii.')) return;
        const w = await sprobuj(() => API.del('/api/trasy/' + t.id));
        if (!w) return;
        komunikat(w.odwolana ? `Zlecenie odwołane, nie skasowane — ${w.dlaczego}`
          : 'Zlecenie usunięte', 'ok');
        pokazEkran('trasy', { data: t.data });
      };
      pole.querySelector('#tr-kopiuj').onclick = () => oknoKopiowania(t);
      pole.querySelector('#tr-mapa-link').onclick = () => oknoLinkuDoMap(t.id, false);
      pole.querySelector('#tr-szablon').onclick = () => okno({
        tytul: 'Zapisz jako zlecenie stałe',
        tresc: `<p class="male slaby">Zapamiętam klientów i ich kolejność. Bez dat,
            bez potwierdzeń — żeby dało się z tego robić kolejne dni.</p>
          <label>Nazwa szablonu<input id="zs-nazwa"
            value="${escHtml(t.nazwa || 'Zlecenie ' + polskaData(t.data))}"></label>`,
        przyciski: [
          { napis: 'Anuluj', klik: z => z() },
          { napis: 'Zapisz', klasa: 'glowny', klik: async z => {
            const w = await sprobuj(() => API.post(`/api/trasy/${t.id}/szablon`,
              { nazwa: val('zs-nazwa') }), 'Szablon zapisany');
            if (w) { z(); pokazEkran('szablony'); }
          } },
        ],
      });
      pole.querySelector('#tr-dodaj').onclick = () => oknoDodawaniaKlientow(t);
      pole.querySelector('#tr-optymalizuj').onclick = () => zaproponujKolejnosc(t);

      pole.querySelectorAll('[data-gora]').forEach(b =>
        b.onclick = () => przestaw(t, Number(b.dataset.gora), -1));
      pole.querySelectorAll('[data-dol]').forEach(b =>
        b.onclick = () => przestaw(t, Number(b.dataset.dol), 1));
      pole.querySelectorAll('[data-usun-przystanek]').forEach(b => b.onclick = async () => {
        const punkt = t.przystanki.find(x => x.id === Number(b.dataset.usunPrzystanek)) || {};
        const ruszyla = t.status !== 'planowana';
        if (!await potwierdz(
          `Zdjąć z trasy: ${punkt.klient_nazwa || 'ten punkt'}?`,
          ruszyla
            ? 'Zlecenie już ruszyło, więc punkt zostanie w nim oznaczony jako zdjęty — '
              + 'gdyby kierowca zdążył go potwierdzić bez zasięgu, jego podpis nie przepadnie.'
            : 'Punkt zniknie ze zlecenia. Jeśli ma załadunek albo telefon kierowcy ma '
              + 'czekające zapisy, zostanie tylko zdjęty — dowody nie przepadną.')) return;
        const w = await sprobuj(() => API.del('/api/przystanki/' + b.dataset.usunPrzystanek));
        if (!w) return;
        komunikat(w.zdjety_nie_skasowany
          ? 'Punkt zdjęty ze zlecenia — zostaje widoczny razem z dowodami'
          : 'Punkt usunięty ze zlecenia', 'ok');
        pokazEkran('trasa', { id: t.id });
      });
    }
    pole.querySelectorAll('[data-szczegoly]').forEach(b =>
      b.onclick = () => oknoSzczegolowPunktu(t, Number(b.dataset.szczegoly)));

    mapaBiura = Mapa.zaloz(pole.querySelector('#tr-mapa'));
    // Baza bierze sie z trasy (moze byc inna dla kazdego kierowcy), a nie
    // juz z jednego ustawienia na cala firme.
    const baza = t.baza_lat != null ? [t.baza_lat, t.baza_lon]
      : (stan.ustawienia.baza_lat
         ? [Number(stan.ustawienia.baza_lat), Number(stan.ustawienia.baza_lon)] : null);
    // Mapa rysuje dokładnie to, co program liczy: bazę jako start tylko wtedy,
    // gdy zlecenie stamtąd wyjeżdża, i jako metę tylko wtedy, gdy tam wraca.
    const bazaStart = ukladStart(t.uklad) ? baza : null;
    const bazaKoniec = ukladPowrot(t.uklad) ? baza : null;
    const ile = Mapa.rysujTrase(mapaBiura, t.przystanki,
      { bazaStart, bazaKoniec, bazaNazwa: t.baza_nazwa });
    if (ile < t.przystanki.length) {
      pole.querySelector('#tr-info-mapa').innerHTML =
        `<span style="color:var(--zolty)">Część klientów nie ma jeszcze odnalezionego adresu —
         popraw adres w kartotece albo kliknij „Znajdź na mapie" przy kliencie.</span>`;
    }
    const przyciskPrzebieg = pole.querySelector('#tr-przebieg');
    przyciskPrzebieg.onclick = async () => {
      const info = pole.querySelector('#tr-info-mapa');
      przyciskPrzebieg.disabled = true;
      przyciskPrzebieg.textContent = 'Liczę przebieg…';
      info.innerHTML = '<span class="slaby">Pytam o przejazd po drogach…</span>';
      try {
        let w = await sprobuj(() => API.post(`/api/trasy/${t.id}/przebieg`));
        if (!w) return;
        // Bez klucza OpenRouteService serwer odsyła same punkty, a kształt po
        // drogach dorysowuje przeglądarka — dzięki temu działa to bez żadnej
        // rejestracji i tak samo na Macu jak na Windowsie.
        if (w.zrodlo === 'przegladarka') w = await Mapa.przebiegPoDrogach(w.punkty);
        if (!w) return;
        Mapa.rysujTrase(mapaBiura, t.przystanki,
          { bazaStart, bazaKoniec, bazaNazwa: t.baza_nazwa, linia: w.linia });
        info.innerHTML =
          `Po drogach: <b>${w.km} km</b> · około <b>${w.minuty} min</b> jazdy (bez postojów u klientów).`;
      } catch (e) {
        info.innerHTML = '<span style="color:var(--zolty)">Nie udało się pobrać przebiegu po drogach '
          + `(${escHtml(poLudzku(e))}). Mapa pokazuje odcinki w linii prostej.</span>`;
      } finally {
        przyciskPrzebieg.disabled = false;
        przyciskPrzebieg.textContent = 'Pokaż przebieg po drogach';
      }
    };
  },
};

function wierszPrzystanku(p, indeks, ile, admin) {
  const status = p.status === 'dostarczone' ? '<span class="plakietka p-dostarczone">✓</span>'
    : p.status === 'nieudane' ? `<span class="plakietka p-nieudane">✕ ${escHtml(p.powod)}</span>`
    : p.status === 'odwolany' ? '<span class="plakietka p-odwolany">Zdjęte ze zlecenia</span>' : '';
  const dopiski = [];
  // Przy naszym miejscu nie ma zamowienia ani kontroli zaladunku — czerwone
  // ostrzezenie o niezgodnym numerze byloby tu falszywym alarmem.
  const nasze = !!p.nasze;
  if (p.z_dnia) dopiski.push('<span style="color:var(--czerwony)">⏰ zaległe z '
    + escHtml(p.z_dnia) + '</span>');
  if (p.zaladowano_o && !nasze) {
    // Niezgodny numer to najwazniejsza informacja na tym ekranie — znaczy,
    // ze kierowca wzial spod rampy cos innego, niz mowi zamowienie.
    dopiski.push(p.zaladunek_zgodny
      ? '📄 załadunek OK · numer ' + escHtml(p.numer_kierowcy || '')
      : p.zaladunek_zwolniony
        ? '<span style="color:var(--zolty)">⚠ numer niezgodny — zwolnione przez biuro</span>'
        : '<span style="color:var(--czerwony)">⛔ WYJAZD WSTRZYMANY: kierowca wpisał '
          + escHtml(p.numer_kierowcy || '—') + ', a zamówienie ma inny numer</span>');
  }
  if (p.towar) dopiski.push('📦 ' + escHtml(p.towar));
  if (p.dokument) dopiski.push('📄 ' + escHtml(p.dokument));
  if (p.okno_od || p.okno_do) dopiski.push(`🕒 ${escHtml(p.okno_od || '…')}–${escHtml(p.okno_do || '…')}`);
  if (p.eta) dopiski.push(ETA.opis(p));
  if (p.mapa_lat == null) dopiski.push('<span style="color:var(--zolty)">⚠ brak adresu na mapie</span>');

  return `<div class="przystanek s-${p.status}" style="cursor:default">
      <span class="numer">${indeks + 1}</span>
      <span class="srodek">
        <span class="nazwa">${nasze ? '🏭 ' : ''}${escHtml(p.klient_nazwa)}</span>
        <span class="adres">${escHtml(adresJednymCiagiem(p))}</span>
        ${dopiski.length ? `<span class="dopisek">${dopiski.join(' &nbsp;·&nbsp; ')}</span>` : ''}
      </span>
      <span class="prawo">
        ${status}
        <span class="przyciski">
          <button class="maly" data-szczegoly="${p.id}">Szczegóły</button>
          ${admin && p.status === 'oczekuje' ? `
            <span class="uchwyty">
              <button data-gora="${p.id}" ${indeks === 0 ? 'disabled' : ''}>▲</button>
              <button data-dol="${p.id}" ${indeks === ile - 1 ? 'disabled' : ''}>▼</button>
            </span>
            <button class="maly" data-usun-przystanek="${p.id}">✕</button>` : ''}
        </span>
      </span>
    </div>`;
}

async function przestaw(t, przystanekId, kierunek) {
  const kolejnosc = t.przystanki.map(p => p.id);
  const i = kolejnosc.indexOf(przystanekId);
  const j = i + kierunek;
  if (j < 0 || j >= kolejnosc.length) return;
  [kolejnosc[i], kolejnosc[j]] = [kolejnosc[j], kolejnosc[i]];
  // Ekran rysuje się od nowa, więc bez tego lista skakałaby na samą górę
  // po każdym przesunięciu punktu — a przesuwa się je zwykle seriami.
  const gdzieBylem = window.scrollY;
  const w = await sprobuj(() => API.post(`/api/trasy/${t.id}/kolejnosc`, { kolejnosc }));
  if (!w) return;
  await pokazEkran('trasa', { id: t.id });
  window.scrollTo(0, gdzieBylem);
}

/* --------------------------------------------- dodawanie klientow do trasy */

/* Wspólna lista wyboru punktów: nasze miejsca na górze, klienci pod spodem.

   Jedno okno, nie dwa przyciski — biuro ma jedno miejsce, w które klika,
   a rozróżnienie widać w środku. Klucz NIESIE TYP („L3" / „K3"), bo klienci
   i lokalizacje mają niezależne numery: klient 3 i magazyn 3 istnieją naraz.
   Kolejność zaznaczania jest kolejnością dopisania punktów — doładunek ma
   trafić w środek dnia, a nie na koniec.                                    */
function listaPunktowDoWyboru({ juz, wybrane, szukaj }) {
  const pasuje = (x) => !szukaj
    || ((x.nazwa || '') + ' ' + (x.miasto || '') + ' ' + (x.ulica || ''))
       .toLowerCase().includes(szukaj);

  const wiersz = (x, klucz, nasze) => `
    <label class="plaska" style="padding:9px 4px;border-bottom:1px solid var(--ramka)">
      <input type="checkbox" value="${klucz}" ${wybrane.includes(klucz) ? 'checked' : ''}
             ${juz.has(klucz) ? 'disabled' : ''}>
      <span style="flex:1">
        <b>${nasze ? '🏭 ' : ''}${escHtml(x.nazwa)}</b>
        <span class="male slaby" style="display:block">${escHtml(adresJednymCiagiem(x)) || 'brak adresu'}
          ${nasze ? ' · nasze miejsce, nie dostawa' : ''}
          ${juz.has(klucz) ? ' · już w zleceniu' : ''}
          ${x.lat == null ? ' · <span style="color:var(--zolty)">brak punktu na mapie</span>' : ''}</span>
      </span>
    </label>`;

  const nasze = (stan.lokalizacje || []).filter(l => l.aktywna).filter(pasuje);
  const klienci = (stan.klienci || []).filter(k => k.aktywny).filter(pasuje);
  const czesci = [];
  if (nasze.length) {
    czesci.push('<div class="male slaby" style="margin:6px 0 2px"><b>NASZE MIEJSCA</b></div>'
      + nasze.map(l => wiersz(l, 'L' + l.id, true)).join(''));
  }
  if (klienci.length) {
    czesci.push('<div class="male slaby" style="margin:12px 0 2px"><b>KLIENCI</b></div>'
      + klienci.map(k => wiersz(k, 'K' + k.id, false)).join(''));
  }
  return czesci.join('') || '<div class="pusto">Nic nie pasuje.</div>';
}

/* „L3" / „K3" -> {typ, id} dla serwera. */
function punktZKlucza(klucz) {
  return { typ: klucz[0] === 'L' ? 'lokalizacja' : 'klient', id: Number(klucz.slice(1)) };
}

function kluczPunktu(p) {
  return p.nasze ? 'L' + p.lokalizacja : 'K' + p.klient;
}

async function oknoDodawaniaKlientow(t) {
  // Pobieramy tuż przed otwarciem okna: to jedyny moment, w którym ta lista
  // naprawdę musi być aktualna.
  await odswiezLokalizacje();
  const juz = new Set(t.przystanki.map(kluczPunktu));
  const wybrane = [];          // tablica, nie zbiór — trzymamy kolejność

  okno({
    tytul: 'Dodaj punkty do zlecenia',
    szerokie: true,
    tresc: `<input id="dk-szukaj" placeholder="Szukaj po nazwie, mieście, ulicy…" autocomplete="off">
            <div id="dk-lista" style="margin-top:12px">${
              listaPunktowDoWyboru({ juz, wybrane, szukaj: '' })}</div>
            <label style="margin-top:10px">Wstaw
              <select id="dk-gdzie">
                <option value="">na końcu zlecenia</option>
                ${t.przystanki.filter(x => x.status !== 'odwolany').map((x, i) =>
                  `<option value="${x.id}">zaraz po: ${i + 1}. ${
                    escHtml(x.klient_nazwa)}</option>`).join('')}
              </select></label>
            <p class="male slaby">Punkty dopiszą się w takiej kolejności, w jakiej je
              zaznaczysz. Pilną dostawę możesz wstawić w środek dnia — wybierz,
              po którym punkcie ma stanąć.</p>`,
    przyciski: [
      { napis: 'Anuluj', klik: z => z() },
      { napis: 'Dodaj zaznaczone', klasa: 'glowny', klik: async z => {
        if (!wybrane.length) { komunikat('Nic nie jest zaznaczone', 'blad'); return; }
        z();
        const po = (document.getElementById('dk-gdzie') || {}).value || '';
        const w = await sprobuj(() => API.post(`/api/trasy/${t.id}/przystanki`,
          po ? { punkty: wybrane.map(punktZKlucza), po: Number(po) }
             : { punkty: wybrane.map(punktZKlucza) }),
          `Dodano ${wybrane.length} punktów`);
        if (w) pokazEkran('trasa', { id: t.id });
      } },
    ],
    poOtwarciu: pole => {
      const przypnij = () => pole.querySelectorAll('#dk-lista input').forEach(w => {
        w.onchange = () => {
          const klucz = w.value;
          if (w.checked) { if (!wybrane.includes(klucz)) wybrane.push(klucz); }
          else wybrane.splice(wybrane.indexOf(klucz), 1);
        };
      });
      przypnij();
      pole.querySelector('#dk-szukaj').oninput = e => {
        pole.querySelector('#dk-lista').innerHTML = listaPunktowDoWyboru(
          { juz, wybrane, szukaj: e.target.value.trim().toLowerCase() });
        przypnij();
      };
    },
  });
}

/* ------------------------------------------------- propozycja kolejnosci */

async function zaproponujKolejnosc(t) {
  const w = await sprobuj(() => API.post(`/api/trasy/${t.id}/optymalizuj`));
  if (!w) return;
  const wgId = Object.fromEntries(t.przystanki.map(p => [p.id, p]));
  const zmiana = w.kolejnosc.some((id, i) => t.przystanki[i] && t.przystanki[i].id !== id);

  okno({
    tytul: 'Propozycja kolejności',
    tresc: `
      <p class="male slaby">Policzone na podstawie: ${escHtml(w.podstawa)}${
        // Brak bazy w rachunku bywa ŚWIADOMYM wyborem układu, a nie brakiem
        // ustawienia — dawny tekst sugerował błąd konfiguracji.
        w.z_bazy && w.z_powrotem ? ', ze startem i powrotem do bazy'
        : w.z_bazy ? ', ze startem w bazie, bez powrotu'
        : w.z_powrotem ? ', bez startu w bazie, z powrotem do bazy'
        : ', bez bazy — same punkty'}.</p>
      ${w.km != null ? `<div class="wstega info">Szacunkowo <b>${w.km} km</b>${
        w.minuty != null ? `, około <b>${w.minuty} min</b> jazdy` : ''}${
        w.z_powrotem ? ' — razem z powrotem do bazy' : ''}.</div>` : ''}
      ${!zmiana ? '<div class="wstega info">Twoja obecna kolejność jest już taka sama.</div>' : ''}
      <ol style="padding-left:22px;line-height:2">
        ${w.kolejnosc.map(id => `<li><b>${escHtml(wgId[id] ? wgId[id].klient_nazwa : '?')}</b>
          <span class="male slaby">${escHtml(wgId[id] ? adresJednymCiagiem(wgId[id]) : '')}</span></li>`).join('')}
      </ol>
      ${w.bez_mapy.length ? `<div class="wstega uwaga">Na końcu doklejam punkty bez adresu na mapie:
        ${w.bez_mapy.map(b => escHtml(b.nazwa)).join(', ')}.</div>` : ''}
      <p class="male slaby">To tylko propozycja — możesz ją odrzucić albo poprawić strzałkami po zastosowaniu.</p>`,
    przyciski: [
      { napis: 'Zostaw po mojemu', klik: z => z() },
      { napis: 'Zastosuj kolejność', klasa: 'glowny', klik: async z => {
        z();
        const zamkniete = t.przystanki.filter(p => p.status !== 'oczekuje').map(p => p.id);
        const pelna = zamkniete.concat(w.kolejnosc.filter(id => !zamkniete.includes(id)));
        const ok = await sprobuj(() => API.post(`/api/trasy/${t.id}/kolejnosc`, { kolejnosc: pelna }),
          'Kolejność ustawiona');
        if (ok) pokazEkran('trasa', { id: t.id });
      } },
    ],
  });
}

function oknoKopiowania(t) {
  okno({
    tytul: 'Kopiuj zlecenie na inny dzień',
    tresc: `<p class="male slaby">Powstanie nowa trasa z tą samą listą klientów i kolejnością.
              Potwierdzenia dostaw nie są kopiowane.</p>
            <label>Nowy dzień<input type="date" id="kp-data" value="${przesunDate(t.data, 1)}"></label>`,
    przyciski: [
      { napis: 'Anuluj', klik: z => z() },
      { napis: 'Kopiuj', klasa: 'glowny', klik: async z => {
        const nowa = await sprobuj(() => API.post(`/api/trasy/${t.id}/kopiuj`,
          { data: document.getElementById('kp-data').value }), 'Skopiowano');
        if (nowa) { z(); pokazEkran('trasa', { id: nowa.id }); }
      } },
    ],
  });
}

/* -------------------------------------------- szczegoly punktu w biurze */

/* ---------------------------------------- panel zamówienia (postęp pracy) */

/* Jedno zdanie o tym, co się z tym zamówieniem właśnie dzieje. Biuro odbiera
   telefon „gdzie mój towar" i ma odpowiedzieć od razu, a nie składać obraz
   z pięciu miejsc na ekranie. */
function stanPunktu(t, p) {
  const godz = x => String(x || '').slice(11, 16);
  if (p.status === 'dostarczone') {
    return '✓ Dostarczone' + (p.zamkniete_o ? ' o ' + godz(p.zamkniete_o) : '');
  }
  if (p.status === 'nieudane') return '✕ Nieudane — ' + (p.powod || 'bez podanego powodu');
  if (p.status === 'odwolany') return 'Zdjęte ze zlecenia';
  if (t.status === 'zakonczona') return '⚠ Zlecenie zamknięte, a ten punkt został otwarty';
  if (t.status === 'w_toku') {
    return p.eta ? ('🚚 Kierowca w trasie — u klienta ok. ' + p.eta) : '🚚 Kierowca w trasie';
  }
  if (p.zaladowano_o) return '📦 Załadowane, czeka na wyjazd';
  return '🕒 Zaplanowane' + (t.data ? ' na ' + t.data : '');
}

function naglowekPunktu(t, p) {
  const nr = t.przystanki.indexOf(p) + 1;
  const l = t.licznik || {};
  const wszystkie = l.wszystkie || 0;
  // Licznik trasy nie ma pola "zamkniete" — sklada sie z dostarczonych
  // i nieudanych. Jedno i drugie to punkt, ktorego kierowca juz nie ma na glowie.
  const zrobione = (l.dostarczone || 0) + (l.nieudane || 0);
  const proc = wszystkie ? Math.round(zrobione / wszystkie * 100) : 0;
  return `<div class="karta scisla" style="margin:0 0 14px">
    <div class="male slaby">Punkt ${nr} z ${t.przystanki.length}${
      t.kierowca_imie ? ' · ' + escHtml(t.kierowca_imie) : ''}${
      t.pojazd_nazwa ? ' · ' + escHtml(t.pojazd_nazwa) : ''}${
      t.data ? ' · ' + escHtml(t.data) : ''}</div>
    <div style="font-weight:700;margin:5px 0 2px">${escHtml(stanPunktu(t, p))}</div>
    ${wszystkie ? `<div class="postep"><i class="ok" style="width:${proc}%"></i></div>
      <div class="male slaby">Cała trasa: ${zrobione} z ${wszystkie} zamkniętych${
        l.nieudane ? ` (w tym ${l.nieudane} ${odmiana(l.nieudane, 'nieudana', 'nieudane', 'nieudanych')})` : ''}</div>` : ''}
  </div>`;
}

/* Oś czasu zdarzeń. Wiersz powstaje TYLKO wtedy, gdy dane naprawdę są —
   lista pustych myślników niczego nie mówi, a zajmuje pół ekranu. */
function osCzasuPunktu(t, p, d) {
  const kiedy = x => String(x || '').slice(0, 16).replace('T', ' ');
  const godz = x => String(x || '').slice(11, 16);
  const zdarzenia = [];
  const zrodlo = d || {};

  if (zrodlo.utworzono || p.utworzono) {
    zdarzenia.push({ klasa: '', tekst: 'Wstawione do zlecenia przez biuro',
      czas: kiedy(zrodlo.utworzono || p.utworzono) });
  }
  if (p.z_dnia) {
    zdarzenia.push({ klasa: 'nie', tekst: 'Nadrobienie zaległości z ' + escHtml(p.z_dnia), czas: '' });
  }
  if (p.zaladowano_o) {
    zdarzenia.push({
      klasa: p.zaladunek_zgodny ? 'ok' : 'nie',
      tekst: p.zaladunek_zgodny
        ? 'Załadunek potwierdzony, numer zgodny'
        : '⚠ Załadunek potwierdzony, ale numer NIE zgadzał się z zamówieniem',
      czas: kiedy(p.zaladowano_o),
    });
    if (p.zaladunek_prob > 1) {
      zdarzenia.push({ klasa: 'nie',
        tekst: `Kierowca wpisywał numer ${p.zaladunek_prob} razy`, czas: '' });
    }
  }
  if (t.start_o) {
    zdarzenia.push({ klasa: '', tekst: 'Kierowca rozpoczął zlecenie', czas: kiedy(t.start_o) });
  }
  (zrodlo.zalaczniki || []).forEach(z => {
    if (z.typ === 'zaladunek') return;      // pokazane wyżej razem z załadunkiem
    zdarzenia.push({ klasa: '', czas: kiedy(z.utworzono),
      tekst: z.typ === 'podpis' ? 'Podpis odbierającego' : 'Zdjęcie z dostawy' });
  });
  if (p.zamkniete_o) {
    zdarzenia.push({
      klasa: p.status === 'dostarczone' ? 'ok' : 'nie',
      tekst: p.status === 'dostarczone'
        ? 'Dostarczone' + (p.odebral ? ' — odebrał: ' + escHtml(p.odebral) : '')
        : 'Nieudane — ' + escHtml(p.powod || 'bez podanego powodu'),
      czas: kiedy(p.zamkniete_o),
    });
  }
  if (!zdarzenia.length) return '';
  return `<div class="male slaby" style="margin:0 0 4px">Przebieg</div>
    <ol class="os-czasu">${zdarzenia.map(z => `<li class="${z.klasa}">
      ${z.tekst}${z.czas ? ` <span class="slaby">· ${escHtml(z.czas)}</span>` : ''}</li>`).join('')}
    </ol>`;
}

/* Gdzie jest bus. Doładowywane po otwarciu okna, bo wymaga zapytania do
   serwera — samo okno musi otworzyć się natychmiast i także bez zasięgu. */
function panelPostepu(t, p, d) {
  if (!d) return '';
  const godz = x => String(x || '').slice(11, 16);
  const wiersze = [];
  const poz = d.ostatnia_pozycja;
  if (poz) {
    wiersze.push(`🛰 Ostatnia pozycja busa: ${escHtml(godz(poz.czas))}${
      poz.km_do_punktu != null ? ` · ok. ${poz.km_do_punktu} km od tego punktu` : ''}${
      poz.zrodlo === 'lokalizator' ? ' (lokalizator)' : ''}`);
  }
  if (d.ostatni_zapis) {
    wiersze.push(`📲 Ostatni zapis z telefonu: ${escHtml(String(d.ostatni_zapis).slice(0, 16))}`);
  }
  if (d.gdzie_potwierdzil) {
    wiersze.push('📍 Potwierdzenie zapisane z lokalizacji kierowcy');
  }
  if (!wiersze.length && !poz) {
    wiersze.push('<span class="slaby">Telefon kierowcy jeszcze się dziś nie odezwał.</span>');
  }
  return `<div class="karta scisla" style="margin:0 0 14px">
    ${wiersze.map(w => `<div class="male">${w}</div>`).join('')}
  </div>`;
}

function oknoSzczegolowPunktu(t, id) {
  const p = t.przystanki.find(x => x.id === id);
  if (!p) return;
  const admin = jestBiuro();
  const zamkniety = p.status !== 'oczekuje';

  okno({
    tytul: (p.nasze ? '🏭 ' : '') + p.klient_nazwa,
    tresc: `
      ${naglowekPunktu(t, p)}
      <div class="karta scisla" style="margin:0 0 14px">
        <div>${escHtml(adresJednymCiagiem(p)) || '<i>brak adresu</i>'}</div>
        ${p.telefon ? `<div class="male">📞 ${escHtml(p.telefon)}</div>` : ''}
        ${p.osoba ? `<div class="male slaby">👤 ${escHtml(p.osoba)}</div>` : ''}
      </div>
      ${zamkniety ? `<div class="wstega ${p.status === 'dostarczone' ? 'info' : 'uwaga'}">
          ${p.status === 'dostarczone' ? '✓ Dostarczone' : '✕ Nieudane — ' + escHtml(p.powod)}
          ${p.zamkniete_o ? ' · ' + escHtml(p.zamkniete_o) : ''}
          ${p.odebral ? '<br>Odebrał: <b>' + escHtml(p.odebral) + '</b>' : ''}
          ${p.notatka ? '<br>' + escHtml(p.notatka) : ''}
          ${p.ile_zalacznikow ? `<br><span class="male">📎 ${p.ile_zalacznikow}
            ${odmiana(p.ile_zalacznikow, 'załącznik', 'załączniki', 'załączników')}</span>` : ''}
        </div>` : ''}
      <div id="sp-os">${osCzasuPunktu(t, p, null)}</div>
      <div id="sp-postep"></div>
      <div class="przyciski" style="margin:0 0 14px">
        ${p.ile_zalacznikow ? `<button class="maly glowny" id="sp-dowod">📎 ${
          p.nasze ? 'Zdjęcia z tego postoju' : 'Zobacz dowód dostawy'}</button>` : ''}
        ${zamkniety && !p.nasze ? '<button class="maly" id="sp-druk">🖨 Wydrukuj potwierdzenie</button>' : ''}
        ${p.nasze ? '' : '<button class="maly" id="sp-historia">Historia tego klienta</button>'}
        ${admin && !zamkniety && !p.nasze ? '<button class="maly" id="sp-powiadom">✉️ Powiadom klienta</button>' : ''}
        ${admin && !zamkniety ? '<button class="maly" id="sp-przenies">➡ Przenieś do innego zlecenia</button>' : ''}
        ${admin && !p.nasze && p.zaladowano_o && !p.zaladunek_zgodny && !p.zaladunek_zwolniony
          ? '<button class="maly czerwony" id="sp-zwolnij">⛔ Zwolnij mimo niezgodnego numeru</button>'
          : ''}
      </div>
      ${admin && !zamkniety ? `
        <label>Towar / zawartość
          <input id="sp-towar" value="${escHtml(p.towar || '')}" placeholder="np. 2 palety płyty">
        </label>
        ${p.nasze ? `<p class="male slaby">To nasze miejsce — doładunek albo odbiór,
          nie dostawa do klienta. Numeru zamówienia się tu nie podaje, a kierowca
          nie musi potwierdzać przy nim załadunku.</p>`
          : `<label>Numer dokumentu (WZ, zamówienie)
          <input id="sp-dokument" value="${escHtml(p.dokument || '')}">
        </label>`}
        <div class="dwie">
          <label>Okno czasowe od<input type="time" id="sp-od" value="${escHtml(p.okno_od || '')}"></label>
          <label>Okno czasowe do<input type="time" id="sp-do" value="${escHtml(p.okno_do || '')}"></label>
        </div>
        <label>Uwagi dla kierowcy
          <textarea id="sp-uwagi" placeholder="np. wjazd od podwórza, zadzwonić 15 min wcześniej">${escHtml(p.uwagi || '')}</textarea>
        </label>` : `
        ${p.towar ? `<p><b>Towar:</b> ${escHtml(p.towar)}</p>` : ''}
        ${p.uwagi ? `<p><b>Uwagi:</b> ${escHtml(p.uwagi)}</p>` : ''}`}`,
    przyciski: (admin && !zamkniety) ? [
      { napis: 'Zamknij', klik: z => z() },
      { napis: 'Zapisz', klasa: 'glowny', klik: async z => {
        const w = await sprobuj(() => API.post('/api/przystanki/' + p.id, {
          towar: document.getElementById('sp-towar').value,
          dokument: (document.getElementById('sp-dokument') || {}).value || '',
          okno_od: document.getElementById('sp-od').value,
          okno_do: document.getElementById('sp-do').value,
          uwagi: document.getElementById('sp-uwagi').value,
        }), 'Zapisano');
        if (w) { z(); pokazEkran('trasa', { id: t.id }); }
      } },
    ] : [{ napis: 'Zamknij', klik: z => z() }],
    poOtwarciu: pole => {
      const podepnij = (id, akcja) => {
        const przycisk = pole.querySelector(id);
        if (przycisk) przycisk.onclick = akcja;
      };
      podepnij('#sp-dowod', () => oknoZalacznikow(p.id, p.klient_nazwa));
      podepnij('#sp-druk', () => wydrukPotwierdzenia(p.id));
      podepnij('#sp-historia', () => oknoHistoriiKlienta(p.klient, p.klient_nazwa));
      podepnij('#sp-powiadom', () => oknoPowiadomienia(p));
      podepnij('#sp-przenies', () => oknoPrzeniesienia(t, p));
      podepnij('#sp-zwolnij', async () => {
        if (!await potwierdz('Zwolnić ten punkt?',
          `Kierowca wpisał numer „${p.numer_kierowcy || '—'}", a zamówienie ma `
          + `„${p.dokument || '—'}". Zwolnienie puszcza bus w trasę i zostaje `
          + 'zapisane w uwagach punktu z Twoim imieniem.')) return;
        const w = await sprobuj(() => API.post('/api/przystanki/' + p.id + '/zwolnij-zaladunek'),
          'Zwolnione — kierowca może jechać');
        if (w) { zamknijOkno(); pokazEkran('trasa', { id: t.id }); }
      });

      // Doładowanie postępu. Okno MUSI otworzyć się bez tego: kierowca wchodzi
      // w nie z „Historii tras" na telefonie, często bez zasięgu.
      if (!jestBiuro() || !navigator.onLine) return;
      API.get('/api/przystanki/' + p.id + '/postep').then(dodatki => {
        const cel = pole.querySelector('#sp-postep');
        const os = pole.querySelector('#sp-os');
        if (cel) cel.innerHTML = panelPostepu(t, p, dodatki);
        if (os) os.innerHTML = osCzasuPunktu(t, p, dodatki);
      }).catch(() => { /* brak postepu nie moze zepsuc calego okna */ });
    },
  });
}

/* Cztery układy zlecenia. Nazwa mówi, gdzie start i gdzie koniec — te same
   klucze co UKLADY w trasex.py. */
const UKLADY_ZLECENIA = [
  ['baza_baza', 'Z bazy i z powrotem do bazy'],
  ['baza_punkt', 'Z bazy, koniec u ostatniego klienta'],
  ['punkt_baza', 'Start u pierwszego klienta, powrót do bazy'],
  ['punkt_punkt', 'Bez bazy — tylko punkty'],
];

function opcjeUkladu(wybrany) {
  const teraz = wybrany || 'baza_baza';
  return UKLADY_ZLECENIA.map(([klucz, napis]) =>
    `<option value="${klucz}"${klucz === teraz ? ' selected' : ''}>${napis}</option>`).join('');
}

function ukladStart(uklad) { return (uklad || 'baza_baza').startsWith('baza_'); }
function ukladPowrot(uklad) { return (uklad || 'baza_baza').endsWith('_baza'); }

/* ============================================================== NA ŻYWO */

/* Tablica dla biura: co się dzieje w tej chwili z każdą trasą.
   Odpowiada na pytanie, które biuro zadaje dziesięć razy dziennie: „gdzie jest
   Piotr i o której będzie u Nowaka". Wszystko liczy serwer — tutaj tylko
   rysujemy i odświeżamy. */
let zegarTablicy = null;

function kartaNaZywo(t) {
  const l = t.licznik || {};
  const zrobione = (l.dostarczone || 0) + (l.nieudane || 0);
  const proc = l.wszystkie ? Math.round(zrobione / l.wszystkie * 100) : 0;
  const b = t.biezacy;
  const kolor = { pilne: 'var(--czerwony)', uwaga: 'var(--zolty)', info: 'var(--tekst-slaby)' };

  const dokad = b ? `
    <div style="margin:10px 0 2px"><b>${b.nasze ? '🏭 jedzie po towar do:' : '🚚 jedzie do:'}
      ${escHtml(b.klient)}</b>${b.miasto ? ' <span class="slaby">· ' + escHtml(b.miasto) + '</span>' : ''}</div>
    <div class="male slaby">punkt ${b.kolejnosc} z ${l.wszystkie || '?'}${
      b.dokument ? ' · 📄 ' + escHtml(b.dokument) : ''}${
      b.towar ? ' · 📦 ' + escHtml(b.towar) : ''}</div>
    <div style="margin-top:6px">${b.eta
      ? `<b style="font-size:17px;${b.minelo ? 'color:var(--czerwony)' : ''}">🕒 ${
          escHtml(b.eta)}</b>` + (b.minelo
            ? `<span style="color:var(--czerwony)"> — minęło ${godzinyMinuty(b.minelo)}
               bez potwierdzenia</span>` : '') + (
          b.spoznienie
            ? `<span style="color:var(--czerwony)"> — po oknie (zamykają ${escHtml(b.okno_do)})</span>`
            : b.okno_do
              ? `<span class="slaby"> · okno ${escHtml(b.okno_od || '…')}–${escHtml(b.okno_do)} ✓</span>`
              : '')
        + (b.przerwa_przed ? `<span class="slaby"> · po drodze przerwa ${b.przerwa_przed} min</span>` : '')
      : '<span class="slaby">godziny nie policzę — punkt nie ma adresu na mapie</span>'}</div>`
    : `<div style="margin:10px 0"><b>${t.status === 'zakonczona'
        ? '✓ Zlecenie zakończone' : 'Brak punktów do zrobienia'}</b></div>`;

  const slady = [];
  if (t.ostatni) {
    slady.push(`${t.ostatni.status === 'dostarczone' ? '✓' : '✕'} ostatnio:
      ${escHtml(t.ostatni.klient)}, ${escHtml(t.ostatni.o)}${
      t.ostatni.powod ? ' (' + escHtml(t.ostatni.powod) + ')' : ''}`);
  }
  if (t.pozycja) {
    slady.push(`🛰 bus ${escHtml(String(t.pozycja.czas).slice(11, 16))}${
      t.pozycja.km_do_celu != null ? ` · ok. ${t.pozycja.km_do_celu} km od celu` : ''}`);
  }
  // Kontakt sprzed dzisiaj z datą — sama godzina „14:05” z wczoraj wyglądała
  // jak telefon, który odezwał się przed chwilą.
  const kontakt = String(t.ostatni_kontakt || '');
  slady.push(t.ostatni_kontakt
    ? `📲 telefon ${kontakt.slice(0, 10) === dzisiaj() ? '' : escHtml(polskaData(kontakt)) + ' '}${
      escHtml(kontakt.slice(11, 16))}`
    : '<span class="slaby">📲 telefon jeszcze się dziś nie odezwał</span>');

  return `<div class="karta scisla">
    <div class="karta-gora">
      <div>
        <h2 style="margin:0">${escHtml(t.kierowca || 'bez kierowcy')}</h2>
        <div class="male slaby">${escHtml(t.pojazd || 'bez busa')}${
          t.rejestracja ? ' · ' + escHtml(t.rejestracja) : ''}${
          t.start_o ? ' · start ' + escHtml(t.start_o) : ' · wyjazd ' + escHtml(t.wyjazd || '')}</div>
      </div>
      <span class="plakietka p-${t.status}">${escHtml(t.status.replace('_', ' '))}</span>
    </div>
    <div class="male"><b>${zrobione}</b> z <b>${l.wszystkie || 0}</b>
      ${odmiana(l.wszystkie || 0, 'punktu', 'punktów', 'punktów')}${
      l.nieudane ? ` · <span style="color:var(--czerwony)">${l.nieudane} nieudane</span>` : ''}</div>
    <div class="postep"><i class="ok" style="width:${proc}%"></i></div>
    ${dokad}
    <div class="male slaby" style="margin-top:8px">${slady.join(' &nbsp;·&nbsp; ')}</div>
    ${(t.alerty || []).map(a => `<div class="male" style="margin-top:6px;color:${
      kolor[a.waga] || 'inherit'}"><b>${a.waga === 'pilne' ? '⛔' : a.waga === 'uwaga' ? '⚠' : 'ℹ'}</b>
      ${escHtml(a.tekst)}</div>`).join('')}
    <div class="przyciski" style="margin-top:10px">
      <button class="maly" data-trasa-zywo="${t.id}">Otwórz zlecenie</button>
      ${b ? `<button class="maly" data-punkt-zywo="${b.id}" data-trasa="${t.id}">Szczegóły punktu</button>` : ''}
    </div>
  </div>`;
}

/* Wstawiane W PULPIT, a nie na osobny ekran: zlecenia mają swoją zakładkę,
   a pulpit ma odpowiadać na pytanie „co się teraz dzieje". Odświeżamy tylko
   ten kawałek — przerysowanie całego pulpitu co pół minuty zabijałoby mapę
   i przewijanie pod palcem. */
async function rysujZywo(cel, data) {
  const dane = await API.get('/api/tablica' + (data ? '?data=' + data : ''));
  const pilne = dane.trasy.reduce((s, t) =>
    s + (t.alerty || []).filter(a => a.waga === 'pilne').length, 0);
  cel.innerHTML = `
    <h2 style="margin-top:20px">Na żywo
      <span class="male slaby" style="font-weight:400">— stan na ${escHtml(dane.teraz)},
        odświeża się co 30 s</span></h2>
    ${pilne ? `<div class="wstega uwaga"><b>${pilne}
      ${odmiana(pilne, 'sprawa wymaga', 'sprawy wymagają', 'spraw wymaga')} decyzji.</b></div>` : ''}
    ${dane.trasy.length ? dane.trasy.map(kartaNaZywo).join('')
      : `<div class="karta"><div class="pusto"><span class="duza-ikona">🗓️</span>
           Na ten dzień nie ma jeszcze żadnego zlecenia.
           <div style="margin-top:12px"><button class="glowny" id="p-planuj-2">Zaplanuj zlecenie</button></div>
         </div></div>`}`;

  cel.querySelectorAll('[data-trasa-zywo]').forEach(b =>
    b.onclick = () => pokazEkran('trasa', { id: Number(b.dataset.trasaZywo) }));
  cel.querySelectorAll('[data-punkt-zywo]').forEach(b =>
    b.onclick = async () => {
      const t = await API.get('/api/trasy/' + b.dataset.trasa);
      ETA.policz(t);
      oknoSzczegolowPunktu(t, Number(b.dataset.punktZywo));
    });
  const planuj2 = cel.querySelector('#p-planuj-2');
  if (planuj2) planuj2.onclick = () => pokazEkran('trasy', { data: dane.data });
}

function odswiezajZywo(data) {
  clearInterval(zegarTablicy);
  zegarTablicy = setInterval(async () => {
    // Sam się wyłącza, gdy biuro zejdzie z pulpitu. Przy otwartym oknie
    // nie przerysowujemy — inaczej znikałoby komuś sprzed nosa.
    if (stan.ekran !== 'pulpit') { clearInterval(zegarTablicy); zegarTablicy = null; return; }
    const okno = document.getElementById('okno-tlo');
    if (okno && !okno.classList.contains('ukryty')) return;
    if (!navigator.onLine) return;
    const cel = document.getElementById('p-zywo');
    if (!cel) { clearInterval(zegarTablicy); zegarTablicy = null; return; }
    try { await rysujZywo(cel, data); } catch (e) { /* następna próba za 30 s */ }
  }, 30000);
}

/* =============================================================== KLIENCI */

EKRANY.klienci = {
  tytul: 'Klienci',
  async rysuj(pole, param) {
    const admin = jestBiuro();
    // Domyślnie POKAZUJEMY TYLKO CZYNNYCH. Wpisy przeniesione do naszych
    // lokalizacji zostają w bazie (trzyma je historia dostaw), ale w kartotece
    // wyglądały jak duplikaty — dwa razy ta sama nazwa, jedna wyszarzona.
    const zUkrytymi = !!param.ukryci;
    if (navigator.onLine) {
      try {
        stan.klienci = await API.get('/api/klienci' + (zUkrytymi ? '?wszyscy=1' : ''));
        stan.ukryciKlienci = await API.get('/api/klienci/ukryci').catch(() => null);
      } catch (e) { /* zostaje kopia */ }
    }
    const szukaj = (param.szukaj || '').toLowerCase();

    const rysujListe = (fraza) => {
      const wynik = stan.klienci.filter(k =>
        !fraza || (k.nazwa + ' ' + k.miasto + ' ' + k.ulica + ' ' + (k.telefon || ''))
          .toLowerCase().includes(fraza));
      if (!wynik.length) return '<div class="pusto">Nic nie pasuje do wyszukiwania.</div>';
      return wynik.map(k => `<button class="przystanek s-oczekuje" data-klient="${k.id}"
          style="${k.aktywny ? '' : 'opacity:.55'}">
          <span class="numer">${escHtml(k.nazwa[0] || '?')}</span>
          <span class="srodek">
            <span class="nazwa">${escHtml(k.nazwa)}${k.aktywny ? ''
              : (k.przeniesiony_do
                 ? ' <span class="male slaby">— przeniesiony do naszych lokalizacji</span>'
                 : ' <span class="male slaby">(ukryty)</span>')}</span>
            <span class="adres">${escHtml(adresJednymCiagiem(k)) || 'brak adresu'}</span>
            ${k.telefon || k.osoba ? `<span class="dopisek">${escHtml([k.osoba, k.telefon].filter(Boolean).join(' · '))}</span>` : ''}
          </span>
          <span class="prawo">${k.lat == null
            ? '<span class="plakietka p-nieudane">brak na mapie</span>'
            : '<span class="plakietka p-dostarczone">na mapie</span>'}</span>
        </button>`).join('');
    };

    pole.innerHTML = `
      <div class="pasek-narzedzi">
        <label style="flex:1">Szukaj<input id="k-szukaj" value="${escHtml(param.szukaj || '')}"
          placeholder="nazwa, miasto, ulica, telefon" autocomplete="off"></label>
        ${admin ? `<button class="glowny" id="k-nowy">+ Nowy klient</button>
                   <button id="k-plik">📄 Wczytaj z pliku</button>` : ''}
      </div>
      <div class="male slaby" style="margin-bottom:10px">
        ${stan.klienci.filter(k => k.aktywny).length} klientów w kartotece
        ${(stan.ukryciKlienci && stan.ukryciKlienci.ukryci) ? `·
          <a href="#" id="k-przelacz-ukrytych">${zUkrytymi ? 'ukryj schowane'
            : `pokaż schowane (${stan.ukryciKlienci.ukryci})`}</a>
          ${stan.ukryciKlienci.przeniesieni
            ? `<span class="slaby">— w tym ${stan.ukryciKlienci.przeniesieni}
               ${odmiana(stan.ukryciKlienci.przeniesieni, 'przeniesiony', 'przeniesione',
                         'przeniesionych')} do naszych lokalizacji</span>` : ''}` : ''}
      </div>
      <div id="k-lista">${rysujListe(szukaj)}</div>`;

    const przypnij = () => pole.querySelectorAll('[data-klient]').forEach(b =>
      b.onclick = () => oknoKlienta(stan.klienci.find(k => k.id === Number(b.dataset.klient))));
    przypnij();
    const przelacz = pole.querySelector('#k-przelacz-ukrytych');
    if (przelacz) przelacz.onclick = e => {
      e.preventDefault();
      pokazEkran('klienci', { szukaj: param.szukaj, ukryci: !zUkrytymi });
    };
    pole.querySelector('#k-szukaj').oninput = e => {
      pole.querySelector('#k-lista').innerHTML = rysujListe(e.target.value.trim().toLowerCase());
      przypnij();
    };
    if (admin) {
      pole.querySelector('#k-nowy').onclick = () => oknoKlienta(null);
      pole.querySelector('#k-plik').onclick = oknoImportuPliku;
    }
  },
};

/* Wczytanie kartoteki wprost z pliku CSV albo Excela.

   Wklejanie przez schowek zostaje, bo bywa najszybsze przy trzech wierszach,
   ale kartoteki nikt nie wkleja recznie. Program pokazuje najpierw, JAK
   zrozumial plik — ktora kolumna jest czym i ile wierszy juz zna — bo import
   robiony w ciemno konczy sie kartoteka do recznego sprzatania.            */
function oknoImportuPliku() {
  let plikBase64 = '', nazwaPliku = '', podglad = null;

  const rysujTresc = () => {
    if (!podglad) {
      return `<label>Plik z klientami
          <input type="file" id="ip-plik" accept=".csv,.txt,.xlsx,.xlsm"></label>
        <p class="male slaby">Przyjmuję CSV (średnik, przecinek albo tabulator)
          oraz Excel .xlsx. Polskie znaki z Excela też — nie musisz nic przestawiać.</p>
        <p class="male slaby">Program radzi sobie sam z plikiem <b>bez nagłówka</b>,
          z nagłówkiem <b>w dalszym wierszu</b> (pod tytułem arkusza), z <b>adresem
          sklejonym</b> w jednej kolumnie oraz z kartoteką na <b>innej zakładce</b>
          Excela. Telefon, e-mail, kod pocztowy i NIP rozpoznaje po samej zawartości.
          Zanim cokolwiek zapisze, pokaże, co zrozumiał.</p>`;
    }
    const opcje = (wybrane) => podglad.naglowek.map((h, i) =>
      `<option value="${i}" ${wybrane === i ? 'selected' : ''}>${escHtml(
        (podglad.ma_naglowek ? h : 'kolumna ' + (i + 1)) || 'kolumna ' + (i + 1))}</option>`).join('');
    return `
      <div class="wstega ${podglad.wierszy ? 'info' : 'uwaga'}">
        Widzę <b>${podglad.wierszy}</b> ${odmiana(podglad.wierszy, 'wiersz', 'wiersze', 'wierszy')}
        ${podglad.duplikatow ? `· <b>${podglad.duplikatow}</b> już
          ${odmiana(podglad.duplikatow, 'jest', 'są', 'jest')} w kartotece` : '· bez powtórek'}
        ${podglad.pustych ? `· ${podglad.pustych} pustych pominę` : ''}
        <div class="male" style="font-weight:400; margin-top:6px">
          ${podglad.ma_naglowek
            ? `Nagłówek znalazłem w wierszu ${podglad.wiersz_naglowka + 1}.`
            : 'Nagłówka nie ma — kolumny rozpoznałem po tym, co w nich jest.'}
          ${podglad.rozbijac_adres
            ? ' Adres jest sklejony w jednej kolumnie — rozbijam go na ulicę, kod i miasto.'
            : ''}
        </div>
      </div>
      <p class="male slaby">Sprawdź, czy program dobrze zrozumiał kolumny
        <span class="slaby">(💡 = rozpoznane po zawartości, bez nagłówka)</span>:</p>
      <div class="dwie">
        ${podglad.pola.map(pole => `
          <label>${escHtml(NAZWY_POL_KLIENTA[pole] || pole)}${
            (podglad.zrodlo || {})[pole] === 'zawartość' ? ' 💡' : ''}
            <select data-mapuj="${pole}">
              <option value="-1">— nie ma —</option>
              ${opcje(podglad.mapowanie[pole])}
            </select></label>`).join('')}
      </div>
      <p class="male slaby" style="margin-top:12px">Pierwsze wiersze z pliku:</p>
      <div class="tabela-przewijana"><table><thead><tr>
        <th>Nazwa</th><th>Adres</th><th>Miasto</th><th>Telefon</th></tr></thead><tbody>
        ${podglad.podglad.map(w => `<tr style="${w.duplikat ? 'opacity:.5' : ''}">
          <td>${escHtml(w.nazwa)}${w.duplikat ? ' <span class="male slaby">(już jest)</span>' : ''}</td>
          <td>${escHtml(w.ulica)}</td><td>${escHtml(w.miasto)}</td><td>${escHtml(w.telefon)}</td>
        </tr>`).join('')}
      </tbody></table></div>
      <label class="plaska" style="margin-top:10px">
        <input type="checkbox" id="ip-pomijaj" checked> Pomiń klientów, którzy już są w kartotece</label>`;
  };

  const otworz = () => okno({
    tytul: 'Wczytaj klientów z pliku',
    szerokie: true,
    tresc: rysujTresc(),
    poOtwarciu: () => {
      const wejscie = document.getElementById('ip-plik');
      if (!wejscie) return;
      wejscie.onchange = async () => {
        const plik = wejscie.files[0];
        if (!plik) return;
        nazwaPliku = plik.name;
        plikBase64 = await new Promise((zwroc, odrzuc) => {
          const czytnik = new FileReader();
          czytnik.onload = () => zwroc(czytnik.result);
          czytnik.onerror = () => odrzuc(new Error('Nie udało się odczytać pliku'));
          czytnik.readAsDataURL(plik);
        });
        const w = await sprobuj(() => API.post('/api/klienci/plik-podglad',
          { plik: plikBase64, nazwa: nazwaPliku }));
        if (!w) return;
        podglad = w;
        zamknijOkno();
        otworz();
      };
    },
    przyciski: podglad ? [
      { napis: 'Inny plik', klik: () => { podglad = null; zamknijOkno(); otworz(); } },
      { napis: `Wczytaj ${podglad.wierszy}`, klasa: 'glowny', klik: async z => {
        const mapowanie = {};
        document.querySelectorAll('[data-mapuj]').forEach(s => {
          mapowanie[s.dataset.mapuj] = Number(s.value);
        });
        if (mapowanie.nazwa < 0) return komunikat('Wskaż kolumnę z nazwą klienta', 'blad');
        const w = await sprobuj(() => API.post('/api/klienci/plik-wykonaj', {
          plik: plikBase64, nazwa: nazwaPliku, ma_naglowek: podglad.ma_naglowek,
          rozbijac_adres: podglad.rozbijac_adres, mapowanie,
          pomijaj_duble: document.getElementById('ip-pomijaj').checked,
        }));
        if (!w) return;
        z();
        komunikat(`Dodano ${w.dodane}${w.pominiete ? `, pominięto ${w.pominiete}` : ''}`, 'ok');
        if (w.geokodowanych) {
          komunikat(`Adresy ${w.geokodowanych} klientów program znajduje w tle — `
            + 'to potrwa około minuty.', 'ok');
        }
        stan.klienci = [];      // wymus ponowne pobranie kartoteki
        pokazEkran('klienci');
      } },
    ] : [{ napis: 'Anuluj', klik: z => z() }],
  });
  otworz();
}

const NAZWY_POL_KLIENTA = {
  nazwa: 'Nazwa klienta', ulica: 'Ulica i numer', kod: 'Kod pocztowy', miasto: 'Miasto',
  osoba: 'Osoba kontaktowa', telefon: 'Telefon', email: 'E-mail', nip: 'NIP',
  godziny: 'Godziny przyjęć', uwagi: 'Uwagi',
};

function oknoKlienta(k) {
  const admin = jestBiuro();
  const nowy = !k;
  k = k || { nazwa: '', ulica: '', kod: '', miasto: '', osoba: '', telefon: '', email: '',
    nip: '', godziny: '', uwagi: '', aktywny: 1 };

  if (!admin) {
    return okno({
      tytul: k.nazwa,
      tresc: `<p><b>${escHtml(adresJednymCiagiem(k)) || 'brak adresu'}</b></p>
        ${k.osoba ? `<p>👤 ${escHtml(k.osoba)}</p>` : ''}
        ${k.telefon ? `<p><a href="tel:${escHtml(k.telefon.replace(/\s/g, ''))}">📞 ${escHtml(k.telefon)}</a></p>` : ''}
        ${k.godziny ? `<p>🕒 ${escHtml(k.godziny)}</p>` : ''}
        ${k.uwagi ? `<div class="wstega uwaga">${escHtml(k.uwagi)}</div>` : ''}`,
      przyciski: [{ napis: 'Zamknij', klik: z => z() }],
    });
  }

  okno({
    tytul: nowy ? 'Nowy klient' : k.nazwa,
    tresc: `
      <label>Nazwa <span style="color:var(--czerwony)">*</span>
        <input id="kl-nazwa" value="${escHtml(k.nazwa)}" autocapitalize="words"></label>
      <label>Ulica i numer<input id="kl-ulica" value="${escHtml(k.ulica)}"></label>
      <div class="dwie">
        <label>Kod pocztowy<input id="kl-kod" value="${escHtml(k.kod)}" placeholder="00-000"></label>
        <label>Miasto<input id="kl-miasto" value="${escHtml(k.miasto)}"></label>
      </div>
      <div class="dwie">
        <label>Osoba kontaktowa<input id="kl-osoba" value="${escHtml(k.osoba)}"></label>
        <label>Telefon<input id="kl-telefon" value="${escHtml(k.telefon)}" inputmode="tel"></label>
      </div>
      <div class="dwie">
        <label>E-mail<input id="kl-email" value="${escHtml(k.email)}" inputmode="email"></label>
        <label>NIP<input id="kl-nip" value="${escHtml(k.nip)}"></label>
      </div>
      <label>Godziny przyjęć<input id="kl-godziny" value="${escHtml(k.godziny)}"
        placeholder="np. 7:00–15:00, w piątki do 13:00"></label>
      <label>Uwagi <span class="slaby">(kierowca zobaczy je przy dostawie)</span>
        <textarea id="kl-uwagi" placeholder="np. wjazd od podwórza, brama na kod 1234, wózek widłowy tylko do 14">${escHtml(k.uwagi)}</textarea>
      </label>
      ${nowy ? '' : `<label class="plaska"><input type="checkbox" id="kl-aktywny" ${k.aktywny ? 'checked' : ''}>
        Klient aktywny (odznacz, żeby schować z listy)</label>
        <div class="male slaby">Punkt na mapie: ${k.lat == null ? '<b>nie znaleziony</b>' : `${k.lat.toFixed(5)}, ${k.lon.toFixed(5)}`}</div>
        <button class="maly" id="kl-geo" style="margin-top:6px">🔍 Znajdź adres na mapie</button>`}`,
    przyciski: [
      ...(nowy ? [] : [{ napis: 'Historia', klik: () => oknoHistoriiKlienta(k.id, k.nazwa) }]),
      ...(nowy ? [] : [{ napis: '🏭 To nasze miejsce', klik: async z => {
        if (!await potwierdz('Przenieść do naszych lokalizacji?',
          'Ten wpis przestanie być odbiorcą, a stanie się naszym miejscem, z którego '
          + 'wyjeżdżamy. Adres, telefon i uwagi idą razem z nim. Jeśli był już na jakiejś '
          + 'zleceniu, zostanie w historii jako ukryty klient.')) return;
        const w = await sprobuj(() => API.post(`/api/klienci/${k.id}/na-lokalizacje`));
        if (!w) return;
        z();
        komunikat(w.schowany
          ? 'Przeniesione. Stary wpis został schowany, bo trzyma go historia dostaw — '
            + 'nie ma go już na liście klientów.'
          : 'Przeniesione do naszych lokalizacji', 'ok');
        stan.klienci = []; await odswiezLokalizacje();
        pokazEkran('lokalizacje');
      } }]),
      ...(nowy ? [] : [{ napis: 'Usuń', klasa: 'niszczacy', klik: async z => {
        if (!await potwierdz('Usunąć klienta?',
          'Jeśli był w jakimś zleceniu, zostanie tylko ukryty — historia dostaw musi się zgadzać.')) return;
        const w = await sprobuj(() => API.del('/api/klienci/' + k.id));
        if (!w) return;
        z();
        // Wcześniej program mówił po prostu „Gotowe", a wpis zostawał na liście —
        // wyglądało to, jakby przycisk nie działał. Teraz tłumaczy dlaczego.
        if (w.schowany) {
          komunikat(`Wpis został schowany, nie skasowany — trzyma go `
            + `${w.dostaw} ${odmiana(w.dostaw, 'dostawa', 'dostawy', 'dostaw')} w historii.`
            + (w.przeniesiony ? ' Sama lokalizacja jest w „Nasze lokalizacje".' : ''), 'ok');
        } else {
          komunikat('Klient usunięty', 'ok');
        }
        stan.klienci = [];
        pokazEkran('klienci');
      } }]),
      { napis: 'Anuluj', klik: z => z() },
      { napis: 'Zapisz', klasa: 'glowny', klik: async z => {
        const dane = {
          id: k.id, nazwa: val('kl-nazwa'), ulica: val('kl-ulica'), kod: val('kl-kod'),
          miasto: val('kl-miasto'), osoba: val('kl-osoba'), telefon: val('kl-telefon'),
          email: val('kl-email'), nip: val('kl-nip'), godziny: val('kl-godziny'),
          uwagi: val('kl-uwagi'),
          aktywny: nowy ? 1 : (document.getElementById('kl-aktywny').checked ? 1 : 0),
        };
        if (!dane.nazwa) { komunikat('Podaj nazwę klienta', 'blad'); return; }
        const w = await sprobuj(() => API.post('/api/klienci', dane), 'Zapisano');
        if (!w) return;
        z();
        if (dane.ulica || dane.miasto) {
          sprobuj(() => API.post(`/api/klienci/${w.id}/geokoduj`))
            .then(() => pokazEkran('klienci'));
        } else {
          pokazEkran('klienci');
        }
      } },
    ],
    poOtwarciu: pole => {
      const geo = pole.querySelector('#kl-geo');
      if (geo) geo.onclick = async () => {
        const w = await sprobuj(() => API.post(`/api/klienci/${k.id}/geokoduj`), 'Znaleziono na mapie');
        if (w) { zamknijOkno(); pokazEkran('klienci'); }
      };
    },
  });
}

function val(id) { return (document.getElementById(id).value || '').trim(); }

/* =============================================================== RAPORTY */

async function rysujRaportyBiura(pole, param) {
  const od = param.od || przesunDate(dzisiaj(), -13);
  const doDnia = param.do || dzisiaj();
  const kierowcy = await listaKierowcow();
  const wiersze = await API.get(`/api/raporty?od=${od}&do=${doDnia}`);

  const suma = wiersze.reduce((s, w) => ({
    godziny: s.godziny + (w.godziny || 0),
    km: s.km + (w.km || 0),
    paliwo: s.paliwo + (w.paliwo_pln || 0),
  }), { godziny: 0, km: 0, paliwo: 0 });

  pole.innerHTML = `
    <div class="pasek-narzedzi">
      <label>Od<input type="date" id="rb-od" value="${od}"></label>
      <label>Do<input type="date" id="rb-do" value="${doDnia}"></label>
      <button id="rb-miesiac">Ten miesiąc</button>
      <button class="glowny" data-eksport="raporty">⬇ Raporty do Excela</button>
      <button data-eksport="dostawy">⬇ Dostawy do Excela</button>
    </div>

    <div class="trzy">
      ${kafelek('Godziny pracy', suma.godziny.toFixed(1), '')}
      ${kafelek('Przejechane km', suma.km, '')}
      ${kafelek('Paliwo (zł)', suma.paliwo.toFixed(2), '')}
    </div>

    <div id="rb-braki"></div>

    <div class="karta" style="margin-top:16px">
      <div class="tabela-przewijana">
        <table>
          <thead><tr>
            <th>Dzień</th><th>Kierowca</th><th>Bus</th><th>Start</th><th>Koniec</th>
            <th>Przerwa</th><th>Godziny</th><th>km</th><th>Paliwo</th><th>Usterki / uwagi</th>
          </tr></thead>
          <tbody>${wiersze.length ? wiersze.map(w => `<tr>
              <td>${polskaData(w.data)}</td>
              <td><b>${escHtml(w.kierowca_imie)}</b></td>
              <td>${escHtml(w.pojazd_nazwa || '')}</td>
              <td>${escHtml(w.start_o || '')}</td>
              <td>${escHtml(w.koniec_o || '')}</td>
              <td>${w.przerwa_min || 0} min</td>
              <td><b>${w.godziny != null ? w.godziny : '—'}</b></td>
              <td>${w.km != null ? w.km : '—'}</td>
              <td>${w.paliwo_l != null ? w.paliwo_l + ' l' : ''}
                  ${w.paliwo_pln != null ? '<br>' + w.paliwo_pln.toFixed(2) + ' zł' : ''}</td>
              <td class="male">${w.usterki ? '<b style="color:var(--czerwony)">⚠ ' + escHtml(w.usterki) + '</b><br>' : ''}
                  ${escHtml(w.uwagi || '')}</td>
            </tr>`).join('')
    : '<tr><td colspan="10"><div class="pusto">Brak raportów w tym okresie.</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    ${kierowcy.length ? `<div class="male slaby">
      Kierowcy wypełniają raporty w swoich telefonach — tutaj tylko je przeglądasz i eksportujesz.</div>` : ''}`;

  // Adres pobrania trafia do historii przeglądarki, więc nie wkładamy w niego
  // tokenu sesji — bierzemy osobny, ważny pięć minut i tylko do pobierania.
  pole.querySelectorAll('[data-eksport]').forEach(przycisk => przycisk.onclick = async () => {
    const w = await sprobuj(() => API.post('/api/eksport/token', { zakres: 'eksport' }));
    if (!w) return;
    // adresDanych(): z GitHub Pages plik CSV wydaje program w biurze, nie Pages.
    const adres = adresDanych(`/api/eksport/${przycisk.dataset.eksport}.csv`
      + `?od=${od}&do=${doDnia}&t=${encodeURIComponent(w.token)}`);
    const link = document.createElement('a');
    link.href = adres;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  rysujBraki(pole.querySelector('#rb-braki'), od, doDnia);

  const odswiez = () => pokazEkran('raporty', {
    od: pole.querySelector('#rb-od').value, do: pole.querySelector('#rb-do').value,
  });
  pole.querySelector('#rb-od').onchange = odswiez;
  pole.querySelector('#rb-do').onchange = odswiez;
  pole.querySelector('#rb-miesiac').onclick = () => {
    const d = new Date();
    pokazEkran('raporty', {
      // Pierwszy dzień miesiąca o północy CZASU LOKALNEGO — przez UTC wychodził
      // ostatni dzień poprzedniego miesiąca.
      od: dataLokalna(new Date(d.getFullYear(), d.getMonth(), 1)),
      do: dzisiaj(),
    });
  };
}

/* Minuty na czytelne „6 h 40 min" — biuro planuje dzien, a nie liczy w glowie. */
function godzinyMinuty(minuty) {
  const m = Math.max(0, Math.round(minuty || 0));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/* ============================================================ USTAWIENIA */

const OPIS_ROLI = { admin: 'administrator', biuro: 'biuro', kierowca: 'kierowca' };

EKRANY.ustawienia = {
  tytul: 'Ustawienia',
  tylkoAdministrator: true,
  async rysuj(pole) {
    const [u, ustawienia] = await Promise.all([
      API.get('/api/uzytkownicy'), API.get('/api/ustawienia'),
    ]);
    await odswiezLokalizacje();
    stan._lokalizatory = ustawienia.ikol_ustawiony
      ? await API.get('/api/ikol/lokalizatory').catch(() => []) : [];
    stan.ustawienia = ustawienia;
    stan._kierowcy = u.filter(x => x.aktywny);
    stan.pojazdy = await API.get('/api/pojazdy');

    pole.innerHTML = `
      ${wstegiAlarmow(ustawienia.alarmy, false)}
      <div class="karta">
        <h2>Firma i baza</h2>
        <label>Nazwa firmy<input id="u-firma" value="${escHtml(ustawienia.firma || '')}"></label>
        <label>Adres bazy / magazynu <span class="slaby">(punkt startu i powrotu przy liczeniu tras)</span>
          <input id="u-baza" value="${escHtml(ustawienia.baza_adres || '')}"
                 placeholder="np. ul. Przemysłowa 10, 62-800 Kalisz"></label>
        <div class="male slaby">${ustawienia.baza_lat
          ? `Znaleziona na mapie: ${escHtml(ustawienia.baza_lat)}, ${escHtml(ustawienia.baza_lon)}`
          : 'Jeszcze nie odnaleziona na mapie — zapisz adres, spróbuję go znaleźć.'}</div>
        <label style="margin-top:14px">Powody nieudanych dostaw
          <span class="slaby">(jeden w każdej linii — kierowca wybiera z tej listy)</span>
          <textarea id="u-powody" style="min-height:140px">${escHtml(ustawienia.powody_nieudanych || '')}</textarea>
        </label>
        <button class="glowny zapisz-ustawienia">Zapisz ustawienia</button>
      </div>

      ${zwin('Ślad GPS z telefonów', '', `
        <p class="male slaby">Położenie kierowcy to dana osobowa. Program kasuje stare punkty sam,
           a kierowca sam włącza i wyłącza udostępnianie w swoim telefonie.</p>
        <div class="dwie">
          <label>Trzymaj ślad GPS przez (dni)
            <input type="number" id="u-retencja" min="1" max="730"
                   value="${escHtml(ustawienia.retencja_pozycji_dni || '30')}">
            <span class="male slaby">Ślad służy do pokazania, gdzie jest bus. Dłuższe
              trzymanie nikomu nie służy, a rozdmuchuje kopie zapasowe.</span></label>
          <label>Trzymaj zdjęcia i podpisy przez (miesiące)
            <input type="number" id="u-retencja-zal" min="0" max="120"
                   value="${escHtml(ustawienia.retencja_zalacznikow_mies || '0')}">
            <span class="male slaby">0 = trzymaj bez końca. Podpisy też są danymi osobowymi,
              ale bywają jedynym dowodem w sporze — kasuj świadomie.</span></label>
        </div>
        <p class="male slaby">Sprzątanie odbywa się przy każdym uruchomieniu programu.</p>
        <button class="glowny zapisz-ustawienia">Zapisz ustawienia</button>`)}

      ${zwin('Godziny dojazdu', '', `
        <p class="male slaby">Z tego program liczy, o której bus będzie u każdego klienta,
          i ostrzega, gdy nie zdąży przed zamknięciem. Liczy w przeglądarce, więc działa
          też w telefonie bez zasięgu. To szacunek, nie nawigacja: odległość w linii prostej
          razy 1,35, bo drogi nie są proste.</p>
        <div class="trzy">
          <label>Godzina wyjazdu z bazy
            <input type="time" id="u-wyjazd" value="${escHtml(ustawienia.godzina_wyjazdu || '07:00')}"></label>
          <label>Średnia prędkość (km/h)
            <input type="number" id="u-predkosc" min="20" max="120"
                   value="${escHtml(ustawienia.srednia_predkosc || '50')}"></label>
          <label>Rozładunek u klienta (min)
            <input type="number" id="u-rozladunek" min="0" max="240"
                   value="${escHtml(ustawienia.czas_rozladunku_min || '15')}"></label>
        </div>
        <div class="dwie">
          <label>Załadunek w naszym magazynie (min)
            <input type="number" id="u-zaladunek" min="0" max="240"
                   value="${escHtml(ustawienia.czas_zaladunku_min || '30')}"></label>
          <label>Cisza telefonu — alarm po (min)
            <input type="number" id="u-cisza" min="15" max="480"
                   value="${escHtml(ustawienia.cisza_alarm_min || '90')}"></label>
        </div>
        <p class="male slaby">Po tylu minutach bez kontaktu z telefonem kierowcy
          ekran „Na żywo" zapali ostrzeżenie. Brak kontaktu zwykle znaczy brak
          zasięgu, a nie brak pracy — ale biuro ma o tym wiedzieć.</p>
        <p class="male slaby">W ciągu dnia godziny liczą się od ostatniej zamkniętej dostawy,
          a nie od porannego planu — po pierwszym opóźnieniu reszta i tak byłaby nieprawdziwa.</p>
        <button class="glowny zapisz-ustawienia">Zapisz ustawienia</button>`)}

      ${zwin('Przerwy kierowcy', String(ustawienia.przerwy_wlaczone || '1') === '0'
        ? '<span class="plakietka p-oczekuje">wyłączone</span>'
        : '<span class="plakietka p-dostarczone">✓ doliczane</span>', `
        <p class="male slaby">Do czasu trasy program dolicza <b>przerwy kierowcy</b>.
          Kluczowa różnica wobec postoju: <b>rozładunek u klienta nie jest przerwą</b> —
          kierowca wtedy pracuje, więc licznik jazdy leci dalej. Przerwa wypada
          w drodze, w chwili wyczerpania limitu.</p>
        <p class="male slaby">Wszystkie liczby poniżej ustawiacie sami, tak samo jak
          czas załadunku. Domyślne wartości wzięliśmy z rozporządzenia 561/2006
          i ustawy o czasie pracy kierowców — jako rozsądny punkt wyjścia,
          nie dlatego, że coś je narzuca.</p>
        <label class="plaska"><input type="checkbox" id="u-przepisy"
          ${String(ustawienia.przerwy_wlaczone || '1') === '0' ? '' : 'checked'}>
          Doliczaj przerwy do czasu trasy</label>
        <p class="male slaby">Można to wyłączyć osobno dla każdego busa — przełącznik
          jest przy nim na liście poniżej.</p>
        <div class="dwie">
          <label>Po ilu minutach jazdy przerwa
            <input type="number" id="u-jazda-przerwa" min="30" max="900"
                   value="${escHtml(ustawienia.jazda_do_przerwy_min || '270')}"></label>
          <label>Ile trwa ta przerwa (min)
            <input type="number" id="u-przerwa" min="0" max="240"
                   value="${escHtml(ustawienia.przerwa_min || '45')}"></label>
        </div>
        <div class="dwie">
          <label>Po ilu minutach pracy przerwa
            <input type="number" id="u-praca-przerwa" min="30" max="900"
                   value="${escHtml(ustawienia.praca_do_przerwy_min || '360')}"></label>
          <label>Ile trwa ta przerwa (min)
            <input type="number" id="u-przerwa-praca" min="0" max="240"
                   value="${escHtml(ustawienia.przerwa_pracownicza_min || '30')}"></label>
        </div>
        <p class="male slaby">Praca to jazda razem z postojami. Przerwy z jazdy
          zaliczają się do tego wymiaru — dokładamy tylko brakującą różnicę.</p>
        <div class="dwie">
          <label>Długi dzień: powyżej ilu minut pracy
            <input type="number" id="u-dluga-praca" min="60" max="900"
                   value="${escHtml(ustawienia.dluga_praca_min || '540')}"></label>
          <label>...tyle przerwy łącznie (min)
            <input type="number" id="u-przerwa-dluga" min="0" max="240"
                   value="${escHtml(ustawienia.przerwa_dlugiej_pracy_min || '45')}"></label>
        </div>
        <div class="dwie">
          <label>Ostrzegaj powyżej (min jazdy dziennie)
            <input type="number" id="u-limit-jazdy" min="60" max="1200"
                   value="${escHtml(ustawienia.dobowy_limit_jazdy_min || '540')}"></label>
          <label>Ostrzegaj powyżej (min całego dnia)
            <input type="number" id="u-doba" min="60" max="1440"
                   value="${escHtml(ustawienia.doba_pracy_min || '780')}"></label>
        </div>
        <button class="glowny zapisz-ustawienia">Zapisz ustawienia</button>`)}

      ${zwin('Powiadamianie klienta', ustawienia.poczta_ustawiona
        ? '<span class="plakietka p-dostarczone">✓ gotowe</span>'
        : '<span class="plakietka p-oczekuje">nieustawione</span>', `
        <p class="male slaby">Program potrafi wysłać klientowi e-mail: „planujemy dostawę
          w środę, orientacyjnie 12:30". Wysyłasz Ty, przyciskiem przy punkcie —
          <b>nic nie rozsyła się samo</b>. Potrzebne są dane Waszego serwera pocztowego,
          te same co w programie pocztowym.</p>
        <div class="dwie">
          <label>Serwer SMTP
            <input id="u-poczta-serwer" value="${escHtml(ustawienia.poczta_serwer || '')}"
                   placeholder="np. smtp.nazwa.pl"></label>
          <label>Port
            <input type="number" id="u-poczta-port" value="${escHtml(ustawienia.poczta_port || '587')}"></label>
          <label>Szyfrowanie
            <select id="u-poczta-szyfrowanie">
              <option value="starttls" ${ustawienia.poczta_szyfrowanie === 'starttls' ? 'selected' : ''}>STARTTLS (port 587)</option>
              <option value="ssl" ${ustawienia.poczta_szyfrowanie === 'ssl' ? 'selected' : ''}>SSL (port 465)</option>
              <option value="brak" ${ustawienia.poczta_szyfrowanie === 'brak' ? 'selected' : ''}>bez szyfrowania</option>
            </select></label>
          <label>Adres nadawcy
            <input id="u-poczta-nadawca" value="${escHtml(ustawienia.poczta_nadawca || '')}"
                   placeholder="np. biuro@twojafirma.pl"></label>
          <label>Login <span class="slaby">(zwykle ten sam co adres)</span>
            <input id="u-poczta-login" value="${escHtml(ustawienia.poczta_login || '')}"></label>
          <label>Hasło
            <input id="u-poczta-haslo" type="password" autocomplete="new-password"
                   placeholder="${ustawienia.poczta_ustawiona ? 'hasło zapisane — wpisz nowe, żeby zmienić' : ''}"></label>
        </div>
        <label>Stopka wiadomości
          <textarea id="u-poczta-stopka" placeholder="np. Pozdrawiamy, GK Factory · tel. 62 000 00 00">${escHtml(ustawienia.poczta_stopka || '')}</textarea></label>
        <div class="przyciski">
          <button class="glowny zapisz-ustawienia">Zapisz ustawienia</button>
          <button id="u-poczta-test">Wyślij wiadomość próbną</button>
        </div>
        <p class="male slaby">Hasło do poczty zapisuje się w pliku <code>dane.db</code>
          w folderze programu — tak samo jak reszta danych firmy.</p>`)}

      ${kartaKopii(ustawienia)}
      ${kartaTunelu(ustawienia)}
      ${kartaPages(ustawienia)}
      ${kartaIkol(ustawienia)}
      ${kartaFlotexu(ustawienia)}
      ${kartaKontGK(ustawienia)}

      ${zwin('Trasy po drogach', ustawienia.ors_klucz_ustawiony ? 'klucz zapisany' : 'działa bez klucza', `
        <p class="male slaby">Przycisk „Pokaż przebieg po drogach" na mapie trasy działa
          <b>bez żadnego klucza</b> — rysuje przejazd po prawdziwych drogach wraz z kilometrami
          i czasem, korzystając z darmowego routera OpenStreetMap. Wymaga tylko internetu.</p>
        <p class="male slaby">Klucz poniżej jest nieobowiązkowy i zmienia co innego: <b>kolejność</b>
          punktów układana przy „Ułóż trasę". Bez klucza kolejność liczy się w linii prostej —
          dla dostaw do 100 km to zwykle wystarcza. Darmowy klucz z openrouteservice.org
          układa ją po realnych drogach.</p>
        <label>Klucz OpenRouteService
          <input id="u-ors" placeholder="${ustawienia.ors_klucz_ustawiony
            ? 'klucz jest zapisany — wpisz nowy, żeby zmienić' : 'wklej klucz'}"></label>
        <div class="male ${ustawienia.ors_klucz_ustawiony ? '' : 'slaby'}">
          ${ustawienia.ors_klucz_ustawiony ? '✓ Klucz zapisany' : 'Klucz nie jest ustawiony'}</div>
        <button class="glowny zapisz-ustawienia" style="margin-top:12px">Zapisz ustawienia</button>`)}

      <div class="karta">
        <div class="karta-gora"><h2>Konta</h2>
          ${ustawienia.konta_z_panelu ? ''
            : '<button class="maly glowny" id="u-nowe-konto">+ Nowe konto</button>'}</div>
        ${ustawienia.konta_z_panelu ? `<div class="wstega info">Konta zakłada się teraz
          w <b>Panelu → Administracja</b> (GK Panel Kierownika) — jedno konto osoby we wszystkich
          aplikacjach GK. Tutaj ustawisz tylko bazę wyjazdową. Konta tutejsze (np. awaryjne
          „admin”) działają dalej.</div>` : ''}
        ${wstegaLogowaniaZInternetu(ustawienia.logowanie_z_internetu)}
        <div class="tabela-przewijana"><table>
          <thead><tr><th>Imię</th><th>Login</th><th>Rola</th><th>Telefon</th><th></th></tr></thead>
          <tbody>${u.map(x => `<tr style="${x.aktywny ? '' : 'opacity:.5'}">
            <td><b>${escHtml(x.imie)}</b>${x.aktywny ? '' : ' <span class="male">(wyłączone)</span>'}
              ${x.zrodlo === 'gk' ? ' <span class="plakietka p-planowana">z Panelu</span>' : ''}
              ${x.zrodlo === 'gk' && x.pin_w_panelu && x.aktywny
                ? '<br><span class="male slaby">PIN do ustawienia w Panelu</span>' : ''}
              ${opisBlokadyZInternetu(x.z_internetu)}</td>
            <td>${escHtml(x.login)}</td>
            <td>${OPIS_ROLI[x.rola] || x.rola}${x.baza_nazwa
                  ? `<br><span class="male slaby">🏭 ${escHtml(x.baza_nazwa)}</span>` : ''}</td>
            <td>${escHtml(x.telefon || '')}</td>
            <td><div class="przyciski"><button class="maly" data-konto="${x.id}">Zmień</button>
              ${(x.z_internetu || {}).blokada
                ? `<button class="maly glowny" data-odblokuj="${x.id}">Odblokuj</button>` : ''}</div></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>

      <div class="karta">
        <div class="karta-gora"><h2>Busy</h2>
          <div class="przyciski">
            ${(ustawienia.flotex_stan || {}).polaczony
              ? '<button class="maly" id="u-flotex-import">Pobierz auta z GK Flota</button>' : ''}
            <button class="maly glowny" id="u-nowy-bus">+ Nowy bus</button></div></div>
        <div class="tabela-przewijana"><table>
          <thead><tr><th>Nazwa</th><th>Rejestracja</th>
            ${(ustawienia.flotex_stan || {}).polaczony ? '<th>GK Flota</th>' : ''}<th>Uwagi</th><th></th></tr></thead>
          <tbody>${stan.pojazdy.length ? stan.pojazdy.map(b => `<tr style="${b.aktywny ? '' : 'opacity:.5'}">
            <td><b>${escHtml(b.nazwa)}</b></td><td>${escHtml(b.rejestracja || '')}</td>
            ${(ustawienia.flotex_stan || {}).polaczony ? `<td>${b.flotex
              ? znacznikFlotexu(b.flotex) + powodyFlotexu(b.flotex)
              : '<span class="male slaby">nie ma w GK Flota</span>'}</td>` : ''}
            <td class="male">${escHtml(b.uwagi || '')}</td>
            <td><button class="maly" data-bus="${b.id}">Zmień</button></td>
          </tr>`).join('') : '<tr><td colspan="5"><div class="pusto">Nie ma jeszcze busów.</div></td></tr>'}</tbody>
        </table></div>
      </div>

      ${zwin('Jak wejść z telefonu', '', `
        <p class="male">Najprościej: menu <b>📲 Zaproś kierowcę</b> — kierowca skanuje kod QR
          aparatem telefonu. Adres to stały adres aplikacji na GitHub Pages
          (<code>${escHtml(((ustawienia.pages || {}).adres) || 'https://milo252-gk.github.io/gk-trasy-aplikacja/')}</code>),
          a gdy aplikacji tam jeszcze nie wysłano — adres tunelu albo firmowego wifi.</p>
        <p class="male">Kierowca loguje się imieniem i nazwiskiem (albo loginem) i PIN-em,
          a potem w przeglądarce wybiera <b>„Dodaj do ekranu głównego"</b>. Od tej pory
          aplikacja otwiera się z ikony jak zwykły program i działa również bez zasięgu.</p>`)}`;

    const zapiszWszystko = async () => {
      const daneUstawien = {
        firma: val('u-firma'), baza_adres: val('u-baza'),
        baza_lat: '', baza_lon: '',
        powody_nieudanych: document.getElementById('u-powody').value,
        retencja_pozycji_dni: val('u-retencja'),
        retencja_zalacznikow_mies: val('u-retencja-zal'),
        godzina_wyjazdu: val('u-wyjazd'),
        srednia_predkosc: val('u-predkosc'),
        czas_rozladunku_min: val('u-rozladunek'),
        czas_zaladunku_min: val('u-zaladunek'),
        cisza_alarm_min: val('u-cisza'),
        przerwy_wlaczone: document.getElementById('u-przepisy')
          && !document.getElementById('u-przepisy').checked ? '0' : '1',
        jazda_do_przerwy_min: val('u-jazda-przerwa'),
        przerwa_min: val('u-przerwa'),
        praca_do_przerwy_min: val('u-praca-przerwa'),
        przerwa_pracownicza_min: val('u-przerwa-praca'),
        dluga_praca_min: val('u-dluga-praca'),
        przerwa_dlugiej_pracy_min: val('u-przerwa-dluga'),
        dobowy_limit_jazdy_min: val('u-limit-jazdy'),
        doba_pracy_min: val('u-doba'),
        poczta_serwer: val('u-poczta-serwer'),
        poczta_port: val('u-poczta-port'),
        poczta_szyfrowanie: document.getElementById('u-poczta-szyfrowanie').value,
        poczta_nadawca: val('u-poczta-nadawca'),
        poczta_login: val('u-poczta-login'),
        poczta_haslo: val('u-poczta-haslo'),
        poczta_stopka: val('u-poczta-stopka'),
        ors_klucz: val('u-ors'),
        tunel_tryb: (document.querySelector('input[name=tunel]:checked') || {}).value || 'brak',
        tunel_token: val('u-tunel-token'),
        tunel_adres: val('u-tunel-adres'),
        github_repo: val('u-github-repo'),
        github_galaz: val('u-github-galaz'),
        github_token: val('u-github-token'),
        ikol_wlaczony: document.getElementById('u-ikol-wlaczony').checked ? '1' : '',
        ikol_login: val('u-ikol-login'),
        ikol_haslo: val('u-ikol-haslo'),
        ikol_appkey: val('u-ikol-appkey'),
        flotex_adres: val('u-flotex-adres'),
        flotex_klucz: val('u-flotex-klucz'),
        hub_adres: val('u-hub-adres'),
        hub_klucz: val('u-hub-klucz'),
        kopia_folder: val('u-kopia-folder'),
      };
      // Serwer odpowiada 409, gdy zapis skasowałby podpisy i zdjęcia przez
      // retencję. Wtedy pytamy człowieka i dopiero po zgodzie ponawiamy —
      // to jedyne miejsce w programie, które kasuje dowody dostaw bezpowrotnie.
      let w = null;
      zajety(true);
      try {
        w = await API.post('/api/ustawienia', daneUstawien);
        komunikat('Zapisano', 'ok');
      } catch (e) {
        zajety(false);
        if (e.kod === 409 && await potwierdz('Na pewno skasować?', e.message)) {
          w = await sprobuj(() => API.post('/api/ustawienia',
            Object.assign({}, daneUstawien, { potwierdzam_kasowanie: true })), 'Zapisano');
        } else if (e.kod !== 409) {
          komunikat(poLudzku(e), 'blad');
        }
        zajety(true);
      } finally {
        zajety(false);
      }
      if (w) {
        if (zmienionoTunel(ustawienia)) {
          komunikat('Zamknij i uruchom program ponownie, żeby tunel się przestawił', 'ok');
        }
        pokazEkran('ustawienia');
      }
    };
    // Kazda karta ma wlasny przycisk zapisu — inaczej trzeba by pamietac
    // o zjechaniu na sam gorny przycisk, a tego nikt nie robi.
    pole.querySelectorAll('.zapisz-ustawienia').forEach(p => p.onclick = zapiszWszystko);

    podepnijPages(pole);
    podepnijKopie(pole);

    // Przycisk najpierw zapisuje to, co wpisano w pola obok, a dopiero potem
    // pyta IKOL. Inaczej sprawdzalby dane z bazy, a nie te z ekranu — i mowilby
    // "nie podano loginu i hasla", mimo ze pola sa wypelnione.
    pole.querySelector('#u-ikol-sprawdz').onclick = async () => {
      const login = val('u-ikol-login');
      const haslo = val('u-ikol-haslo');
      if (!login) { komunikat('Wpisz login do IKOL-a', 'blad'); return; }
      if (!haslo && !ustawienia.ikol_ustawiony) {
        komunikat('Wpisz hasło do IKOL-a', 'blad');
        return;
      }
      const zapisane = await sprobuj(() => API.post('/api/ustawienia', {
        ikol_login: login,
        ikol_haslo: haslo,
        ikol_appkey: val('u-ikol-appkey'),
        ikol_wlaczony: document.getElementById('u-ikol-wlaczony').checked ? '1' : '',
      }));
      if (!zapisane) return;

      const w = await sprobuj(() => API.post('/api/ikol/sprawdz'));
      if (!w) { pokazEkran('ustawienia'); return; }
      komunikat(`IKOL odpowiedział — znaleziono ${w.znaleziono} ${
        odmiana(w.znaleziono, 'lokalizator', 'lokalizatory', 'lokalizatorów')}`, 'ok');
      if (!document.getElementById('u-ikol-wlaczony').checked) {
        komunikat('Połączenie działa, ale pobieranie pozycji jest wyłączone — '
          + 'zaznacz „Pobieraj pozycje z IKOL-a"', 'blad');
      }
      pokazEkran('ustawienia');
    };
    const pobierzTeraz = pole.querySelector('#u-ikol-pobierz');
    if (pobierzTeraz) pobierzTeraz.onclick = async () => {
      if (val('u-ikol-haslo')) {
        await sprobuj(() => API.post('/api/ustawienia', { ikol_haslo: val('u-ikol-haslo') }));
      }
      const w = await sprobuj(() => API.post('/api/ikol/pobierz'));
      if (w) komunikat(`Zapisano ${w.pobrano} ${
        odmiana(w.pobrano, 'pozycję', 'pozycje', 'pozycji')}`, 'ok');
    };
    const zapomnij = pole.querySelector('#u-ikol-zapomnij');
    if (zapomnij) zapomnij.onclick = async () => {
      if (!await potwierdz('Usunąć zapisane dane do IKOL-a?',
        'Program zapomni login, hasło i listę lokalizatorów. Pobieranie pozycji '
        + 'z IKOL-a przestanie działać, dopóki nie wpiszesz ich ponownie.')) return;
      const w = await sprobuj(() => API.post('/api/ikol/zapomnij'), 'Dane usunięte');
      if (w) pokazEkran('ustawienia');
    };
    pole.querySelectorAll('[data-lokalizator]').forEach(b =>
      b.onclick = () => oknoLokalizatora(b.dataset.lokalizator));

    // GK Flota: jak przy IKOL-u — najpierw zapis tego, co wpisano obok,
    // dopiero potem pytanie, inaczej sprawdzalibysmy stary klucz z bazy.
    pole.querySelector('#u-flotex-sprawdz').onclick = async () => {
      if (!val('u-flotex-klucz') && !ustawienia.flotex_klucz_ustawiony) {
        komunikat('Wklej klucz z GK Flota (Ustawienia → Połączenie z GK Trasy)', 'blad');
        return;
      }
      const zapisane = await sprobuj(() => API.post('/api/ustawienia', {
        flotex_adres: val('u-flotex-adres'), flotex_klucz: val('u-flotex-klucz'),
      }));
      if (!zapisane) return;
      const w = await sprobuj(() => API.post('/api/flotex/sprawdz'));
      if (w) komunikat(w.komunikat, 'ok');
      pokazEkran('ustawienia');
    };
    const flotexPonow = pole.querySelector('#u-flotex-ponow');
    if (flotexPonow) flotexPonow.onclick = async () => {
      const w = await sprobuj(() => API.post('/api/flotex/ponow'),
        'Wysyłam jeszcze raz — odśwież ekran za chwilę');
      if (w) setTimeout(() => { if (stan.ekran === 'ustawienia') pokazEkran('ustawienia'); }, 2500);
    };
    const flotexOdlacz = pole.querySelector('#u-flotex-zapomnij');
    if (flotexOdlacz) flotexOdlacz.onclick = async () => {
      if (!await potwierdz('Odłączyć GK Trasy od GK Flota?',
        'GK Trasy zapomni klucz. Kierowcy stracą „Moje auto”, a raporty przestaną iść do '
        + 'GK Flota, dopóki nie wkleisz klucza ponownie.')) return;
      const w = await sprobuj(() => API.post('/api/flotex/zapomnij'), 'Odłączono');
      if (w) pokazEkran('ustawienia');
    };
    const flotexImport = pole.querySelector('#u-flotex-import');
    if (flotexImport) flotexImport.onclick = async () => {
      const w = await sprobuj(() => API.post('/api/flotex/import-pojazdow'));
      if (!w) return;
      komunikat(w.dodane
        ? `Dodano ${w.dodane} ${odmiana(w.dodane, 'auto', 'auta', 'aut')} z GK Flota`
        : 'Wszystkie auta z GK Flota już są w programie GK Trasy', 'ok');
      pokazEkran('ustawienia');
    };

    const kopiuj = pole.querySelector('#u-kopiuj-adres');
    if (kopiuj) kopiuj.onclick = () => {
      navigator.clipboard.writeText((ustawienia.tunel || {}).adres || '')
        .then(() => komunikat('Adres skopiowany — wyślij go kierowcom', 'ok'))
        .catch(() => komunikat('Skopiuj adres ręcznie', 'blad'));
    };
    pole.querySelector('#u-poczta-test').onclick = async () => {
      const zapisane = await sprobuj(() => API.post('/api/ustawienia', {
        poczta_serwer: val('u-poczta-serwer'), poczta_port: val('u-poczta-port'),
        poczta_szyfrowanie: document.getElementById('u-poczta-szyfrowanie').value,
        poczta_nadawca: val('u-poczta-nadawca'), poczta_login: val('u-poczta-login'),
        poczta_haslo: val('u-poczta-haslo'), poczta_stopka: val('u-poczta-stopka'),
      }));
      if (!zapisane) return;
      okno({
        tytul: 'Wiadomość próbna',
        tresc: `<label>Wyślij na adres
            <input id="pt-adres" value="${escHtml(val('u-poczta-nadawca'))}"></label>
          <p class="male slaby">Sprawdź ustawienia zanim cokolwiek pójdzie do klienta.</p>`,
        przyciski: [
          { napis: 'Anuluj', klik: z => z() },
          { napis: 'Wyślij', klasa: 'glowny', klik: async z => {
            const w = await sprobuj(() => API.post('/api/poczta/test',
              { adres: val('pt-adres') }), 'Wysłane — sprawdź skrzynkę');
            if (w) { z(); pokazEkran('ustawienia'); }
          } },
        ],
      });
    };
    const noweKonto = pole.querySelector('#u-nowe-konto');
    if (noweKonto) noweKonto.onclick = () => oknoKonta_admin(null);
    podepnijKontaGK(pole, ustawienia);
    pole.querySelectorAll('[data-konto]').forEach(b =>
      b.onclick = () => oknoKonta_admin(u.find(x => x.id === Number(b.dataset.konto))));
    pole.querySelectorAll('[data-odblokuj]').forEach(b => b.onclick = async () => {
      const w = await sprobuj(() => API.post(`/api/uzytkownicy/${b.dataset.odblokuj}/odblokuj`),
        'Odblokowano');
      if (w) pokazEkran('ustawienia');
    });
    pole.querySelector('#u-nowy-bus').onclick = () => oknoBusa(null);
    pole.querySelectorAll('[data-bus]').forEach(b =>
      b.onclick = () => oknoBusa(stan.pojazdy.find(x => x.id === Number(b.dataset.bus))));
  },
};

/* Logowanie z internetu (tunel): po 10 złych PIN-ach w 15 min konto czeka
   kwadrans, po trzech takich seriach w ciągu doby jest zamknięte z internetu,
   aż administrator kliknie „Odblokuj” (albo minie doba). Z firmowego wifi
   ta osoba wchodzi cały czas. */
function opisBlokadyZInternetu(s) {
  s = s || {};
  const godzina = String(s.do || '').slice(11, 16);
  let wynik = '';
  if (s.blokada === 'zablokowane') {
    wynik = `<br><span class="plakietka p-nieudane">zablokowane z internetu</span>
      <span class="male slaby">do odblokowania (najpóźniej ${escHtml(String(s.do || '').slice(0, 16))})</span>`;
  } else if (s.blokada === 'czeka') {
    wynik = `<br><span class="plakietka p-oczekuje">z internetu czeka do ${escHtml(godzina)}</span>`;
  }
  if (s.zle_godzina) {
    wynik += `<br><span class="male slaby">złe PIN-y z internetu w ostatniej godzinie: ${Number(s.zle_godzina)}</span>`;
  }
  return wynik;
}

function wstegaLogowaniaZInternetu(s) {
  if (!s) return '';
  const zablokowane = (s.zablokowane || []).filter(x => x.blokada === 'zablokowane');
  const zle = Number(s.zle_godzina || 0);
  if (!zablokowane.length && !zle) return '';
  return `<div class="wstega ${zablokowane.length ? 'blad' : 'uwaga'}">
    Złe PIN-y z internetu w ostatniej godzinie: <b>${zle}</b>.
    ${zablokowane.length ? `Zablokowane z internetu: <b>${zablokowane.map(x => escHtml(x.imie)).join(', ')}</b>
      — z firmowego wifi wchodzą normalnie; „Odblokuj” przy koncie zdejmuje blokadę.` : ''}</div>`;
}

function oknoKonta_admin(k) {
  const nowe = !k;
  k = k || { imie: '', login: '', rola: 'kierowca', telefon: '', aktywny: 1 };
  // Konto z Panelu: imię, rolę, telefon, PIN i aktywność prowadzi Panel →
  // Administracja. Pola są widoczne, ale zablokowane — tutaj tylko baza wyjazdowa.
  const zPanelu = !nowe && k.zrodlo === 'gk' && !!(stan.ustawienia || {}).konta_z_panelu;
  const blok = zPanelu ? 'disabled' : '';
  okno({
    tytul: nowe ? 'Nowe konto' : 'Konto: ' + k.imie,
    tresc: `
      ${zPanelu ? `<div class="wstega info">Konto z Panelu (GK Panel Kierownika). Imię, rolę,
        telefon, PIN i wyłączenie konta zmienia się w <b>Panelu → Administracja</b>.</div>` : ''}
      <label>Imię i nazwisko<input id="ko-imie" value="${escHtml(k.imie)}" autocapitalize="words" ${blok}></label>
      <label>Login ${nowe ? '' : '<span class="slaby">(nie da się zmienić)</span>'}
        <input id="ko-login" value="${escHtml(k.login)}" ${nowe ? '' : 'disabled'}
               autocapitalize="none" placeholder="np. marek"></label>
      <label>Rola
        <select id="ko-rola" ${blok}>
          <option value="kierowca" ${k.rola === 'kierowca' ? 'selected' : ''}>Kierowca — tylko swoje trasy i swój raport pracy</option>
          <option value="biuro" ${k.rola === 'biuro' ? 'selected' : ''}>Biuro — cała codzienna robota, bez Ustawień i kont</option>
          <option value="admin" ${k.rola === 'admin' ? 'selected' : ''}>Administrator — to co biuro, plus konta i Ustawienia</option>
        </select></label>
      <div class="male slaby" style="margin:-4px 0 10px">
        Biuro widzi trasy, klientów, dowody dostaw, ślady GPS i raporty pracy — może więc
        sprawdzać kierowców. Nie wejdzie do Ustawień, nie założy konta i nie skasuje
        klienta ani trasy.</div>
      <label>Telefon<input id="ko-telefon" value="${escHtml(k.telefon || '')}" inputmode="tel" ${blok}></label>
      <label>Domyślna baza wyjazdowa
        <select id="ko-baza">
          <option value="">— domyślna baza firmy —</option>
          ${(stan.lokalizacje || []).map(l =>
            `<option value="${l.id}" ${k.baza === l.id ? 'selected' : ''}>${escHtml(l.nazwa)}</option>`).join('')}
        </select></label>
      <p class="male slaby" style="margin:-4px 0 10px">Stąd program liczy kilometry i czas
        tras tego kierowcy, jeśli na samej trasie nie wskazano innego miejsca.</p>
      ${zPanelu ? '' : `<label>${nowe ? 'PIN kierowcy (min. 4 znaki) albo hasło biura (min. 8 znaków)'
          : 'Nowy PIN / hasło — zostaw puste, żeby nie zmieniać'}
        <input id="ko-pin" type="text" autocomplete="off"></label>`}
      ${nowe ? '' : `<label class="plaska"><input type="checkbox" id="ko-aktywny" ${k.aktywny ? 'checked' : ''} ${blok}>
        Konto aktywne</label>
        <p class="male slaby">Zmiana PIN-u wylogowuje tę osobę ze wszystkich urządzeń.</p>`}`,
    przyciski: [
      { napis: 'Anuluj', klik: z => z() },
      { napis: 'Zapisz', klasa: 'glowny', klik: async z => {
        const dane = {
          id: k.id, imie: val('ko-imie'), login: val('ko-login'),
          rola: document.getElementById('ko-rola').value, telefon: val('ko-telefon'),
          pin: zPanelu ? '' : val('ko-pin'),
          aktywny: nowe ? 1 : (document.getElementById('ko-aktywny').checked ? 1 : 0),
        };
        dane.baza = (document.getElementById('ko-baza') || {}).value || null;
        const w = await sprobuj(() => API.post('/api/uzytkownicy', dane), 'Zapisano');
        if (w) { stan.kierowcy = null; z(); pokazEkran('ustawienia'); }
      } },
    ],
  });
}

function oknoBusa(b) {
  const nowy = !b;
  b = b || { nazwa: '', rejestracja: '', uwagi: '', aktywny: 1, czas_pracy: 1 };
  okno({
    tytul: nowy ? 'Nowy bus' : b.nazwa,
    tresc: `
      <label>Nazwa <span class="slaby">(np. „Ducato", „Bus 1")</span>
        <input id="bu-nazwa" value="${escHtml(b.nazwa)}"></label>
      <label>Rejestracja<input id="bu-rej" value="${escHtml(b.rejestracja || '')}"></label>
      <label>Uwagi<textarea id="bu-uwagi">${escHtml(b.uwagi || '')}</textarea></label>
      <label class="plaska"><input type="checkbox" id="bu-czas-pracy"
        ${b.czas_pracy == null || Number(b.czas_pracy) ? 'checked' : ''}>
        Doliczaj przerwy kierowcy do tras tego pojazdu</label>
      <p class="male slaby" style="margin:-4px 0 10px">Odznacz tam, gdzie przerwy
        nie mają sensu — np. przy osobówce na krótkich kursach. Inaczej każda jej
        trasa wyjdzie dłuższa, niż wychodzi naprawdę.</p>
      ${nowy ? '' : `<label class="plaska"><input type="checkbox" id="bu-aktywny" ${b.aktywny ? 'checked' : ''}>
        Bus w użyciu</label>`}`,
    przyciski: [
      { napis: 'Anuluj', klik: z => z() },
      { napis: 'Zapisz', klasa: 'glowny', klik: async z => {
        const w = await sprobuj(() => API.post('/api/pojazdy', {
          id: b.id, nazwa: val('bu-nazwa'), rejestracja: val('bu-rej'), uwagi: val('bu-uwagi'),
          aktywny: nowy ? 1 : (document.getElementById('bu-aktywny').checked ? 1 : 0),
          czas_pracy: document.getElementById('bu-czas-pracy').checked ? 1 : 0,
        }), 'Zapisano');
        if (w) { z(); pokazEkran('ustawienia'); }
      } },
    ],
  });
}


/* --------------------------------------------- alarmy dla administratora */

/* Wstęgi alarmów (ETAP 2): kopia, token GitHuba, adres na Pages, dysk.
   Na pulpicie są klikalne i prowadzą do Ustawień, gdzie da się coś zrobić. */
function wstegiAlarmow(alarmy, doUstawien) {
  return (alarmy || []).map(a => `<div class="wstega ${a.poziom === 'blad' ? 'blad' : 'uwaga'}"
      style="margin-bottom:10px${doUstawien ? ';cursor:pointer' : ''}"
      ${doUstawien ? 'data-do-ustawien="1"' : ''}>
      <b>⚠ ${escHtml(a.tytul)}</b><br><span class="male">${escHtml(a.tresc)}</span></div>`).join('');
}


/* ------------------------------------------------------- kopie zapasowe */

function rozmiarCzytelnie(bajty) {
  const b = Number(bajty) || 0;
  if (b >= 1024 * 1024 * 1024) return (b / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(b / 1024)) + ' KB';
}

function kartaKopii(u) {
  const k = u.kopie || {};
  const l = k.lokalne || {};
  const kiedy = t => escHtml(String(t || '').slice(0, 16));
  const plakietka = !k.folder ? '<span class="plakietka p-oczekuje">tylko na tym dysku</span>'
    : (k.blad ? '<span class="plakietka p-nieudane">✕ błąd</span>'
      : k.ostatnia_udana ? '<span class="plakietka p-dostarczone">✓ działa</span>'
        : '<span class="plakietka p-w_toku">czeka na pierwszą kopię</span>');
  const stare = l.stare_archiwum || {};
  return zwin('Kopie zapasowe', plakietka, `
    <p class="male slaby">Program sam robi kopię raz na dobę: bazę i wszystkie zdjęcia
      i podpisy. Folder <code>kopie/</code> obok programu chroni przed pomyłką, ale leży na tym
      samym dysku — dlatego druga kopia idzie <b>poza ten komputer</b>.</p>

    ${k.blad ? `<div class="wstega blad">Ostatnia kopia poza komputerem (${kiedy(k.blad_kiedy)})
        nie udała się: ${escHtml(k.blad)}</div>` : ''}
    ${k.ten_sam_dysk ? `<div class="wstega uwaga">Ten folder leży na tym samym dysku co program.
        Ma to sens tylko wtedy, gdy to folder OneDrive (albo inny synchronizowany z chmurą) —
        zwykły folder na tym dysku przepadnie razem z nim.</div>` : ''}
    ${(k.pominiete || []).length ? `<div class="wstega uwaga">W folderze kopii są starsze, pełniejsze
        archiwa zdjęć niż tutaj (${escHtml(k.pominiete.join(', '))}) — zostawiam je bez zmian.
        To normalne po przeniesieniu programu na nowy komputer; brakujące zdjęcia przywróci
        <code>--przywroc</code> (instrukcja, punkt 15).</div>` : ''}
    ${l.blad ? `<div class="wstega blad">${escHtml(l.blad)}</div>` : ''}
    ${(l.uszkodzone || []).map(x => `<div class="wstega uwaga">${escHtml(x)}
        <span class="slaby">(${kiedy(l.uszkodzone_kiedy)})</span></div>`).join('')}
    ${stare.uszkodzone ? `<div class="wstega uwaga">Stare archiwum <code>kopie/pliki.zip</code>
        (sprzed podziału na miesiące) jest uszkodzone. Nowe kopie idą do archiwów miesięcznych
        i to im nie przeszkadza — stary plik możesz skasować.</div>` : ''}
    ${stare.nazwa && !stare.uszkodzone && Number(u.retencja_zalacznikow_mies) > 0
      ? `<div class="wstega uwaga">Stare archiwum <code>kopie/pliki.zip</code> nie podlega
        retencji — trzyma podpisy starsze niż ustawiony okres. Wszystko, co program jeszcze
        przechowuje, jest już w archiwach miesięcznych, więc ten plik możesz skasować.</div>` : ''}

    <table class="male" style="margin-bottom:10px">
      <tr><td class="slaby">Ostatnia kopia poza komputerem</td>
          <td><b>${k.ostatnia_udana ? kiedy(k.ostatnia_udana) : (k.folder ? 'jeszcze żadna' : '—')}</b>${
            k.plik ? ` · <code>${escHtml(k.plik)}</code> (${rozmiarCzytelnie(k.rozmiar)})` : ''}</td></tr>
      <tr><td class="slaby">Kopia w folderze kopie/</td>
          <td>${l.kiedy ? kiedy(l.kiedy) : '—'}${(l.archiwa || []).length
            ? ` · archiwa zdjęć: ${l.archiwa.length}` : ''}</td></tr>
    </table>

    <label>Folder kopii poza komputerem
      <input id="u-kopia-folder" value="${escHtml(k.folder || '')}" autocapitalize="none"
             placeholder="np. E:\\GK-kopie albo C:\\Users\\biuro\\OneDrive\\GK-kopie"></label>
    <div class="male slaby">Drugi dysk, pendrive na stałe w komputerze albo folder OneDrive.
      <b>Tylko na kopie — nigdy nie przenoś tam samego programu ani żywej bazy</b>
      (synchronizacja w chmurze psuje otwartą bazę). Trzymamy 7 kopii dziennych,
      4 tygodniowe i 12 miesięcznych. W kopii nie ma haseł ani kluczy (tokeny GitHuba
      i tunelu, klucze GK Flota i Panelu, hasła poczty i IKOL-a) — po przywróceniu wpisuje
      się je od nowa.</div>

    <div class="przyciski" style="margin-top:12px">
      <button class="glowny zapisz-ustawienia">Zapisz ustawienia</button>
      <button id="u-kopia-teraz">Zrób kopię teraz</button>
    </div>
    <p class="male slaby" style="margin-top:8px">Brak udanej kopii przez ponad dobę albo
      niedostępny folder włącza alarm: wstęgę na pulpicie i powiadomienie na telefonie
      administratora (najwyżej raz na 6 godzin). Jak przywrócić dane z kopii — instrukcja,
      punkt 15.</p>`);
}

function podepnijKopie(pole) {
  const teraz = pole.querySelector('#u-kopia-teraz');
  if (!teraz) return;
  teraz.onclick = async () => {
    // Najpierw zapis folderu wpisanego obok — inaczej kopia poszłaby do starego.
    const zapisane = await sprobuj(() => API.post('/api/ustawienia',
      { kopia_folder: val('u-kopia-folder') }));
    if (!zapisane) return;
    const w = await sprobuj(() => API.post('/api/kopie/teraz'));
    if (!w) return;
    if (w.trwa) komunikat('Kopia w toku — wynik zobaczysz tu za chwilę (odśwież Ustawienia)', 'ok');
    else if (w.blad) komunikat(w.blad, 'blad');
    else komunikat(w.folder ? `Kopia zrobiona: ${w.plik}` : 'Kopia zrobiona w folderze kopie/', 'ok');
    pokazEkran('ustawienia');
  };
}


/* ------------------------------------------------- dostęp z internetu */

/* Strażnik tunelu: „✓ działa” znaczy tylko, że program tunelu żyje. Czy adres
   naprawdę prowadzi do programu, sprawdza strażnik co 2 minuty — tak jak telefon. */
function straznikTunelu(s) {
  if (!s || !s.opis) return '';
  return s.odpowiada === false
    ? `<div class="wstega uwaga">${escHtml(s.opis)}</div>`
    : `<p class="male slaby">${escHtml(s.opis)}</p>`;
}

function kartaTunelu(u) {
  const tunel = u.tunel || {};
  const tryb = u.tunel_tryb || 'brak';
  const stanPlakietka = {
    dziala: '<span class="plakietka p-dostarczone">✓ działa</span>',
    uruchamiam: '<span class="plakietka p-w_toku">łączy się…</span>',
    blad: '<span class="plakietka p-nieudane">✕ błąd</span>',
    wylaczony: '<span class="plakietka p-oczekuje">wyłączony</span>',
  }[tunel.stan] || '';

  return zwin('Dostęp z internetu', stanPlakietka, `
    <p class="male slaby">Bez tunelu aplikacja działa tylko w firmowym wifi, a przeglądarki
      nie włączają wtedy pełnego trybu offline. Tunel daje adres <code>https://</code>
      bez stałego IP i bez otwierania portów w routerze.</p>

    ${tunel.adres ? `<div class="wstega info">
        Adres dla kierowców:<br><b style="font-size:15px;word-break:break-all">${escHtml(tunel.adres)}</b>
        <button class="maly" id="u-kopiuj-adres" style="margin-top:8px">Kopiuj adres</button>
      </div>` : ''}
    ${tunel.blad ? `<div class="wstega uwaga">${escHtml(tunel.blad)}</div>` : ''}
    ${straznikTunelu(tunel.straznik)}

    <label class="plaska"><input type="radio" name="tunel" value="brak" ${tryb === 'brak' ? 'checked' : ''}>
      <span><b>Wyłączony</b><br><span class="male slaby">Tylko firmowe wifi.
        Kierowca musi otworzyć aplikację na placu przed wyjazdem.</span></span></label>

    <label class="plaska"><input type="radio" name="tunel" value="szybki" ${tryb === 'szybki' ? 'checked' : ''}>
      <span><b>Szybki</b><br><span class="male slaby">Działa od razu, bez konta i bez
        domeny. <b>Adres zmienia się po każdym uruchomieniu programu</b> — dlatego
        telefony otwierają stały adres aplikacji na GitHub Pages, a program sam
        wpisuje tam bieżący adres tunelu (karta niżej).</span></span></label>

    <label class="plaska"><input type="radio" name="tunel" value="staly" ${tryb === 'staly' ? 'checked' : ''}>
      <span><b>Stały — do codziennej pracy</b><br><span class="male slaby">Własny, niezmienny
        adres (np. <code>trasy.twojafirma.pl</code>). Wymaga darmowego konta Cloudflare
        i domeny firmy dodanej do Cloudflare.</span></span></label>

    <label style="margin-top:12px">Token tunelu stałego
      <input id="u-tunel-token" placeholder="${u.tunel_token_ustawiony
        ? 'token jest zapisany — wpisz nowy, żeby zmienić' : 'wklej token z panelu Cloudflare'}">
    </label>
    <div class="male ${u.tunel_token_ustawiony ? '' : 'slaby'}">
      ${u.tunel_token_ustawiony ? '✓ Token zapisany' : 'Token nie jest ustawiony'}</div>
    <label style="margin-top:12px">Adres tunelu stałego
      <input id="u-tunel-adres" value="${escHtml(u.tunel_adres || '')}"
             placeholder="np. https://trasy.twojafirma.pl"></label>
    <div class="male slaby">Tylko w trybie stałym: ten sam adres, który ustawiono w panelu
      Cloudflare. Program wpisuje go aplikacji na GitHub Pages — sam go nie zna.</div>

    <details style="margin-top:12px">
      <summary class="male" style="cursor:pointer">Jak zdobyć token tunelu stałego</summary>
      <ol class="male slaby" style="padding-left:20px;line-height:1.8">
        <li>Załóż darmowe konto na <b>cloudflare.com</b> i dodaj do niego domenę firmy.</li>
        <li>Wejdź w <b>Zero Trust → Networks → Tunnels → Create a tunnel</b>,
            wybierz <b>Cloudflared</b> i nazwij tunel (np. „trasy").</li>
        <li>Cloudflare pokaże polecenie instalacyjne z długim tokenem —
            <b>skopiuj sam token</b> (ten długi ciąg znaków) i wklej go tutaj.</li>
        <li>W zakładce <b>Public Hostname</b> ustaw subdomenę (np. <code>trasy</code>),
            typ <b>HTTP</b> i adres <code>localhost:8770</code>.</li>
        <li>Zapisz ustawienia tutaj i uruchom program ponownie.</li>
      </ol>
    </details>

    <p class="male slaby" style="margin-top:10px">Zmiana trybu działa dopiero
      po zamknięciu i ponownym uruchomieniu programu.</p>
    <button class="glowny zapisz-ustawienia">Zapisz ustawienia</button>`);
}

function zmienionoTunel(poprzednie) {
  const wybrany = (document.querySelector('input[name=tunel]:checked') || {}).value || 'brak';
  return wybrany !== (poprzednie.tunel_tryb || 'brak') || !!val('u-tunel-token');
}


/* ------------------------------------------- aplikacja na GitHub Pages (D33) */

/* Telefony otwierają STAŁY adres na GitHub Pages; tam leży sam wygląd
   aplikacji, a dane wydaje ten program pod adresem tunelu. Adres tunelu
   program wpisuje tam sam (adres.json) przy każdym uruchomieniu — człowiek
   naciska „Wyślij aplikację na GitHub” tylko po aktualizacji programu.      */
function kartaPages(u) {
  const p = u.pages || {};
  const plakietka = !p.repo ? '<span class="plakietka p-oczekuje">wyłączone</span>'
    : !p.token_ustawiony ? '<span class="plakietka p-oczekuje">brak tokenu</span>'
      : !p.opublikowano ? '<span class="plakietka p-oczekuje">nie wysłano</span>'
        : p.starsza ? '<span class="plakietka p-nieudane">starsza wersja</span>'
          : '<span class="plakietka p-dostarczone">✓ aktualna</span>';
  const kiedy = t => escHtml(String(t || '').slice(0, 16));
  const tw = p.token_waznosc || {};
  return zwin('Aplikacja na GitHub Pages', plakietka, `
    <p class="male slaby">Stały adres aplikacji dla telefonów — ten sam po każdym restarcie
      komputera w biurze. Na GitHubie leży sam wygląd, bez żadnych danych firmy; dane
      zostają tutaj, a telefony łączą się z nimi przez tunel.</p>

    ${p.adres ? `<div class="wstega info">Adres dla telefonów:<br>
        <a href="${escHtml(p.adres)}" target="_blank" rel="noopener"
           style="font-size:15px;word-break:break-all"><b>${escHtml(p.adres)}</b></a></div>` : ''}

    ${p.starsza ? `<div class="wstega uwaga"><b>Wyślij aplikację na GitHub — na Pages jest
        starsza wersja.</b> Telefony chodzą na wersji <code>${escHtml(p.wersja_na_pages)}</code>,
        program w biurze ma <code>${escHtml(p.wersja_programu)}</code>.</div>` : ''}
    ${p.blad ? `<div class="wstega uwaga">Ostatnia próba wpisania adresu tunelu na GitHub
        (${kiedy(p.blad_kiedy)}) nie udała się: ${escHtml(p.blad)}
        Program ponawia ją sam — najpierw co minutę, potem co kilka minut, aż do skutku.</div>` : ''}
    ${tw.ostrzezenie ? `<div class="wstega ${tw.wygasl ? 'blad' : 'uwaga'}"><b>${tw.wygasl
        ? 'Token GitHuba wygasł' : `Token GitHuba wygasa ${escHtml(tw.wygasa)}`}</b> —
        zrób nowy (instrukcja niżej) i wklej go w pole „Token GitHuba”. Bez ważnego tokenu po
        najbliższym restarcie komputera telefony nie znajdą programu.</div>` : ''}

    <table class="male" style="margin-bottom:10px">
      <tr><td class="slaby">Ostatnio wysłano aplikację</td>
          <td><b>${p.opublikowano ? kiedy(p.opublikowano) : 'jeszcze nigdy'}</b></td></tr>
      <tr><td class="slaby">Wersja na Pages</td>
          <td><code>${escHtml(p.wersja_na_pages || '—')}</code>${p.opublikowano && !p.starsza
            ? ' — ta sama co w programie' : ''}</td></tr>
      <tr><td class="slaby">Adres danych na Pages</td>
          <td>${p.adres_api ? `<code style="word-break:break-all">${escHtml(p.adres_api)}</code>
            ${p.adres_aktualny ? '✓' : '<span class="slaby">(inny niż bieżący tunel)</span>'}`
            : '—'}${p.adres_zmieniono ? ` <span class="slaby">· ${kiedy(p.adres_zmieniono)}</span>` : ''}</td></tr>
    </table>

    <div class="dwie">
      <label>Repozytorium <span class="slaby">(właściciel/nazwa)</span>
        <input id="u-github-repo" value="${escHtml(u.github_repo || '')}"
               placeholder="milo252-gk/gk-trasy-aplikacja" autocapitalize="none"></label>
      <label>Gałąź
        <input id="u-github-galaz" value="${escHtml(u.github_galaz || 'main')}"
               placeholder="main" autocapitalize="none"></label>
    </div>
    <label>Token GitHuba
      <input id="u-github-token" type="password" autocomplete="new-password"
             placeholder="${u.github_token_ustawiony
               ? 'token jest zapisany — wpisz nowy, żeby zmienić' : 'wklej token (github_pat_…)'}"></label>
    <div class="male ${u.github_token_ustawiony ? '' : 'slaby'}">
      ${u.github_token_ustawiony ? '✓ Token zapisany' : 'Token nie jest ustawiony'}${tw.wygasa
        ? ` · ważny do <b>${escHtml(tw.wygasa)}</b>` : ''}</div>

    <details style="margin-top:12px">
      <summary class="male" style="cursor:pointer">Jak zrobić token (raz, 3 minuty)</summary>
      <ol class="male slaby" style="padding-left:20px;line-height:1.8">
        <li>Zaloguj się na <b>github.com</b> kontem firmy (milo252-gk).</li>
        <li>Wejdź w <b>Settings → Developer settings → Personal access tokens →
            Fine-grained tokens → Generate new token</b>.</li>
        <li>Nazwa: np. „GK Trasy — komputer w biurze”. Ważność: najdłuższa dostępna
            (zapisz w kalendarzu, kiedy wygasa).</li>
        <li><b>Repository access → Only select repositories</b> → wybierz
            <code>gk-trasy-aplikacja</code> (tylko to jedno).</li>
        <li><b>Permissions → Repository permissions → Contents: Read and write</b>.
            Nic więcej nie zaznaczaj.</li>
        <li><b>Generate token</b>, skopiuj go i wklej tutaj, potem <b>Zapisz ustawienia</b>.</li>
      </ol>
      <p class="male slaby">Token zostaje w bazie programu i nigdy nie wraca do przeglądarki.
        Pozwala wyłącznie podmienić pliki aplikacji w tym jednym repozytorium.</p>
    </details>

    <div class="przyciski" style="margin-top:12px">
      <button class="glowny zapisz-ustawienia">Zapisz ustawienia</button>
      <button id="u-github-wyslij">Wyślij aplikację na GitHub</button>
      ${u.github_token_ustawiony ? '<button id="u-github-zapomnij">Usuń token</button>' : ''}
    </div>
    <p class="male slaby" style="margin-top:8px">„Wyślij aplikację na GitHub” naciskasz po
      aktualizacji programu. Nowy adres tunelu (po każdym uruchomieniu) program wpisuje
      na GitHub sam. Po wysłaniu telefony dostają nową wersję w ciągu kilku minut.</p>`);
}

function podepnijPages(pole) {
  const wyslij = pole.querySelector('#u-github-wyslij');
  if (wyslij) wyslij.onclick = async () => {
    // Najpierw zapis tego, co wpisano obok — inaczej wysyłka szłaby ze starym
    // tokenem albo do starego repozytorium i mówiła „podaj token” przy pełnym polu.
    const zapisane = await sprobuj(() => API.post('/api/ustawienia', {
      github_repo: val('u-github-repo'), github_galaz: val('u-github-galaz'),
      github_token: val('u-github-token'),
    }));
    if (!zapisane) return;
    if (!await potwierdz('Wysłać aplikację na GitHub?',
      'Na publiczny GitHub idzie sam wygląd aplikacji (pliki z folderu web) i bieżący adres '
      + 'tunelu. Żadne dane firmy tam nie trafiają. Telefony dostaną tę wersję w ciągu kilku minut.',
      { tak: 'Wyślij' })) return;
    const w = await sprobuj(() => API.post('/api/github/wyslij'));
    if (!w) return;
    komunikat(`Wysłano ${w.plikow} ${odmiana(w.plikow, 'plik', 'pliki', 'plików')} na GitHub`
      + (w.pominiete && w.pominiete.length
        ? ` (pominięte, bo nie są plikami aplikacji: ${w.pominiete.join(', ')})` : ''), 'ok');
    pokazEkran('ustawienia');
  };
  const zapomnij = pole.querySelector('#u-github-zapomnij');
  if (zapomnij) zapomnij.onclick = async () => {
    if (!await potwierdz('Usunąć token GitHuba?',
      'Aplikacja na GitHub Pages zostaje, ale program przestanie sam wpisywać tam nowy adres '
      + 'tunelu — po najbliższym restarcie telefony nie znajdą danych, dopóki nie wkleisz '
      + 'nowego tokenu.', { tak: 'Usuń', groznie: true })) return;
    const w = await sprobuj(() => API.post('/api/github/zapomnij'), 'Token usunięty');
    if (w) pokazEkran('ustawienia');
  };
}


/* --------------------------------------- lokalizatory GPS w busach (IKOL) */

function kartaIkol(u) {
  const s = u.ikol_stan || {};
  const wlaczony = u.ikol_wlaczony === '1';
  const lokalizatory = stan._lokalizatory || [];
  const stanPlakietka = !wlaczony ? '<span class="plakietka p-oczekuje">wyłączona</span>'
    : s.stan === 'dziala' ? '<span class="plakietka p-dostarczone">✓ pobiera pozycje</span>'
    : s.stan === 'blad' ? '<span class="plakietka p-nieudane">✕ błąd</span>'
    : '<span class="plakietka p-w_toku">czeka na pierwsze pobranie</span>';

  return zwin('Lokalizatory w busach (IKOL)', stanPlakietka, `
    <p class="male slaby">Program potrafi sam pobierać pozycje z Waszych lokalizatorów
      w <b>system.ikol.pl</b> i pokazywać je na Pulpicie obok potwierdzeń dostaw —
      bez przełączania się między dwiema stronami. Pyta o pozycję co półtorej minuty,
      z zapasem względem limitów IKOL-a.</p>

    <div class="wstega uwaga">W IKOL-u są <b>dwie różne rzeczy o nazwie „Interfejs API"</b>
      i potrzebne są obie. To była przyczyna odmów przy pierwszym podejściu.</div>
    <ol class="male slaby" style="margin:0 0 12px 18px; padding:0">
      <li><b>Uprawnienie użytkownika — bezpłatne.</b><br>
        MENU → Konfiguracja → Konfiguracja lokalizatorów → przy pojeździe
        „Uprawnienia użytkowników" → kolumna <b>Interfejs API</b> → zaznaczyć → Zapisz.<br>
        <i>U Was włączone przy czterech lokalizatorach 1.09.2026.</i></li>
      <li><b>Usługa dodatkowa — płatna, 10 zł netto miesięcznie ZA KAŻDY lokalizator.</b><br>
        IKOL → Wybór usług → Zarządzaj usługami → sekcja <b>Dodatki</b> → pozycja
        nr 58 „Interfejs API".<br>
        <i>U Was wyłączona przy wszystkich czterech (stan z 1.09.2026).</i></li>
    </ol>
    <p class="male slaby">Bez wykupionej usługi API odpowiada kodem 3 — tym samym,
      co przy złym haśle. Dlatego łatwo wziąć to za pomyłkę w loginie.
      <b>Nie musicie wykupywać jej dla wszystkich pojazdów</b> — wystarczy dla tych,
      które faktycznie wożą dostawy.</p>
    <p class="male slaby">Póki tego nie ma, położenie busów i tak działa —
      bezpłatnie, z telefonu kierowcy (ekran „Moje zlecenie” → „Udostępniaj położenie”).</p>

    <label class="plaska"><input type="checkbox" id="u-ikol-wlaczony" ${wlaczony ? 'checked' : ''}>
      <b>Pobieraj pozycje z IKOL-a</b></label>

    <div class="dwie">
      <label>Login do IKOL-a<input id="u-ikol-login" value="${escHtml(u.ikol_login || '')}"
        autocapitalize="none" placeholder="ten sam co na system.ikol.pl"></label>
      <label>Hasło<input id="u-ikol-haslo" type="password" autocomplete="new-password"
        placeholder="${u.ikol_ustawiony ? 'hasło jest zapisane — wpisz nowe, żeby zmienić' : 'hasło do IKOL-a'}"></label>
    </div>
    <label>Klucz aplikacji (appkey) <span class="slaby">— jeśli IKOL go od Was wymaga</span>
      <input id="u-ikol-appkey" placeholder="wygenerowany w panelu IKOL"></label>

    <div class="przyciski" style="margin-top:10px">
      <button id="u-ikol-sprawdz">Sprawdź połączenie i pobierz listę</button>
      ${lokalizatory.length ? '<button id="u-ikol-pobierz">Pobierz pozycje teraz</button>' : ''}
      ${u.ikol_ustawiony ? '<button id="u-ikol-zapomnij">Usuń zapisane hasło</button>' : ''}
    </div>
    ${s.blad ? `<div class="wstega uwaga" style="margin-top:12px">${escHtml(s.blad)}</div>` : ''}
    ${s.ostatnio && wlaczony ? `<div class="male slaby" style="margin-top:8px">
      Ostatnie sprawdzenie: ${escHtml(s.ostatnio)}</div>` : ''}

    ${lokalizatory.length ? `
      <h3 style="margin-top:18px">Które busy</h3>
      <p class="male slaby">Przypisz każdy lokalizator do busa albo wprost do kierowcy —
        bez tego program nie wie, czyją trasę zapisać.</p>
      <div class="tabela-przewijana"><table>
        <thead><tr><th>Lokalizator</th><th>Bus</th><th>Kierowca</th><th>Ostatnia pozycja</th><th></th></tr></thead>
        <tbody>${lokalizatory.map(l => `<tr style="${l.aktywny ? '' : 'opacity:.5'}">
          <td><b>${escHtml(l.nazwa || l.klucz)}</b>
              ${l.nazwa ? `<br><span class="male slaby">${escHtml(l.klucz)}</span>` : ''}</td>
          <td>${escHtml(l.pojazd_nazwa || '—')}</td>
          <td>${escHtml(l.kierowca_imie || (l.pojazd_nazwa ? 'wg trasy na dziś' : '—'))}</td>
          <td class="male">${escHtml(l.ostatnio_o || 'jeszcze nic')}</td>
          <td><button class="maly" data-lokalizator="${escHtml(l.klucz)}">Przypisz</button></td>
        </tr>`).join('')}</tbody>
      </table></div>` : ''}

    <details style="margin-top:12px">
      <summary class="male" style="cursor:pointer">Czego potrzeba po stronie IKOL-a</summary>
      <ul class="male slaby" style="padding-left:20px;line-height:1.8">
        <li><b>Płatna usługa „Interfejs API"</b> włączona przy każdym lokalizatorze,
            z którego chcecie brać pozycje: IKOL → <b>Wybór usług</b> → <b>Zarządzaj
            usługami</b> → sekcja <b>Dodatki</b>. Kosztuje 10 zł netto miesięcznie
            za pojazd. <b>Bez tego API odmawia dostępu</b>, nawet przy poprawnym haśle.</li>
        <li><b>Uprawnienie „Interfejs API"</b> dla użytkownika przy każdym lokalizatorze:
            Konfiguracja → Konfiguracja lokalizatorów → Uprawnienia użytkowników →
            ostatnia kolumna. To jest bezpłatne, ale samo w sobie nie wystarcza.</li>
        <li><b>Klucz aplikacji (appkey)</b> nie jest potrzebny — według specyfikacji IKOL-a
            służy tylko do powiadomień push. Pole zostaw puste.</li>
        <li>Hasło zapisuje się w pliku <code>dane.db</code> w folderze programu —
            tak samo jak reszta danych firmy. Trzymaj ten folder tam, gdzie inne
            dane firmowe.</li>
      </ul>
    </details>`);
}

function oknoLokalizatora(klucz) {
  const l = (stan._lokalizatory || []).find(x => x.klucz === klucz);
  if (!l) return;
  const busy = stan.pojazdy.filter(p => p.aktywny || p.id === l.pojazd);
  const kierowcy = (stan._kierowcy || []).filter(k => k.rola === 'kierowca');

  okno({
    tytul: l.nazwa || klucz,
    tresc: `
      <label>Bus
        <select id="lk-pojazd">
          <option value="">— nie przypisano —</option>
          ${busy.map(b => `<option value="${b.id}" ${l.pojazd === b.id ? 'selected' : ''}>
            ${escHtml(b.nazwa)}${b.rejestracja ? ' · ' + escHtml(b.rejestracja) : ''}</option>`).join('')}
        </select></label>
      <label>Kierowca na stałe <span class="slaby">(zostaw puste, jeśli busem jeżdżą różni —
        wtedy program bierze kierowcę z trasy na dany dzień)</span>
        <select id="lk-kierowca">
          <option value="">— wg trasy na dany dzień —</option>
          ${kierowcy.map(k => `<option value="${k.id}" ${l.kierowca === k.id ? 'selected' : ''}>${escHtml(k.imie)}</option>`).join('')}
        </select></label>
      <label class="plaska"><input type="checkbox" id="lk-aktywny" ${l.aktywny ? 'checked' : ''}>
        Pobieraj pozycje z tego lokalizatora</label>`,
    przyciski: [
      { napis: 'Anuluj', klik: z => z() },
      { napis: 'Zapisz', klasa: 'glowny', klik: async z => {
        const w = await sprobuj(() => API.post('/api/ikol/lokalizatory', {
          klucz,
          pojazd: document.getElementById('lk-pojazd').value || null,
          kierowca: document.getElementById('lk-kierowca').value || null,
          aktywny: document.getElementById('lk-aktywny').checked ? 1 : 0,
        }), 'Zapisano');
        if (w) { z(); pokazEkran('ustawienia'); }
      } },
    ],
  });
}


/* ---------------------------------------------- GK Flota (GK Transport) */

/* Połączenie z programem floty. Umowa między programami: GK-TRANSPORT.md.
   Klucz tworzy administrator GK Flota, tutaj się go tylko wkleja. Stan pokazuje
   to, co admin musi wiedzieć bez zaglądania do dziennika: czy konta kierowców
   doszły i czy któryś raport utknął.                                        */
function kartaFlotexu(u) {
  const s = u.flotex_stan || {};
  const konta = s.kierowcy || {};
  const wynik = konta.wynik || {};
  const kolejka = s.kolejka || {};
  const plakietka = !u.flotex_klucz_ustawiony
    ? '<span class="plakietka p-oczekuje">niepołączony</span>'
    : s.uwaga ? '<span class="plakietka p-nieudane">wymaga uwagi</span>'
    : (konta.blad || (s.pojazdy || {}).blad)
      ? '<span class="plakietka p-nieudane">✕ błąd</span>'
      : konta.kiedy ? '<span class="plakietka p-dostarczone">✓ połączony</span>'
      : '<span class="plakietka p-w_toku">łączy się</span>';

  return zwin('GK Flota (GK Transport)', plakietka, `
    <p class="male slaby">GK Flota prowadzi przeglądy, terminy i usterki aut. Po połączeniu
      planista widzi przy busach, czy auto jest sprawne, kierowca ma w menu „Moje auto”
      (GK Flota bez drugiego logowania), a przebieg, tankowania i usterki z raportu
      pracy same trafiają do GK Flota. Konta kierowców zakłada się tylko tutaj —
      GK Flota dostaje je sama, z tym samym loginem i PIN-em.</p>
    <p class="male slaby">Adres: <b>http://127.0.0.1:8780</b>, gdy GK Flota działa na tym
      komputerze, albo <b>https://…</b> (tunel). Zwykłe <b>http://</b> do innego komputera
      jest zablokowane — klucz i PIN-y kierowców szłyby otwartym tekstem.</p>
    <div class="dwie">
      <label>Adres GK Flota
        <input id="u-flotex-adres" value="${escHtml(u.flotex_adres || '')}"
               autocapitalize="none" placeholder="http://127.0.0.1:8780"></label>
      <label>Klucz połączenia
        <input id="u-flotex-klucz" type="password" autocomplete="new-password"
               placeholder="${u.flotex_klucz_ustawiony
                 ? 'klucz jest zapisany — wklej nowy, żeby zmienić'
                 : 'z GK Flota: Ustawienia → Połączenie z GK Trasy'}"></label>
    </div>
    <div class="male ${u.flotex_klucz_ustawiony ? '' : 'slaby'}">
      ${u.flotex_klucz_ustawiony ? '✓ Klucz ustawiony' : 'Klucz nie jest ustawiony'}</div>
    <div class="przyciski" style="margin-top:10px">
      <button class="glowny zapisz-ustawienia">Zapisz ustawienia</button>
      <button id="u-flotex-sprawdz">Sprawdź połączenie</button>
      ${u.flotex_klucz_ustawiony ? '<button id="u-flotex-zapomnij">Odłącz</button>' : ''}
    </div>
    ${u.flotex_klucz_ustawiony ? `
      ${s.uwaga ? `<div class="wstega blad" style="margin-top:12px">Połączenie z GK Flota
        wymaga uwagi: ${escHtml(s.uwaga.komunikat || '')}
        <div class="male">Raporty czekają w kolejce i pójdą same, gdy połączenie znów
        zadziała.</div></div>` : ''}
      <h3 style="margin-top:18px">Konta kierowców</h3>
      ${konta.blad ? `<div class="wstega uwaga">${escHtml(konta.blad)}</div>` : ''}
      <div class="male slaby">${wynik.pusta && !konta.blad
        ? 'Nie ma jeszcze kont kierowców — nie ma czego wysyłać.'
        : konta.kiedy && !konta.blad
        ? `Ostatnio wysłane ${escHtml(konta.kiedy)}: ${wynik.wyslano || 0}
           ${odmiana(wynik.wyslano || 0, 'konto', 'konta', 'kont')}`
          + ` (nowe ${wynik.dodane || 0}, zmienione ${wynik.zmienione || 0},
           wyłączone ${wynik.wylaczone || 0}, przejęte ${wynik.przejete || 0}).`
        : konta.kiedy ? `Ostatnia próba ${escHtml(konta.kiedy)}.`
        : 'Jeszcze nie wysłane — pójdą za chwilę.'} Wysyłają się same po każdej zmianie
        konta kierowcy i co 10 minut.</div>
      ${(wynik.konflikty || []).length ? `<div class="wstega uwaga" style="margin-top:8px">
        Te loginy są w GK Flota zajęte przez konta biura, więc tych kierowców GK Flota nie
        przyjęła: <b>${wynik.konflikty.map(escHtml).join(', ')}</b>. Zmień login w jednym
        z programów.</div>` : ''}
      ${(s.pojazdy || {}).blad ? `<div class="wstega uwaga" style="margin-top:8px">
        Stan aut: ${escHtml(s.pojazdy.blad)}</div>` : ''}

      <h3 style="margin-top:18px">Raporty do GK Flota</h3>
      <div class="male">Czeka: <b>${kolejka.czeka || 0}</b> ·
        odrzucone: <b>${kolejka.odrzucone || 0}</b> · wysłane: ${kolejka.wyslane || 0}</div>
      ${(kolejka.problemy || []).length ? `<div class="tabela-przewijana" style="margin-top:8px"><table>
        <thead><tr><th>Raport</th><th>Stan</th><th>Powód</th></tr></thead>
        <tbody>${kolejka.problemy.map(p => `<tr>
          <td>${escHtml(p.imie || '')} ${p.data ? escHtml(polskaData(p.data)) : escHtml(p.klucz)}</td>
          <td>${p.wyslany ? '<span class="plakietka p-planowana">wysłany z uwagą</span>'
            : p.odrzucone ? '<span class="plakietka p-nieudane">odrzucony</span>'
            : [401, 403, 409].includes(p.kod_http)
              ? '<span class="plakietka p-oczekuje">czeka na połączenie</span>'
            : '<span class="plakietka p-w_toku">ponawiam</span>'}</td>
          <td class="male">${escHtml(p.blad)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="male slaby">Odrzucony raport nie wraca sam — popraw przyczynę (np. dopisz
        auto w GK Flota albo rejestrację busa tutaj) i kliknij „Ponów wysyłkę”.</p>
      <button id="u-flotex-ponow">Ponów wysyłkę</button>` : ''}` : ''}`);
}


/* ------------------------------------- Konta GK z Panelu (GK-KONTA.md) */

/* Jedno konto osoby we wszystkich aplikacjach GK, zakładane w Panelu →
   Administracja (decyzja właściciela 2026-10-02). Tutaj admin wkleja adres
   i klucz Panelu; program sam pobiera konta co 5 minut. „Przenieś konta do
   Panelu” to jednorazowe przeniesienie kont założonych dotąd tutaj — z ich
   PIN-ami (jadą tylko skróty, PIN się nie zmienia).                         */
function kartaKontGK(u) {
  const s = u.hub_stan || {};
  const w = s.wynik || {};
  const imp = s.import;
  const plakietka = !u.hub_klucz_ustawiony || !u.hub_adres
    ? '<span class="plakietka p-oczekuje">niepołączony</span>'
    : s.uwaga ? '<span class="plakietka p-nieudane">wymaga uwagi</span>'
    : s.blad ? '<span class="plakietka p-nieudane">✕ błąd</span>'
    : s.kiedy ? '<span class="plakietka p-dostarczone">✓ połączony</span>'
    : '<span class="plakietka p-w_toku">łączy się</span>';
  return zwin('Konta GK (Panel Kierownika)', plakietka, `
    <p class="male slaby">Konta wszystkich aplikacji GK zakłada się w jednym miejscu:
      <b>Panel → Administracja</b>. Osoba loguje się wszędzie imieniem i nazwiskiem i tym
      samym PIN-em. Program pobiera konta z Panelu co 5 minut i trzyma ich kopię — logowanie
      działa dalej, gdy Panel chwilowo nie odpowiada.</p>
    <p class="male slaby">Adres: <b>http://127.0.0.1:8790</b>, gdy Panel działa na tym
      komputerze, albo <b>https://…</b>. Klucz tworzy administrator w Panelu →
      Administracja → Połączenia GK (osobny dla GK Trasy).</p>
    <div class="dwie">
      <label>Adres Panelu
        <input id="u-hub-adres" value="${escHtml(u.hub_adres || '')}"
               autocapitalize="none" placeholder="http://127.0.0.1:8790"></label>
      <label>Klucz Panelu
        <input id="u-hub-klucz" type="password" autocomplete="new-password"
               placeholder="${u.hub_klucz_ustawiony
                 ? 'klucz jest zapisany — wklej nowy, żeby zmienić'
                 : 'z Panelu: Administracja → Połączenia GK'}"></label>
    </div>
    <div class="male ${u.hub_klucz_ustawiony ? '' : 'slaby'}">
      ${u.hub_klucz_ustawiony ? '✓ Klucz ustawiony' : 'Klucz nie jest ustawiony'}</div>
    <div class="przyciski" style="margin-top:10px">
      <button class="glowny zapisz-ustawienia">Zapisz ustawienia</button>
      <button id="u-hub-sprawdz">Sprawdź</button>
      ${u.hub_klucz_ustawiony ? `<button id="u-hub-pobierz">Pobierz teraz</button>
        <button id="u-hub-zapomnij">Odłącz</button>` : ''}
    </div>
    ${u.hub_klucz_ustawiony ? `
      ${s.uwaga ? `<div class="wstega blad" style="margin-top:12px">${escHtml(s.uwaga)}</div>`
        : s.blad ? `<div class="wstega uwaga" style="margin-top:12px">${escHtml(s.blad)}</div>` : ''}
      <div class="male" style="margin-top:10px">${s.kiedy && !s.blad
        ? `Ostatnio pobrane ${escHtml(s.kiedy)}: ${w.konta || 0}
           ${odmiana(w.konta || 0, 'osoba', 'osoby', 'osób')} z rolą GK Trasy
           (nowe ${w.dodane || 0}, połączone ${w.polaczone || 0}, zmienione ${w.zmienione || 0},
           wyłączone ${w.wylaczone || 0}).`
        : s.kiedy ? `Ostatnia próba ${escHtml(s.kiedy)}.` : 'Jeszcze nie pobrane — pójdą za chwilę.'}
        Kont z Panelu tutaj: <b>${s.z_panelu || 0}</b> · tutejszych czynnych: ${s.tutejsze || 0}.</div>
      ${(s.bez_pinu || []).length ? `<div class="wstega uwaga" style="margin-top:8px">
        Bez PIN-u (ustaw go w Panelu albo niech ta osoba zaloguje się raz w aplikacji GK na hali):
        <b>${s.bez_pinu.map(escHtml).join(', ')}</b></div>` : ''}
      ${(w.ostrzezenia || []).length ? `<div class="wstega uwaga" style="margin-top:8px">
        ${w.ostrzezenia.map(x => `<div>${escHtml(x)}</div>`).join('')}</div>` : ''}

      <h3 style="margin-top:18px">Przenieś konta do Panelu</h3>
      <p class="male slaby">Jednorazowo: konta założone dotąd tutaj trafiają do Panelu razem
        z PIN-ami (jadą tylko skróty — nikt nie musi zmieniać PIN-u). Osoba, która już jest
        w Panelu pod tym samym imieniem i nazwiskiem, dostaje tylko rolę GK Trasy. Najpierw
        popraw w kontach <b>pełne imię i nazwisko</b> — to w Panelu jest login. Konto awaryjne
        „admin” zostaje tutaj. Powtórne przeniesienie niczego nie dubluje.</p>
      <button id="u-hub-przenies">Przenieś konta do Panelu</button>
      ${imp ? `<div class="male" style="margin-top:8px">Przeniesiono ${escHtml(imp.kiedy || '')}:
        nowe ${imp.dodane || 0}, połączone ${imp.polaczone || 0},
        konflikty ${(imp.konflikty || []).length}.</div>
        ${(imp.konflikty || []).length ? `<div class="wstega uwaga" style="margin-top:8px">
          ${imp.konflikty.map(k => `<div><b>${escHtml(k.login)}</b>${k.powod
            ? ' — ' + escHtml(k.powod) : ''}</div>`).join('')}</div>` : ''}` : ''}` : ''}`);
}

function podepnijKontaGK(pole, ustawienia) {
  const przycisk = id => pole.querySelector('#' + id);
  const sprawdz = przycisk('u-hub-sprawdz');
  // Jak przy GK Flota: najpierw zapis tego, co wpisano obok, potem pytanie —
  // inaczej sprawdzalibyśmy stary klucz z bazy.
  if (sprawdz) sprawdz.onclick = async () => {
    if (!val('u-hub-adres')) { komunikat('Wpisz adres Panelu', 'blad'); return; }
    if (!val('u-hub-klucz') && !ustawienia.hub_klucz_ustawiony) {
      komunikat('Wklej klucz z Panelu (Administracja → Połączenia GK)', 'blad');
      return;
    }
    const zapisane = await sprobuj(() => API.post('/api/ustawienia', {
      hub_adres: val('u-hub-adres'), hub_klucz: val('u-hub-klucz'),
    }));
    if (!zapisane) return;
    const w = await sprobuj(() => API.post('/api/konta-gk/sprawdz'));
    if (w) komunikat(w.komunikat, 'ok');
    pokazEkran('ustawienia');
  };
  const pobierz = przycisk('u-hub-pobierz');
  if (pobierz) pobierz.onclick = async () => {
    const w = await sprobuj(() => API.post('/api/konta-gk/pobierz'));
    if (w) {
      const x = w.wynik || {};
      komunikat(`Pobrano ${x.konta || 0} ${odmiana(x.konta || 0, 'konto', 'konta', 'kont')} z Panelu`
        + ` (nowe ${x.dodane || 0}, połączone ${x.polaczone || 0}, wyłączone ${x.wylaczone || 0})`, 'ok');
      pokazEkran('ustawienia');
    }
  };
  const przenies = przycisk('u-hub-przenies');
  if (przenies) przenies.onclick = async () => {
    if (!await potwierdz('Przenieść konta do Panelu?',
      'Konta założone tutaj (oprócz awaryjnego „admin”) trafią do Panelu → Administracja '
      + 'z obecnymi PIN-ami. Od tej chwili zmienia się je w Panelu.')) return;
    const w = await sprobuj(() => API.post('/api/konta-gk/przenies'));
    if (w) {
      komunikat(`Przeniesiono: nowe ${w.dodane}, połączone ${w.polaczone}, konflikty `
        + `${(w.konflikty || []).length}`, (w.konflikty || []).length ? 'blad' : 'ok');
      setTimeout(() => { if (stan.ekran === 'ustawienia') pokazEkran('ustawienia'); }, 1500);
    }
  };
  const odlacz = przycisk('u-hub-zapomnij');
  if (odlacz) odlacz.onclick = async () => {
    if (!await potwierdz('Odłączyć GK Trasy od Panelu?',
      'Program zapomni klucz Panelu. Konta z Panelu zostają i działają, ale od teraz '
      + 'zmienia się je tutaj — Panel przestanie je aktualizować.')) return;
    const w = await sprobuj(() => API.post('/api/konta-gk/zapomnij'), 'Odłączono');
    if (w) pokazEkran('ustawienia');
  };
}


/* Ustawienia to osiem sekcji, z ktorych na co dzien dotyka sie dwoch. Reszta
   ma byc pod reka, ale nie ma zajmowac ekranu — stad sekcje zwijane.        */
function zwin(tytul, plakietka, tresc) {
  return `<details class="karta karta-zwijana">
    <summary><span>${escHtml(tytul)}</span>${plakietka || ''}</summary>
    <div class="zwijana-tresc">${tresc}</div>
  </details>`;
}


/* ------------------------------------------- powiadomienie klienta e-mailem */

function oknoPowiadomienia(p) {
  const klient = (stan.klienci || []).find(k => k.id === p.klient) || {};
  if (!(klient.email || '').trim()) {
    komunikat('Ten klient nie ma zapisanego adresu e-mail — uzupełnij go w kartotece', 'blad');
    return;
  }
  const okno_txt = (p.okno_od || p.okno_do) ? `${p.okno_od || '…'}–${p.okno_do || '…'}` : '';
  okno({
    tytul: 'Powiadom klienta',
    tresc: `
      <p>Wiadomość pójdzie na <b>${escHtml(klient.email)}</b>.</p>
      <label>Kiedy planujecie być <span class="slaby">(trafi do treści)</span>
        <input id="pw-okno" value="${escHtml(p.eta ? 'ok. ' + p.eta : okno_txt)}"
               placeholder="np. 12:30–13:00"></label>
      <p class="male slaby">Treść składa program: nazwa firmy, dzień, podana godzina,
        towar i numer dokumentu. Nic nie wysyła się samo — wysyłasz Ty, tym przyciskiem.</p>`,
    przyciski: [
      { napis: 'Anuluj', klik: z => z() },
      { napis: '✉️ Wyślij', klasa: 'glowny', klik: async z => {
        const w = await sprobuj(() => API.post(`/api/przystanki/${p.id}/powiadom`,
          { okno: val('pw-okno') }), 'Wiadomość wysłana');
        if (w) z();
      } },
    ],
  });
}

/* Przeniesienie punktu i „zaległe” pytają, gdy telefon kierowcy może jeszcze
   trzymać zapisy (serwer odpowiada 428 z opisem). Bez tego biuro wysyłało drugi
   samochód do klienta, który odebrał towar godzinę temu — dowód był w kolejce. */
async function zRyzykiemKolejki(dane, wyslij, komunikatSukcesu) {
  zajety(true);
  try {
    const w = await wyslij(dane);
    if (komunikatSukcesu) komunikat(komunikatSukcesu, 'ok');
    return w;
  } catch (e) {
    if (e.kod !== 428) { komunikat(poLudzku(e), 'blad'); return null; }
    zajety(false);
    if (!await potwierdz('Przenieść mimo to?', e.message,
      { tak: 'Przenieś mimo to', nie: 'Wstrzymaj' })) return null;
    return sprobuj(() => wyslij(Object.assign({}, dane, { mimo_to: true })), komunikatSukcesu);
  } finally {
    zajety(false);
  }
}

/* ------------------------------------------- przeniesienie punktu na inną trasę */

async function oknoPrzeniesienia(trasa, p) {
  /* Przełożenie na INNY DZIEŃ, nie tylko na inną trasę tego samego dnia.
     Klient prosi o to co tydzień, a biuro musiało kasować punkt i wpisywać
     go od nowa — gubiąc WZ-kę, okno czasowe i uwagi dla kierowcy. */
  const kierowcy = await listaKierowcow();
  const rysujTrasy = async (dzien) => {
    const trasy = await API.get(`/api/trasy?data=${dzien}`).catch(() => []);
    const inne = trasy.filter(x => x.id !== trasa.id);
    const wybor = document.getElementById('pn-trasa');
    if (!wybor) return;
    wybor.innerHTML = inne.map(x => `<option value="${x.id}">${escHtml(x.nazwa || 'Trasa ' + x.id)}
        — ${escHtml(x.kierowca_imie || 'bez kierowcy')} (${x.ile}
        ${odmiana(x.ile, 'punkt', 'punkty', 'punktów')})</option>`).join('')
      + '<option value="">— załóż nowe zlecenie tego dnia —</option>';
  };
  okno({
    tytul: 'Przenieś: ' + p.klient_nazwa,
    tresc: `
      <p class="male slaby">Punkt przejdzie razem z towarem, numerem dokumentu,
        oknem czasowym i uwagami dla kierowcy.</p>
      <label>Na dzień
        <input type="date" id="pn-dzien" value="${escHtml(trasa.data)}"></label>
      <label>Do zlecenia <select id="pn-trasa"></select></label>
      <label>Kierowca <span class="slaby">(gdy zakładamy nowe zlecenie)</span>
        <select id="pn-kierowca">
          <option value="">— nie przydzielono —</option>
          ${kierowcy.map(u => `<option value="${u.id}"${
            u.id === trasa.kierowca ? ' selected' : ''}>${escHtml(u.imie)}</option>`).join('')}
        </select></label>`,
    przyciski: [
      { napis: 'Anuluj', klik: z => z() },
      { napis: 'Przenieś', klasa: 'glowny', klik: async z => {
        const cel = document.getElementById('pn-trasa').value;
        const dzien = document.getElementById('pn-dzien').value;
        const dane = cel ? { trasa: cel }
          : { data: dzien, kierowca: document.getElementById('pn-kierowca').value || null };
        const w = await zRyzykiemKolejki(dane,
          d => API.post(`/api/przystanki/${p.id}/przenies`, d), 'Przeniesione');
        if (w) { z(); pokazEkran('trasa', { id: trasa.id }); }
      } },
    ],
    poOtwarciu: async pole => {
      await rysujTrasy(trasa.data);
      pole.querySelector('#pn-dzien').onchange = e => rysujTrasy(e.target.value);
    },
  });
}

/* ------------------------------------------------ trasa w Google Maps */

async function oknoLinkuDoMap(trasaId, tylkoOtwarte) {
  const w = await sprobuj(() => API.get(
    `/api/trasy/${trasaId}/mapa-link` + (tylkoOtwarte ? '?otwarte=1' : '')));
  if (!w) return;
  okno({
    tytul: 'Trasa w Google Maps',
    tresc: `
      <p class="male slaby">${w.punktow} ${odmiana(w.punktow, 'punkt', 'punkty', 'punktów')}${
        w.z_bazy ? ', ze startem i powrotem do bazy' : ''}.
        ${w.czesci.length > 1 ? `Google przyjmuje najwyżej dziewięć punktów pośrednich,
          więc trasa jest podzielona na ${w.czesci.length}
          ${odmiana(w.czesci.length, 'część', 'części', 'części')} — każda zaczyna się tam,
          gdzie kończy poprzednia.` : ''}</p>
      ${w.czesci.map((c, i) => `
        <div class="karta scisla">
          <div class="male"><b>${w.czesci.length > 1 ? `Część ${i + 1}: ` : ''}${
            escHtml(c.od)} → ${escHtml(c.do)}</b></div>
          <div class="przyciski" style="margin-top:8px">
            <a class="maly glowny" href="${c.adres}" target="_blank" rel="noopener"
               style="padding:6px 12px;border-radius:8px;background:var(--granat);color:var(--na-marce);
                      text-decoration:none;font-weight:600;font-size:13px;display:inline-block">
               Otwórz w Google Maps</a>
            <button class="maly" data-kopiuj="${i}">Kopiuj odnośnik</button>
          </div>
        </div>`).join('')}
      <p class="male slaby">Odnośnik możesz wysłać kierowcy SMS-em albo na komunikator —
        otworzy mu całą trasę po kolei.</p>`,
    przyciski: [{ napis: 'Zamknij', klik: z => z() }],
    poOtwarciu: pole => {
      pole.querySelectorAll('[data-kopiuj]').forEach(b => b.onclick = () => {
        navigator.clipboard.writeText(w.czesci[Number(b.dataset.kopiuj)].adres)
          .then(() => komunikat('Odnośnik skopiowany', 'ok'))
          .catch(() => komunikat('Skopiuj odnośnik ręcznie z paska adresu', 'blad'));
      });
    },
  });
}


/* --------------------------------------------------------- lista braków
   Liczona wyłącznie z tego, co już jest w bazie. Brakujący dzień pracy jest
   dziś niewidzialny — nie ma wiersza, więc nie ma czego zauważyć.           */

const ZNAKI_BRAKOW = {
  brak_raportu: ['pilne', '🕒', 'Brak raportu pracy'],
  licznik: ['pilne', '📊', 'Zerwany łańcuch licznika'],
  bez_dowodu: ['uwaga', '📎', 'Dostarczone bez dowodu'],
  niezamkniety: ['uwaga', '⏳', 'Punkt nie został zamknięty'],
  bez_mapy: ['info', '📍', 'Klient bez adresu na mapie'],
};

async function rysujBraki(pole, od, doDnia) {
  if (!pole) return;
  const w = await API.get(`/api/braki?od=${od}&do=${doDnia}`).catch(() => null);
  if (!w) return;

  const grupy = {};
  for (const b of w.braki) (grupy[b.rodzaj] = grupy[b.rodzaj] || []).push(b);

  pole.innerHTML = `
    <div class="karta">
      <div class="karta-gora"><h2>Do sprawdzenia</h2>
        <span class="plakietka ${w.braki.length ? 'p-nieudane' : 'p-dostarczone'}">
          ${w.braki.length ? w.braki.length : '✓ nic'}</span></div>
      ${w.braki.length ? Object.entries(grupy).map(([rodzaj, lista]) => {
        const [klasa, ikona, tytul] = ZNAKI_BRAKOW[rodzaj] || ['info', '•', rodzaj];
        return `<h3 style="margin:14px 0 4px">${escHtml(tytul)} (${lista.length})</h3>
          ${lista.slice(0, 25).map(b => `<div class="brak">
            <span class="znak ${klasa}">${ikona}</span>
            <span style="flex:1">
              <span class="male">${escHtml(b.opis)}</span>
              ${b.data ? `<span class="male slaby" style="display:block">${
                escHtml(polskaData(b.data))}${b.kto ? ' · ' + escHtml(b.kto) : ''}</span>` : ''}
            </span>
            ${b.trasa ? `<button class="maly" data-trasa-brak="${b.trasa}">Trasa</button>` : ''}
            ${b.klient ? `<button class="maly" data-klient-brak="${b.klient}">Klient</button>` : ''}
          </div>`).join('')}
          ${lista.length > 25 ? `<p class="male slaby">…i jeszcze ${lista.length - 25}</p>` : ''}`;
      }).join('') : '<p class="male slaby">Wszystko się zgadza — żadnych braków w tym okresie.</p>'}

      ${w.spalanie.length ? `<h3 style="margin:18px 0 4px">Spalanie</h3>
        <div class="male">${w.spalanie.map(s =>
          `<b>${escHtml(s.bus)}</b>: ${s.srednia} l/100 km
           <span class="slaby">(z ${s.ile_tankowan} ${odmiana(s.ile_tankowan,
             'tankowania', 'tankowań', 'tankowań')})</span>`).join(' &nbsp;·&nbsp; ')}</div>` : ''}
    </div>`;

  pole.querySelectorAll('[data-trasa-brak]').forEach(b =>
    b.onclick = () => pokazEkran('trasa', { id: Number(b.dataset.trasaBrak) }));
  pole.querySelectorAll('[data-klient-brak]').forEach(b => b.onclick = () => {
    const k = (stan.klienci || []).find(x => x.id === Number(b.dataset.klientBrak));
    if (k) oknoKlienta(k);
  });
}
