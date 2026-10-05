/* Ekrany kierowcy. Wszystko tu ma dzialac jedna reka, w slonecu i bez zasiegu. */

let mojaTrasa = null;
let mapaKierowcy = null;

/* ------------------------------------------------------ pobranie trasy */

async function wczytajMojaTrase(data, zPamieci) {
  const klucz = 'moja-trasa-' + data;
  // Po wlasnym zapisie nie pytamy serwera. Zapis dopiero leci w tle, wiec
  // serwer odpowiedzialby jeszcze starym stanem i punkt mrugnalby z powrotem
  // na "do zrobienia". To, co mamy w pamieci, jest w tej chwili prawda.
  if (zPamieci && mojaTrasa && mojaTrasa.data === data) return mojaTrasa;
  try {
    const trasy = await API.get('/api/trasy?data=' + data);
    const moje = trasy.filter(t => t.kierowca === stan.uz.id || jestBiuro());
    if (!moje.length) { await Kolejka.zapamietaj(klucz, null); return null; }
    // Kierowca moze miec tego dnia wiecej niz jedna trase — biuro dopisuje
    // nadrobienia zaleglosci. Wczesniej brana byla zawsze PIERWSZA, wiec druga
    // trasa byla dla kierowcy niewidoczna. Bierzemy pierwsza niezakonczona.
    const czynna = moje.find(x => x.status !== 'zakonczona') || moje[0];
    const pelna = await API.get('/api/trasy/' + czynna.id);
    pelna.inne_trasy_dnia = moje.filter(x => x.id !== czynna.id)
      .map(x => ({ id: x.id, nazwa: x.nazwa, status: x.status, ile: x.ile }));
    // Serwer nie wie jeszcze o zapisach, które czekają w kolejce. Bez tego
    // wejście na ekran w trakcie wysyłki cofałoby ptaszki na "do zrobienia",
    // a kierowca potwierdzałby drugi raz.
    await nalozKolejke(pelna);
    await Kolejka.zapamietaj(klucz, pelna);
    return pelna;
  } catch (e) {
    const kopia = await Kolejka.przypomnij(klucz);
    if (kopia === null || kopia === undefined) throw e;
    komunikat('Brak sieci — pokazuję zlecenie z pamięci telefonu');
    return kopia;
  }
}

/* Nakłada na trasę z serwera to, co czeka jeszcze w kolejce telefonu.

   Musi obejmować KAŻDY typ operacji, który zmienia to, co widać na ekranie.
   Wcześniej brało tylko dostawy, więc potwierdzenia załadunku zrobione bez
   zasięgu znikały przy pierwszym odświeżeniu listy — kierowca widział znowu
   „0 z 3" i robił wszystko drugi raz. */
async function nalozKolejke(trasa) {
  const czekajace = (await Kolejka.lista())
    .filter(o => (o.typ === 'dostawa' || o.typ === 'zaladunek')
                 && (!stan.uz || o.uzytkownik === stan.uz.id));
  if (!czekajace.length) return trasa;
  const wgId = Object.fromEntries(trasa.przystanki.map(p => [p.id, p]));
  for (const o of czekajace) {
    const p = wgId[o.przystanek];
    if (!p) continue;
    if (o.typ === 'zaladunek') {
      Object.assign(p, {
        zaladowano_o: o.czas,
        numer_kierowcy: o.numer || '',
        // Zgodność liczy serwer, ale do czasu synchronizacji pokazujemy to,
        // co telefon policzył pod rampą — inaczej ekran kłamałby na czerwono.
        zaladunek_zgodny: (!p.dokument_skrot
          || Skrot.numeru(o.numer) === p.dokument_skrot) ? 1 : 0,
        ile_zalacznikow: (p.ile_zalacznikow || 0) + (o.zdjecie ? 1 : 0),
        czeka_na_wyslanie: true,
      });
      continue;
    }
    Object.assign(p, {
      status: o.status,
      powod: o.powod || '',
      notatka: o.notatka || '',
      odebral: o.odebral || '',
      zamkniete_o: o.status === 'oczekuje' ? null : o.czas,
      ile_zalacznikow: (o.podpis ? 1 : 0) + ((o.zdjecia || []).length),
      czeka_na_wyslanie: true,
    });
  }
  przeliczLicznik(trasa);
  return trasa;
}

function przeliczLicznik(trasa) {
  const odwolane = trasa.przystanki.filter(p => p.status === 'odwolany').length;
  trasa.licznik = {
    wszystkie: trasa.przystanki.length - odwolane,
    dostarczone: trasa.przystanki.filter(p => p.status === 'dostarczone').length,
    nieudane: trasa.przystanki.filter(p => p.status === 'nieudane').length,
    odwolane,
  };
}

/* ------------------------------------------------------------ rysowanie */

/* Który punkt jest teraz. Czysta funkcja, żeby dało się ją sprawdzić testem:
   pierwszy niezamknięty punkt trasy, z pominięciem zdjętych z trasy. */
function nastepnyPrzystanek(trasa) {
  const lista = (trasa && trasa.przystanki) || [];
  return lista.find(p => p.status === 'oczekuje') || null;
}

function kartaPrzystanku(p, numer, klikalny, nastepny) {
  const okno = (p.okno_od || p.okno_do)
    ? `<span class="plakietka p-planowana">🕒 ${escHtml(p.okno_od || '…')}–${escHtml(p.okno_do || '…')}</span>` : '';
  // Nasze miejsce (doładunek w magazynie) to nie dostawa do odbiorcy — kierowca
  // musi to poznać z odległości ramienia, więc dostaje trzy sygnały naraz:
  // inny pasek, plakietkę „NASZE" i inne słowa statusu.
  const nasze = !!p.nasze;
  const plakietka = nastepny
    ? '<span class="plakietka p-nastepny">➜ NASTĘPNY</span>'
    : p.status === 'dostarczone'
    ? `<span class="plakietka p-dostarczone">✓ ${nasze ? 'Byłem' : 'Dostarczone'}</span>`
    : p.status === 'nieudane'
      ? '<span class="plakietka p-nieudane">✕ Nieudane</span>'
      : p.status === 'odwolany'
        ? '<span class="plakietka p-odwolany">Zdjęte ze zlecenia</span>'
        : `<span class="plakietka p-oczekuje">${nasze ? 'Do odwiedzenia' : 'Do zrobienia'}</span>`;
  const dopiski = [];
  if (p.towar) dopiski.push('📦 ' + escHtml(p.towar));
  if (p.dokument && !nasze) dopiski.push('📄 ' + escHtml(p.dokument));
  if (p.uwagi) dopiski.push('📝 ' + escHtml(p.uwagi));
  if (p.status === 'nieudane' && p.powod) dopiski.push('⚠️ ' + escHtml(p.powod));
  if (p.status !== 'oczekuje' && p.zamkniete_o) dopiski.push('🕓 ' + samaGodzina(p.zamkniete_o));
  if (p.eta && p.status === 'oczekuje') dopiski.push(ETA.opis(p));
  if (p.ile_zalacznikow) dopiski.push('📎 ' + p.ile_zalacznikow);
  if (p.czeka_na_wyslanie) dopiski.push('<span style="color:var(--zolty)">⏳ czeka na wysłanie</span>');
  if (p.status === 'odwolany') dopiski.push('biuro zdjęło ten punkt — nie jedź');

  return `<button class="przystanek s-${p.status}${nasze ? ' nasze' : ''}${
      nastepny ? ' nastepny' : ''}"
      ${klikalny ? `data-przystanek="${p.id}"` : 'disabled'}>
      <span class="numer">${numer}</span>
      <span class="srodek">
        <span class="nazwa">${nasze ? '🏭 ' : ''}${escHtml(p.klient_nazwa)}</span>
        <span class="adres">${escHtml(adresJednymCiagiem(p)) || '<i>brak adresu</i>'}</span>
        ${dopiski.length ? `<span class="dopisek">${dopiski.join(' &nbsp;·&nbsp; ')}</span>` : ''}
      </span>
      <span class="prawo">${nasze ? '<span class="plakietka p-nasze">NASZE</span>' : ''}${plakietka}${okno}</span>
    </button>`;
}

EKRANY.moja = {
  tytul: 'Moje zlecenie',
  poSynchronizacji() { if (stan.ekran === 'moja') pokazEkran('moja'); },
  async rysuj(pole, param) {
    const data = param.data || dzisiaj();
    mojaTrasa = await wczytajMojaTrase(data, param.zPamieci);

    const wybor = `<div class="pasek-narzedzi">
        <label>Dzień<input type="date" id="data-trasy" value="${data}"></label>
        <button id="btn-mapa">🗺️ Mapa</button>
      </div>`;

    if (!mojaTrasa) {
      pole.innerHTML = wybor + `<div class="karta"><div class="pusto">
          <span class="duza-ikona">📭</span>
          Na ten dzień nie masz zaplanowanej trasy.
          <div class="male" style="margin-top:8px">Biuro układa zlecenia rano — odśwież za chwilę.</div>
        </div></div>`;
      pole.querySelector('#data-trasy').onchange = e => pokazEkran('moja', { data: e.target.value });
      pole.querySelector('#btn-mapa').disabled = true;
      return;
    }

    przeliczLicznik(mojaTrasa);
    ETA.policz(mojaTrasa);
    const nastepny = nastepnyPrzystanek(mojaTrasa);
    const l = mojaTrasa.licznik;
    const zrobione = l.dostarczone + l.nieudane;
    const wSieci = mojaTrasa.przystanki;

    pole.innerHTML = wybor + `
      ${stan.odrzucone ? `<div class="wstega uwaga" id="w-odrzucone" style="cursor:pointer">
        <b>${stan.odrzucone} ${odmiana(stan.odrzucone, 'zapis nie przeszedł',
          'zapisy nie przeszły', 'zapisów nie przeszło')}.</b>
        Nic nie zostało skasowane — pokaż to biuru. Dotknij, żeby zobaczyć.</div>` : ''}
      <div class="karta scisla">
        <div class="karta-gora">
          <div>
            <h2 style="margin:0">${escHtml(mojaTrasa.nazwa || 'Zlecenie ' + polskaData(mojaTrasa.data))}</h2>
            <div class="male slaby">
              ${escHtml(mojaTrasa.pojazd_nazwa || 'bez przypisanego busa')}
              ${mojaTrasa.rejestracja ? '· ' + escHtml(mojaTrasa.rejestracja) : ''}
              ${mojaTrasa.start_o ? '· start ' + samaGodzina(mojaTrasa.start_o) : ''}
            </div>
          </div>
          <span class="plakietka p-${mojaTrasa.status}">${escHtml(mojaTrasa.status.replace('_', ' '))}</span>
        </div>
        ${mojaTrasa.flotex && !mojaTrasa.flotex.sprawny ? `<div class="wstega blad"
            style="margin:4px 0 10px">⚠ Auto według GK Flota: ${escHtml(
            (mojaTrasa.flotex.powody || []).join('; ') || 'niesprawne')} — zadzwoń do biura</div>` : ''}
        <div class="male"><b>${zrobione}</b> z <b>${l.wszystkie}</b>
          ${odmiana(l.wszystkie, 'punktu', 'punktów', 'punktów')}
          ${l.nieudane ? `· <span style="color:var(--czerwony)">${l.nieudane}
            ${odmiana(l.nieudane, 'nieudana', 'nieudane', 'nieudanych')}</span>` : ''}
          <span id="znacznik-kolejki" class="slaby" style="float:right"></span></div>
        <div class="postep">
          <i class="ok" style="width:${l.wszystkie ? l.dostarczone / l.wszystkie * 100 : 0}%"></i>
          <i class="nie" style="width:${l.wszystkie ? l.nieudane / l.wszystkie * 100 : 0}%"></i>
        </div>
        ${mojaTrasa.uwagi ? `<div class="wstega info" style="margin-top:12px">📌 ${escHtml(mojaTrasa.uwagi)}</div>` : ''}
        ${(mojaTrasa.inne_trasy_dnia || []).length ? `<div class="wstega uwaga" style="margin-top:10px">
            Masz dziś jeszcze ${mojaTrasa.inne_trasy_dnia.length}
            ${odmiana(mojaTrasa.inne_trasy_dnia.length, 'zlecenie', 'zlecenia', 'zleceń')}:
            ${mojaTrasa.inne_trasy_dnia.map(x =>
              `<b>${escHtml(x.nazwa || 'bez nazwy')}</b> (${x.ile || 0} pkt)`).join(', ')}
            — pokaże się po zamknięciu tej.</div>` : ''}
        <div class="przyciski" style="margin-top:12px">
          ${mojaTrasa.status === 'planowana' ? '<button class="glowny" id="btn-start">▶ Rozpocznij zlecenie</button>' : ''}
          ${zrobione === l.wszystkie && l.wszystkie && mojaTrasa.status !== 'zakonczona'
        ? '<button class="zielony" id="btn-koniec">✓ Zakończ zlecenie</button>' : ''}
          <button id="btn-mapa-link">🧭 Cała trasa w Google Maps</button>
          <button id="btn-polozenie">${sledzenieWlaczone() ? '📍 Wyłącz położenie' : '📍 Udostępniaj położenie'}</button>
        </div>
      </div>
      <div class="mapa ukryty" id="mapa-kierowcy"></div>
      <div id="lista-przystankow">
        ${wSieci.map((p, i) => kartaPrzystanku(p, i + 1, true, p === nastepny)).join('') ||
      '<div class="karta"><div class="pusto">Zlecenie jest puste — biuro jeszcze nie dodało punktów.</div></div>'}
      </div>`;

    pole.querySelector('#data-trasy').onchange = e => pokazEkran('moja', { data: e.target.value });
    pole.querySelectorAll('[data-przystanek]').forEach(b =>
      b.onclick = () => oknoPrzystanku(Number(b.dataset.przystanek)));

    // Po zapisie dostawy ekran rysuje się od nowa i lądował na górze — kierowca
    // przewijał listę w kółko, żeby znaleźć, gdzie jedzie dalej. Pokazujemy
    // mu ten punkt sami. Wzorzec ten sam co w biurze (zapamiętana pozycja).
    // (Ten kawałek stał wcześniej w gałęzi „brak trasy”, przed deklaracją
    // `nastepny` — dzień bez zlecenia kończył się wtedy błędem ekranu.)
    const kartaNastepnego = nastepny && pole.querySelector('.przystanek.nastepny');
    if (kartaNastepnego && stan.pokazNastepny) {
      stan.pokazNastepny = false;
      setTimeout(() => kartaNastepnego.scrollIntoView({ block: 'center' }), 0);
    }

    const btnStart = pole.querySelector('#btn-start');
    if (btnStart) btnStart.onclick = async () => {
      // Twarda blokada, nie pytanie. Bus nie rusza, dopoki kazda pozycja nie ma
      // zdjecia i numeru zamowienia — serwer pilnuje tego samego niezaleznie,
      // wiec objazd przez wylaczony JavaScript tez nic nie da.
      const zostalo = await nieodhaczone(mojaTrasa);
      if (zostalo) {
        komunikat(`Najpierw potwierdź załadunek — zostało ${zostalo} `
          + `${odmiana(zostalo, 'pozycja', 'pozycje', 'pozycji')}.`, 'blad');
        pokazEkran('zaladunek', { data });
        return;
      }
      await doKolejki({ typ: 'stan_trasy', trasa: mojaTrasa.id, stan: 'start', czas: czasTeraz() },
        'Zlecenie rozpoczęte');
      mojaTrasa.status = 'w_toku'; mojaTrasa.start_o = czasTeraz();
      await Kolejka.zapamietaj('moja-trasa-' + data, mojaTrasa);
      pokazEkran('moja', { data, zPamieci: true });
    };
    const btnKoniec = pole.querySelector('#btn-koniec');
    if (btnKoniec) btnKoniec.onclick = async () => {
      if (!await potwierdz('Zakończyć zlecenie?', 'Wszystkie punkty są zamknięte.')) return;
      await doKolejki({ typ: 'stan_trasy', trasa: mojaTrasa.id, stan: 'koniec', czas: czasTeraz() },
        'Zlecenie zakończone');
      mojaTrasa.status = 'zakonczona';
      await Kolejka.zapamietaj('moja-trasa-' + data, mojaTrasa);
      pokazEkran('moja', { data, zPamieci: true });
      komunikat('Nie zapomnij o raporcie pracy', 'ok');
    };
    pole.querySelector('#btn-polozenie').onclick = przelaczSledzenie;
    const wstegaOdrzuconych = pole.querySelector('#w-odrzucone');
    if (wstegaOdrzuconych) wstegaOdrzuconych.onclick = oknoKonta;
    pole.querySelector('#btn-mapa-link').onclick = () => oknoLinkuDoMap(mojaTrasa.id, true);

    pole.querySelector('#btn-mapa').onclick = () => {
      const pojemnik = pole.querySelector('#mapa-kierowcy');
      const chowamy = !pojemnik.classList.contains('ukryty');
      pojemnik.classList.toggle('ukryty', chowamy);
      if (chowamy) return;
      if (!mapaKierowcy || mapaKierowcy._pojemnik !== pojemnik) {
        mapaKierowcy = Mapa.zaloz(pojemnik);
        mapaKierowcy._pojemnik = pojemnik;
      }
      mapaKierowcy.invalidateSize();
      // Baza z TRASY, nie z ogólnego ustawienia — kierowca może wyjeżdżać
      // z innego magazynu niż domyślny dla firmy.
      const bazaTrasy = mojaTrasa.baza_lat != null
        ? [mojaTrasa.baza_lat, mojaTrasa.baza_lon]
        : (stan.ustawienia.baza_lat
           ? [Number(stan.ustawienia.baza_lat), Number(stan.ustawienia.baza_lon)] : null);
      // Kopia zlecenia w telefonie może być starsza niż ta zmiana — brak pola
      // 'uklad' znaczy dawne zachowanie, czyli start i powrót w bazie.
      const uklad = mojaTrasa.uklad || 'baza_baza';
      const ile = Mapa.rysujTrase(mapaKierowcy, wSieci, {
        bazaStart: uklad.startsWith('baza_') ? bazaTrasy : null,
        bazaKoniec: uklad.endsWith('_baza') ? bazaTrasy : null,
        bazaNazwa: mojaTrasa.baza_nazwa,
      });
      if (!ile) komunikat('Żaden punkt nie ma jeszcze odnalezionego adresu na mapie');
    };

    odswiezStanSieci();
  },
};

/* ------------------------------------------------------- „Moje auto” */

/* Przegląd miesięczny, usterka, awaria — to prowadzi GK Flota, nie GK Trasy.
   GK Trasy prosi GK Flota o jednorazowy link (ważny 2 minuty, bez drugiego
   logowania) i przechodzi pod niego. Z GK Flota wraca się przyciskiem
   „Moja trasa” na adres podany tutaj jako powrot. Zapisy czekające
   w kolejce zostają w pamięci telefonu i wyślą się po powrocie.

   powrot = adres TEJ aplikacji, nie samo źródło: otwarta z GitHub Pages
   wraca na https://…github.io/gk-trasy-aplikacja/ — samo „…github.io/”
   prowadziłoby kierowcę na pustą stronę konta GitHub, a kolejka zapisów
   czeka właśnie pod adresem aplikacji.                                     */
EKRANY.mojeauto = {
  tytul: 'Moje auto',
  async rysuj(pole) {
    pole.innerHTML = '<div class="pusto">Otwieram GK Flota…</div>';
    const w = await API.post('/api/flotex/wejscie', { powrot: adresAplikacji() });
    location.href = w.adres;
  },
};

/* ------------------------------------------------- okno jednego przystanku */

function oknoPrzystanku(id) {
  const p = mojaTrasa.przystanki.find(x => x.id === id);
  if (!p) return;
  const zamkniety = p.status !== 'oczekuje';
  const odwolany = p.status === 'odwolany';

  okno({
    tytul: (p.nasze ? '🏭 ' : '') + p.klient_nazwa,
    tresc: `
      <div class="karta scisla" style="margin:0 0 14px">
        <div><b>${escHtml(adresJednymCiagiem(p)) || 'brak adresu'}</b></div>
        ${p.osoba ? `<div class="male slaby">👤 ${escHtml(p.osoba)}</div>` : ''}
        ${p.telefon ? `<div class="male"><a href="tel:${escHtml(p.telefon.replace(/\s/g, ''))}">📞 ${escHtml(p.telefon)}</a></div>` : ''}
        ${p.godziny ? `<div class="male slaby">🕒 ${escHtml(p.godziny)}</div>` : ''}
        ${p.klient_uwagi ? `<div class="wstega uwaga" style="margin:10px 0 0">${escHtml(p.klient_uwagi)}</div>` : ''}
      </div>
      ${p.nasze ? `<div class="wstega info">To nasze miejsce — doładunek albo odbiór,
          nie dostawa do klienta. Nie ma tu podpisu ani numeru zamówienia.</div>` : ''}
      ${p.towar ? `<p><b>Towar:</b> ${escHtml(p.towar)}</p>` : ''}
      ${p.dokument && !p.nasze ? `<p><b>Dokument:</b> ${escHtml(p.dokument)}</p>` : ''}
      ${p.uwagi ? `<p><b>Uwagi do dostawy:</b> ${escHtml(p.uwagi)}</p>` : ''}
      ${zamkniety ? `<div class="wstega ${p.status === 'dostarczone' ? 'info' : 'uwaga'}">
          ${p.status === 'dostarczone' ? (p.nasze ? '✓ Załatwione' : '✓ Dostarczone')
            : odwolany ? 'Biuro zdjęło ten punkt ze zlecenia — nie musisz tam jechać'
            : '✕ Nieudane: ' + escHtml(p.powod)}
          ${p.zamkniete_o ? ' o ' + samaGodzina(p.zamkniete_o) : ''}
          ${p.odebral ? '<br>Odebrał: ' + escHtml(p.odebral) : ''}
          ${p.notatka ? '<br>' + escHtml(p.notatka) : ''}
        </div>
        <button class="tekstowy" id="btn-cofnij">Pomyłka — otwórz ten punkt ponownie</button>` : ''}
      <a class="glowny" href="${linkNawigacji(p)}" target="_blank" rel="noopener"
         style="display:block;text-align:center;padding:15px;border-radius:10px;
                background:var(--granat);color:var(--na-marce);text-decoration:none;font-weight:600;margin-top:8px">
        🧭 ${p.nasze ? 'Nawiguj do magazynu' : 'Nawiguj do klienta'}</a>
      ${p.nasze ? '' : '<button class="maly" id="btn-uwaga" style="margin-top:10px">'
        + '📌 Dopisz uwagę o dojeździe</button>'}`,
    przyciski: zamkniety ? [{ napis: 'Zamknij', klik: z => z() }] : [
      { napis: '✕ Nie udało się', klasa: 'czerwony', klik: z => { z(); oknoNieudanej(p); } },
      { napis: p.nasze ? '✓ Załatwione' : '✓ Dostarczone', klasa: 'zielony',
        klik: z => { z(); oknoDostarczone(p); } },
    ],
    poOtwarciu: pole => {
      const btnUwaga = pole.querySelector('#btn-uwaga');
      if (btnUwaga) btnUwaga.onclick = () => { zamknijOkno(); oknoUwagiDojazdowej(p); };
      const cofnij = pole.querySelector('#btn-cofnij');
      if (cofnij) cofnij.onclick = async () => {
        if (!await potwierdz('Otworzyć punkt ponownie?',
          'Status wróci do „do zrobienia". Zdjęcia i podpis zostaną w archiwum.')) return;
        await zapiszDostawe(p, { status: 'oczekuje' });
        zamknijOkno();
      };
    },
  });
}

/* ------------------------------------------------- potwierdzenie dostawy */

/* Brudnopis niedokończonej dostawy.

   Zdjęcia, podpis i notatka żyły wyłącznie w pamięci otwartego okna. Aparat
   telefonu potrafi wypchnąć przeglądarkę z pamięci — wtedy kierowca traci
   wszystko i robi dostawę drugi raz, na dworze, przy kliencie. To jedyne dane
   w programie, których nie da się odtworzyć inaczej niż powrotem pod adres. */
function kluczSzkicu(p) {
  return 'szkic-' + p.id + '-' + (stan.uz ? stan.uz.id : 0);
}

/* Czyste funkcje — bez DOM-u, żeby dało się je sprawdzić testem. */
function szkicZOkna(dane) {
  return {
    odebral: dane.odebral || '', notatka: dane.notatka || '',
    powod: dane.powod || '', podpis: dane.podpis || null,
    zdjecia: (dane.zdjecia || []).slice(), kiedy: new Date().toISOString(),
  };
}
function szkicPusty(szkic) {
  if (!szkic) return true;
  return !szkic.odebral && !szkic.notatka && !szkic.powod && !szkic.podpis
    && !(szkic.zdjecia || []).length;
}

/* Kierowca dopisuje do kartoteki to, czego biuro nie wie: „brama na kod",
   „wózek widłowy tylko do 14". Idzie tą samą kolejką co dostawy, więc działa
   bez zasięgu. Serwer sprawdza, czy ten klient jest na trasie tego kierowcy. */
function oknoUwagiDojazdowej(p) {
  okno({
    tytul: 'Dopisz do kartoteki: ' + p.klient_nazwa,
    tresc: `
      <p class="male slaby">To zostanie w kartotece klienta — zobaczy to biuro
        i drugi kierowca przy zastępstwie. Podpisujemy Twoim imieniem i datą.</p>
      <label>Co warto wiedzieć o dojeździe
        <textarea id="u-tekst" maxlength="300"
          placeholder="np. wjazd od podwórza, brama na kod 1234, wózek tylko do 14"></textarea>
      </label>
      ${p.klient_uwagi ? `<p class="male slaby">Teraz w kartotece:<br>${
        escHtml(p.klient_uwagi)}</p>` : ''}`,
    przyciski: [
      { napis: 'Anuluj', klik: z => z() },
      { napis: '📌 Dopisz', klasa: 'glowny', klik: async z => {
        const tekst = (document.getElementById('u-tekst') || {}).value || '';
        if (!tekst.trim()) return;
        z();
        await doKolejki({ typ: 'uwaga_klienta', klient: p.klient, tekst: tekst.trim() },
          'Dopisane do kartoteki');
      } },
    ],
  });
}

function oknoDostarczone(p) {
  let podpisPole = null;
  const zdjecia = [];
  // We własnym magazynie nie ma komu podpisać odbioru ani kogo wpisać jako
  // odbierającego — to doładunek, nie dostawa. Zostaje zdjęcie i notatka.
  const nasze = !!p.nasze;

  okno({
    tytul: (nasze ? 'Postój: ' : 'Dostawa: ') + p.klient_nazwa,
    tresc: `
      ${nasze ? '' : `<label>Kto odebrał <span class="slaby">(imię i nazwisko lub „magazyn")</span>
        <input id="d-odebral" autocapitalize="words" placeholder="np. Jan Kowalski">
      </label>
      <label>Podpis odbierającego
        <canvas class="pole-podpisu" id="d-podpis"></canvas>
      </label>
      <button class="maly" id="d-czysc-podpis" type="button">Wyczyść podpis</button>`}
      <label style="margin-top:16px">Zdjęcia <span class="slaby">(towar, dokument, miejsce)</span>
        <input type="file" id="d-zdjecia" accept="image/*" capture="environment" multiple>
      </label>
      <div class="miniatury" id="d-miniatury"></div>
      <label style="margin-top:12px">Notatka <span class="slaby">(nieobowiązkowa)</span>
        <textarea id="d-notatka" placeholder="np. zostawione w magazynie od podwórza"></textarea>
      </label>`,
    przyciski: [
      { napis: 'Anuluj', klik: async z => {
        if (oknoDostarczone.odepnij) oknoDostarczone.odepnij();
        try { await Kolejka.zapomnij(kluczSzkicu(p)); } catch (e) { /* trudno */ }
        z();
      } },
      { napis: nasze ? '✓ Zapisz postój' : '✓ Zapisz dostawę', klasa: 'zielony', klik: async z => {
        const wart = id => (document.getElementById(id) || {}).value || '';
        const dane = {
          status: 'dostarczone',
          odebral: wart('d-odebral').trim(),
          notatka: wart('d-notatka').trim(),
          podpis: podpisPole && !podpisPole.pusty() ? podpisPole.obraz() : null,
          zdjecia: zdjecia.slice(),
        };
        // Ostrzeżenie o braku dowodu ma sens tylko przy dostawie do odbiorcy.
        // Przy własnym magazynie pokazywałoby się ZAWSZE, a ostrzeżenie, które
        // zawsze się pojawia, przestaje cokolwiek znaczyć.
        if (!nasze && !dane.odebral && !dane.podpis && !dane.zdjecia.length) {
          if (!await potwierdz('Brak dowodu dostawy',
            'Nie ma podpisu, zdjęcia ani nazwiska odbierającego. Zapisać mimo to?')) return;
        }
        z();
        if (oknoDostarczone.odepnij) oknoDostarczone.odepnij();
        await zapiszDostawe(p, dane);
        // Brudnopis kasujemy DOPIERO po włożeniu dostawy do kolejki.
        try { await Kolejka.zapomnij(kluczSzkicu(p)); } catch (e) { /* trudno */ }
      } },
    ],
    poOtwarciu: async pole => {
      const plotno = pole.querySelector('#d-podpis');
      if (plotno) {
        podpisPole = Podpis.zaloz(plotno);
        pole.querySelector('#d-czysc-podpis').onclick = () => { podpisPole.wyczysc(); zapiszSzkic(); };
      }
      const wart = id => (pole.querySelector('#' + id) || {}).value || '';
      const zapiszSzkic = () => {
        const szkic = szkicZOkna({
          odebral: wart('d-odebral'), notatka: wart('d-notatka'),
          podpis: podpisPole && !podpisPole.pusty() ? podpisPole.obraz() : null,
          zdjecia: zdjecia,
        });
        // Pustego brudnopisu nie zapisujemy — inaczej samo otwarcie i zamknięcie
        // okna zostawiałoby wpis i fałszywy dopisek „niedokończone".
        const zadanie = szkicPusty(szkic)
          ? Kolejka.zapomnij(kluczSzkicu(p))
          : Kolejka.zapamietaj(kluczSzkicu(p), szkic);
        return zadanie.catch(() => { /* brak miejsca nie moze blokowac dostawy */ });
      };
      oknoDostarczone.zapiszSzkic = zapiszSzkic;

      pole.querySelector('#d-zdjecia').onchange = async e => {
        await dodajZdjecia(e.target.files, zdjecia, pole.querySelector('#d-miniatury'), e.target);
        zapiszSzkic();
      };
      // Zapisujemy w czterech momentach, a NIE na zegarze: przepisywanie
      // kilku megabajtów zdjęć po każdym naciśnięciu klawisza zadławiłoby
      // tani telefon. 'visibilitychange' pokrywa przełączenie do aparatu.
      ['d-odebral', 'd-notatka'].forEach(id => {
        const p2 = pole.querySelector('#' + id);
        if (p2) p2.onblur = zapiszSzkic;
      });
      if (plotno) ['touchend', 'mouseup'].forEach(n => plotno.addEventListener(n, zapiszSzkic));
      const naSchowanie = () => { if (document.hidden) zapiszSzkic(); };
      document.addEventListener('visibilitychange', naSchowanie);
      oknoDostarczone.odepnij = () => document.removeEventListener('visibilitychange', naSchowanie);

      // Odtworzenie tego, co zostało po poprzednim razie.
      let szkic = null;
      try { szkic = await Kolejka.przypomnij(kluczSzkicu(p)); } catch (e) { szkic = null; }
      if (szkicPusty(szkic)) return;
      const wstaw = (id, wartosc) => {
        const p2 = pole.querySelector('#' + id);
        if (p2 && wartosc) p2.value = wartosc;
      };
      wstaw('d-odebral', szkic.odebral);
      wstaw('d-notatka', szkic.notatka);
      (szkic.zdjecia || []).forEach(z => zdjecia.push(z));
      if (zdjecia.length) await dodajZdjecia([], zdjecia, pole.querySelector('#d-miniatury'), null);
      if (podpisPole && szkic.podpis) podpisPole.wstaw(szkic.podpis);
      const wstega = document.createElement('div');
      wstega.className = 'wstega info';
      wstega.textContent = 'Odzyskałem to, co wpisałeś wcześniej — sprawdź i zapisz.';
      pole.insertBefore(wstega, pole.firstChild);
    },
  });
}

function oknoNieudanej(p) {
  const zdjecia = [];
  let powod = '';
  const powody = powodyNieudanych();

  okno({
    tytul: 'Nieudana dostawa: ' + p.klient_nazwa,
    tresc: `
      <label>Co się stało? <span style="color:var(--czerwony)">*</span></label>
      <div class="chipy" id="n-powody">
        ${powody.map(x => `<button type="button" class="chip" data-powod="${escHtml(x)}">${escHtml(x)}</button>`).join('')}
      </div>
      <label style="margin-top:10px">Inny powód
        <input id="n-inny" placeholder="wpisz własny">
      </label>
      <label>Opis <span class="slaby">(co powiedzieć biuru)</span>
        <textarea id="n-notatka" placeholder="np. brama zamknięta, telefon nie odbiera, umówione na jutro"></textarea>
      </label>
      <label>Zdjęcie <span class="slaby">(nieobowiązkowe — bywa dowodem)</span>
        <input type="file" id="n-zdjecia" accept="image/*" capture="environment" multiple>
      </label>
      <div class="miniatury" id="n-miniatury"></div>`,
    przyciski: [
      { napis: 'Anuluj', klik: z => z() },
      { napis: 'Zapisz jako nieudaną', klasa: 'czerwony', klik: async z => {
        const inny = document.getElementById('n-inny').value.trim();
        const wybrany = inny || powod;
        if (!wybrany) { komunikat('Wybierz albo wpisz powód', 'blad'); return; }
        z();
        await zapiszDostawe(p, {
          status: 'nieudane', powod: wybrany,
          notatka: document.getElementById('n-notatka').value.trim(),
          zdjecia: zdjecia.slice(),
        });
      } },
    ],
    poOtwarciu: pole => {
      pole.querySelectorAll('[data-powod]').forEach(b => b.onclick = () => {
        pole.querySelectorAll('[data-powod]').forEach(x => x.classList.remove('wybrany'));
        b.classList.add('wybrany');
        powod = b.dataset.powod;
      });
      pole.querySelector('#n-zdjecia').onchange = e =>
        dodajZdjecia(e.target.files, zdjecia, pole.querySelector('#n-miniatury'), e.target);
    },
  });
}

async function dodajZdjecia(pliki, zbior, pojemnik, wejscie) {
  for (const plik of Array.from(pliki).slice(0, 8 - zbior.length)) {
    try {
      const maly = await zmniejszZdjecie(plik);
      zbior.push(maly);
    } catch (e) {
      komunikat(poLudzku(e), 'blad');
    }
  }
  if (wejscie) wejscie.value = '';
  pojemnik.innerHTML = zbior.map((z, i) =>
    `<div class="miniatura"><img src="${z}" alt=""><button type="button" data-usun="${i}">✕</button></div>`).join('');
  pojemnik.querySelectorAll('[data-usun]').forEach(b => b.onclick = async () => {
    // Zdjęcie zrobione w aplikacji nie trafia do galerii telefonu — skasowane
    // znaczy: wróć pod rampę. Dlatego pytamy, mimo że to jedno dotknięcie.
    if (!await potwierdz('Usunąć to zdjęcie?', 'Nie ma go w galerii telefonu.')) return;
    zbior.splice(Number(b.dataset.usun), 1);
    dodajZdjecia([], zbior, pojemnik, null);
  });
}

/* Zapis idzie do kolejki, a ekran maluje wynik natychmiast — kierowca nie
   czeka na siec ani sekundy.                                                */
async function zapiszDostawe(p, dane) {
  // Kolejność ma znaczenie. Pytanie o GPS potrafi wisieć kilka sekund (a przy
  // pierwszym pytaniu o zgodę — dowolnie długo), a przez ten czas podpis
  // i zdjęcia istniałyby wyłącznie w pamięci karty przeglądarki. Najpierw
  // więc zapis do kolejki, położenie dopisujemy potem i tylko jeśli zdąży.
  // `trasa` = zlecenie, na którym zapis powstał. Gdy biuro w tym czasie
  // przeniesie punkt (inny kierowca, zaległe, nowy dzień), serwer po tym
  // poznaje spóźniony dowód i przyjmuje go zamiast odrzucić jako cudzy.
  const op = await doKolejki(Object.assign({
    typ: 'dostawa', przystanek: p.id, trasa: p.trasa || (mojaTrasa ? mojaTrasa.id : null),
    czas: czasTeraz(),
  }, dane), dane.status === 'oczekuje' ? 'Punkt otwarty ponownie' : 'Zapisane');

  biezacePolozenie().then(polozenie => {
    if (polozenie) Kolejka.uzupelnij(op.uuid, { lat: polozenie.lat, lon: polozenie.lon });
  });

  Object.assign(p, {
    status: dane.status, powod: dane.powod || '', notatka: dane.notatka || '',
    odebral: dane.odebral || '', zamkniete_o: dane.status === 'oczekuje' ? null : czasTeraz(),
    ile_zalacznikow: (p.ile_zalacznikow || 0) +
      (dane.podpis ? 1 : 0) + ((dane.zdjecia || []).length),
  });
  if (mojaTrasa) {
    stan.pokazNastepny = true;      // po przerysowaniu przewin do kolejnego punktu
    if (mojaTrasa.status === 'planowana' && dane.status !== 'oczekuje') mojaTrasa.status = 'w_toku';
    await Kolejka.zapamietaj('moja-trasa-' + mojaTrasa.data, mojaTrasa);
    pokazEkran('moja', { data: mojaTrasa.data, zPamieci: true });
  }
}

function biezacePolozenie() {
  return new Promise(zwroc => {
    if (!navigator.geolocation) return zwroc(null);
    navigator.geolocation.getCurrentPosition(
      p => zwroc({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => zwroc(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 });
  });
}

/* ------------------------------------------------- udostepnianie polozenia
   Wlacza sam kierowca i widzi, ze jest wlaczone. Zaden podglad w tle.       */

let obserwator = null;
let zegarPozycji = null;
let buforPozycji = [];

function sledzenieWlaczone() { return Pamiec.czytaj('sledzenie') === '1'; }

function przelaczSledzenie() {
  if (sledzenieWlaczone()) {
    Pamiec.usun('sledzenie');
    zatrzymajSledzenie();
    komunikat('Udostępnianie położenia wyłączone');
    pokazEkran('moja', { data: mojaTrasa ? mojaTrasa.data : dzisiaj() });
    return;
  }
  okno({
    tytul: 'Udostępnianie położenia',
    tresc: `<p>Telefon będzie zapisywał Twoją trasę <b>tylko w czasie pracy</b> i tylko
       dopóki ta aplikacja jest włączona. Biuro widzi dzięki temu, gdzie jest bus.</p>
       <p class="male slaby">Możesz to wyłączyć w każdej chwili tym samym przyciskiem.
       Zapisane punkty kasują się automatycznie po
       ${escHtml(stan.ustawienia.retencja_pozycji_dni || '90')} dniach.</p>`,
    przyciski: [
      { napis: 'Nie teraz', klik: z => z() },
      { napis: 'Włącz', klasa: 'glowny', klik: z => {
        z();
        Pamiec.zapisz('sledzenie', '1');
        zacznijSledzenie();
        komunikat('Położenie jest udostępniane', 'ok');
        pokazEkran('moja', { data: mojaTrasa ? mojaTrasa.data : dzisiaj() });
      } },
    ],
  });
}

/* Przeglądarka potrafi zgłaszać położenie co sekundę. Osiem godzin jazdy to
   prawie 29 tysięcy punktów na kierowcę — po kilku miesiącach baza rośnie do
   setek megabajtów, a folder kopii do kilku gigabajtów. Do rysowania trasy
   busa wystarczy punkt co ~100 m albo co ~20 s: dzień schodzi do ok. 1500
   punktów, a na mapie nie widać różnicy. */
const MIN_ODLEGLOSC_M = 100;
const MIN_ODSTEP_S = 20;
let ostatniZapisanyPunkt = null;

function wartoZapisac(pozycja) {
  if (!ostatniZapisanyPunkt) return true;
  const sekund = (pozycja.timestamp - ostatniZapisanyPunkt.timestamp) / 1000;
  if (sekund >= 120) return true;              // co dwie minuty zawsze, nawet na postoju
  const metrow = ETA.odlegloscKm(ostatniZapisanyPunkt.coords.latitude,
    ostatniZapisanyPunkt.coords.longitude,
    pozycja.coords.latitude, pozycja.coords.longitude) * 1000;
  return metrow >= MIN_ODLEGLOSC_M || sekund >= MIN_ODSTEP_S && metrow >= 25;
}

function zacznijSledzenie() {
  if (obserwator !== null || !navigator.geolocation) return;
  obserwator = navigator.geolocation.watchPosition(pozycja => {
    if (!wartoZapisac(pozycja)) return;
    ostatniZapisanyPunkt = pozycja;
    buforPozycji.push({
      lat: pozycja.coords.latitude, lon: pozycja.coords.longitude,
      predkosc: pozycja.coords.speed, dokladnosc: pozycja.coords.accuracy,
      czas: czasTeraz(),
    });
    if (buforPozycji.length >= 20) oproznijBuforPozycji();
  }, () => {
    komunikat('Telefon nie chce podać położenia — sprawdź uprawnienia', 'blad');
  }, { enableHighAccuracy: true, maximumAge: 20000, timeout: 30000 });
  if (zegarPozycji === null) zegarPozycji = setInterval(oproznijBuforPozycji, 120000);
}

function zatrzymajSledzenie() {
  if (obserwator !== null) { navigator.geolocation.clearWatch(obserwator); obserwator = null; }
  if (zegarPozycji !== null) { clearInterval(zegarPozycji); zegarPozycji = null; }
  ostatniZapisanyPunkt = null;
  oproznijBuforPozycji();
}

function oproznijBuforPozycji() {
  if (!buforPozycji.length) return;
  const punkty = buforPozycji.splice(0, buforPozycji.length);
  doKolejki({ typ: 'pozycje', trasa: mojaTrasa ? mojaTrasa.id : null, punkty, zrodlo: 'telefon' });
}

/* --------------------------------------------------------- raport pracy */

EKRANY.raporty = {
  tytul: 'Raport pracy',
  async rysuj(pole, param) {
    if (jestBiuro()) return rysujRaportyBiura(pole, param);

    const data = param.data || dzisiaj();
    let moj = null;
    try {
      const w = await API.get(`/api/raporty?od=${data}&do=${data}`);
      moj = w[0] || null;
      await Kolejka.zapamietaj('raport-' + data, moj);
    } catch (e) {
      moj = await Kolejka.przypomnij('raport-' + data);
    }
    // Pięć z ośmiu pól program potrafi wypisać sam: bus i godziny z trasy tego
    // dnia, licznik na start z ostatniego raportu tego busa. Raport pisany po
    // dziesięciu godzinach w busie inaczej bywa niedbały albo żaden.
    let podpowiedz = {};
    if (!moj) {
      podpowiedz = await API.get('/api/raporty/podpowiedz?data=' + data).catch(() => ({}));
    }
    const w = moj || {
      pojazd: podpowiedz.pojazd || null,
      start_o: podpowiedz.start_o || '',
      koniec_o: podpowiedz.koniec_o || '',
      km_start: podpowiedz.km_start != null ? podpowiedz.km_start : null,
      przerwa_min: 0, km_koniec: null, paliwo_l: null, paliwo_pln: null,
      usterki: '', uwagi: '',
      _podpowiedziane: true,
    };
    const busy = stan.pojazdy.filter(p => p.aktywny);

    pole.innerHTML = `
      <div class="karta">
        <div class="karta-gora"><h2>Dzień pracy</h2>
          <input type="date" id="r-data" value="${data}" style="width:auto">
        </div>
        ${w._podpowiedziane && (w.pojazd || w.start_o || w.km_start != null) ? `
          <div class="wstega info">Część pól wypełniłem za Ciebie — bus i godziny z dzisiejszej
            trasy, licznik na start z ostatniego raportu tego busa. Sprawdź i popraw,
            jeśli coś się nie zgadza.</div>` : ''}
        <div class="dwie">
          <label>Bus
            <select id="r-pojazd">
              <option value="">— nie wybrano —</option>
              ${busy.map(b => `<option value="${b.id}" ${w.pojazd === b.id ? 'selected' : ''}>
                ${escHtml(b.nazwa)}${b.rejestracja ? ' · ' + escHtml(b.rejestracja) : ''}</option>`).join('')}
            </select>
          </label>
          <label>Przerwa (minuty)
            <input type="number" id="r-przerwa" min="0" max="600" value="${w.przerwa_min || 0}">
          </label>
          <label>Start pracy
            <input type="time" id="r-start" value="${escHtml(w.start_o || '')}">
            <button type="button" id="r-teraz-start" style="margin-top:6px">Wstaw teraz</button>
          </label>
          <label>Koniec pracy
            <input type="time" id="r-koniec" value="${escHtml(w.koniec_o || '')}">
            <button type="button" id="r-teraz-koniec" style="margin-top:6px">Wstaw teraz</button>
          </label>
          <label>Licznik na start (km)
            <input type="number" id="r-km-start" inputmode="numeric" value="${w.km_start != null ? w.km_start : ''}">
          </label>
          <label>Licznik na koniec (km)
            <input type="number" id="r-km-koniec" inputmode="numeric" value="${w.km_koniec != null ? w.km_koniec : ''}">
          </label>
          <label>Zatankowano (litry)
            <input type="number" step="0.01" id="r-paliwo-l" inputmode="decimal" value="${w.paliwo_l != null ? w.paliwo_l : ''}">
          </label>
          <label>Zatankowano (zł)
            <input type="number" step="0.01" id="r-paliwo-pln" inputmode="decimal" value="${w.paliwo_pln != null ? w.paliwo_pln : ''}">
          </label>
        </div>
        <label>Usterki busa <span class="slaby">(co nie działa, co wymienić)</span>
          <textarea id="r-usterki" placeholder="np. świeci kontrolka oleju, przetarta wycieraczka">${escHtml(w.usterki || '')}</textarea>
        </label>
        <label>Uwagi z dnia
          <textarea id="r-uwagi" placeholder="np. korek na obwodnicy, klient przesunął dostawę">${escHtml(w.uwagi || '')}</textarea>
        </label>
        <div id="r-podsumowanie" class="wstega info"></div>
        <button class="glowny duzy" id="r-zapisz">Zapisz raport</button>
      </div>`;

    const licz = () => {
      const s = pole.querySelector('#r-start').value, k = pole.querySelector('#r-koniec').value;
      const kms = Number(pole.querySelector('#r-km-start').value);
      const kmk = Number(pole.querySelector('#r-km-koniec').value);
      const przerwa = Number(pole.querySelector('#r-przerwa').value) || 0;
      const czesci = [];
      if (s && k) {
        // Ta sama kolejność co w godziny_pracy() w trasex.py: najpierw prostujemy
        // zmianę przez północ na samej różnicy godzin, dopiero potem odejmujemy
        // przerwę. Odwrotnie literówka w przerwie (300 zamiast 30) pokazywałaby
        // 21 godzin pracy, a serwer i tak by taki raport odrzucił.
        let minuty = (new Date('2000-01-01T' + k) - new Date('2000-01-01T' + s)) / 60000;
        if (minuty < 0) minuty += 1440;
        minuty -= przerwa;
        czesci.push(minuty < 0
          ? '<b style="color:var(--czerwony)">Przerwa jest dłuższa niż czas pracy</b>'
          : `Czas pracy: <b>${(minuty / 60).toFixed(2)} h</b>`);
      }
      if (kms && kmk && kmk >= kms) czesci.push(`Przejechane: <b>${kmk - kms} km</b>`);
      pole.querySelector('#r-podsumowanie').innerHTML = czesci.join(' &nbsp;·&nbsp; ') ||
        'Uzupełnij godziny i licznik, żeby zobaczyć podsumowanie.';
    };
    ['#r-start', '#r-koniec', '#r-km-start', '#r-km-koniec', '#r-przerwa']
      .forEach(s => pole.querySelector(s).oninput = licz);
    licz();

    pole.querySelector('#r-data').onchange = e => pokazEkran('raporty', { data: e.target.value });
    pole.querySelector('#r-teraz-start').onclick = () => {
      pole.querySelector('#r-start').value = godzinaTeraz(); licz();
    };
    pole.querySelector('#r-teraz-koniec').onclick = () => {
      pole.querySelector('#r-koniec').value = godzinaTeraz(); licz();
    };
    pole.querySelector('#r-zapisz').onclick = async () => {
      const kms = pole.querySelector('#r-km-start').value;
      const kmk = pole.querySelector('#r-km-koniec').value;
      if (kms && kmk && Number(kmk) < Number(kms)) {
        komunikat('Licznik na koniec nie może być mniejszy niż na start', 'blad');
        return;
      }
      const wpisane = {
        typ: 'raport', data,
        pojazd: pole.querySelector('#r-pojazd').value || null,
        start_o: pole.querySelector('#r-start').value,
        koniec_o: pole.querySelector('#r-koniec').value,
        przerwa_min: pole.querySelector('#r-przerwa').value || 0,
        km_start: kms || null, km_koniec: kmk || null,
        paliwo_l: pole.querySelector('#r-paliwo-l').value || null,
        paliwo_pln: pole.querySelector('#r-paliwo-pln').value || null,
        usterki: pole.querySelector('#r-usterki').value.trim(),
        uwagi: pole.querySelector('#r-uwagi').value.trim(),
      };
      await doKolejki(wpisane, 'Raport zapisany');
      // Raport, jako jedyny ekran, nie zapamiętywał tego, co wpisano. Bez
      // zasięgu formularz wracał pusty, kierowca uznawał że zapis przepadł
      // i wpisywał wszystko od nowa — byle jak albo wcale.
      await Kolejka.zapamietaj('raport-' + data, {
        data, pojazd: Number(wpisane.pojazd) || null,
        start_o: wpisane.start_o, koniec_o: wpisane.koniec_o,
        przerwa_min: Number(wpisane.przerwa_min) || 0,
        km_start: wpisane.km_start != null ? Number(wpisane.km_start) : null,
        km_koniec: wpisane.km_koniec != null ? Number(wpisane.km_koniec) : null,
        paliwo_l: wpisane.paliwo_l != null ? Number(wpisane.paliwo_l) : null,
        paliwo_pln: wpisane.paliwo_pln != null ? Number(wpisane.paliwo_pln) : null,
        usterki: wpisane.usterki, uwagi: wpisane.uwagi,
      });
    };
  },
};

if (sledzenieWlaczone()) setTimeout(zacznijSledzenie, 2500);
