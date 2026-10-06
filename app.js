/* Rdzen aplikacji: logowanie, przelaczanie ekranow, rozmowa z serwerem
   i wysylanie kolejki offline.                                              */

const WERSJA_SKRYPTU = 'trasex-1c7d263b2ed1';   // stempluje zbuduj.py

/* Pamięć przeglądarki (localStorage) — wyłącznie przez Pamiec i ZAWSZE
   z przedrostkiem „gk-trasy.”.

   Od D33 aplikacja stoi też na GitHub Pages (https://milo252-gk.github.io/
   gk-trasy-aplikacja/). Wszystkie aplikacje GK na Pages — GK Flota, Panel,
   Lider, UR, KJ — mają TO SAMO źródło https://milo252-gk.github.io, a
   localStorage jest wspólny dla całego źródła. Klucz 'token' bez przedrostka
   znaczyłby, że zalogowanie w GK Trasy wylogowuje z GK Flota i odwrotnie —
   albo gorzej: że GK Trasy wysyła swojemu serwerowi token GK Floty.

   Do tego sam DOSTĘP do localStorage w Safari w trybie prywatnym rzuca
   wyjątkiem — stąd try/catch w każdej funkcji.                              */
const Pamiec = (() => {
  const PRZEDROSTEK = 'gk-trasy.';
  // Klucze z czasów bez przedrostka. Przenosimy je raz, żeby aktualizacja
  // nikogo nie wylogowała i nie zgubiła motywu ani udostępniania położenia.
  const STARE = ['token', 'motyw', 'push', 'sledzenie'];
  function wspolneZrodlo(host) { return /(^|\.)github\.io$/i.test(String(host || '')); }
  function czytaj(k) {
    try { const w = localStorage.getItem(PRZEDROSTEK + k); return w === null ? '' : w; }
    catch (e) { return ''; }
  }
  function zapisz(k, v) {
    try { localStorage.setItem(PRZEDROSTEK + k, String(v)); return true; }
    catch (e) { return false; }
  }
  function usun(k) {
    try { localStorage.removeItem(PRZEDROSTEK + k); } catch (e) { /* nie ma czego kasować */ }
  }
  /* Przenosimy TYLKO pod adresem, który należał wyłącznie do GK Trasy
     (program w biurze, firmowe wifi, tunel). Na wspólnym źródle Pages klucz
     'token' bez przedrostka jest CUDZY — zostawiła go GK Flota sprzed zmiany —
     i przejęcie go wylogowałoby kierowcę z GK Flota. */
  function przenies(host) {
    if (wspolneZrodlo(host)) return 0;
    let ile = 0;
    STARE.forEach(k => {
      try {
        const stara = localStorage.getItem(k);
        if (stara === null) return;
        if (localStorage.getItem(PRZEDROSTEK + k) === null) localStorage.setItem(PRZEDROSTEK + k, stara);
        localStorage.removeItem(k);
        ile++;
      } catch (e) { /* tryb prywatny — nie ma czego przenosić */ }
    });
    return ile;
  }
  /* Klucze WSPÓLNE wszystkich programów GK (bez przedrostka gk-trasy.) —
     dziś tylko motyw: jeden wybór dla GK Trasy, GK Flota i Panelu. Lista
     zamknięta, żeby nikt tędy nie sięgnął po cudzy klucz (np. 'token'). */
  const WSPOLNE = ['gk.motyw'];
  function czytajWspolny(k) {
    if (WSPOLNE.indexOf(k) < 0) return null;
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function zapiszWspolny(k, v) {
    if (WSPOLNE.indexOf(k) < 0) return false;
    try { localStorage.setItem(k, String(v)); return true; } catch (e) { return false; }
  }
  function usunWspolny(k) {
    if (WSPOLNE.indexOf(k) < 0) return;
    try { localStorage.removeItem(k); } catch (e) { /* nie ma czego kasować */ }
  }
  return { PRZEDROSTEK, czytaj, zapisz, usun, przenies, wspolneZrodlo,
           czytajWspolny, zapiszWspolny, usunWspolny };
})();
Pamiec.przenies(location.hostname);

const stan = {
  token: Pamiec.czytaj('token'),
  uz: null,
  ekran: '',
  ustawienia: {},
  klienci: [],
  pojazdy: [],
  online: navigator.onLine,
  wKolejce: 0,
  synchronizuje: false,
};

const EKRANY = {};          // wypelniaja go biuro.js i kierowca.js
const MAKS_PROB = 5;        // po tylu nieudanych probach zapis ladzie wsrod odrzuconych

/* ------------------------------------------------------------- drobiazgi */

function escHtml(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Komunikaty przeglądarki są po angielsku, a widzi je kierowca na dworze,
   przy kliencie. „Failed to fetch" nie mówi mu nic; „Brak zasięgu — zapisałem
   w telefonie" mówi wszystko. Tłumaczymy w JEDNYM miejscu, bo wyciekały
   z pięciu różnych. */
function poLudzku(e) {
  if (!e) return 'Coś poszło nie tak. Spróbuj jeszcze raz.';
  const nazwa = String(e.name || '');
  const tekst = String(e.message || '');
  if (nazwa === 'QuotaExceededError' || /quota|full disk|exceeded its quota/i.test(tekst)) {
    return 'Brak miejsca w pamięci telefonu. Usuń stare zdjęcia albo nieużywane aplikacje '
      + '— zapisy czekające na wysłanie zostają nietknięte.';
  }
  if (nazwa === 'AbortError' || /abort/i.test(tekst)) {
    return 'Przerwane w połowie. Spróbuj jeszcze raz.';
  }
  if (/failed to fetch|load failed|networkerror|network connection was lost|could not be found/i
      .test(tekst)) {
    return 'Brak połączenia z programem. Sprawdź zasięg — zapisy poczekają w telefonie '
      + 'i wyślą się same.';
  }
  if (/unexpected token|json parse|json\.parse|not valid json/i.test(tekst)) {
    return 'Serwer odpowiedział czymś, czego program nie rozumie. Sprawdź adres '
      + 'albo spróbuj za chwilę.';
  }
  if (/indexeddb|object stores|database|transaction/i.test(tekst)) {
    return 'Pamięć telefonu nie odpowiada. Zamknij i otwórz aplikację jeszcze raz.';
  }
  if (/insecure/i.test(tekst)) {
    return 'Przeglądarka w trybie prywatnym nie pozwala nic zapisać. Otwórz aplikację '
      + 'w zwykłym oknie.';
  }
  // Komunikaty z naszego serwera są już po polsku — te przepuszczamy bez zmian.
  return tekst || 'Coś poszło nie tak. Spróbuj jeszcze raz.';
}

/* Wybór motywu: jasny, ciemny albo „jak w telefonie”.

   Trzyma się TEGO URZĄDZENIA, a nie konta, i to jest celowe. Ekran logowania
   rysuje się, zanim serwer zdąży powiedzieć, kto się loguje; telefon w busie
   bywa wspólny; a kierowca w słońcu i biuro po zmroku chcą czego innego na tym
   samym koncie. Z tego samego powodu wyloguj() NIE kasuje tego klucza.

   Reguła „który motyw” istnieje w programie DWA razy: tutaj i w skrypcie
   w <head> index.html, bo tamten musi wykonać się jeszcze przed arkuszem.
   Wolno je zmieniać wyłącznie razem — smoke.js wykonuje tamten kod na
   atrapach i porównuje wynik z Motyw.policz.

   Klucz jest WSPÓLNY dla programów GK: „gk.motyw” (GK Panel Kierownika
   i GK Flota czytają ten sam). Na github.io wszystkie stoją pod jednym
   źródłem, a osoba z trzema programami ustawiała motyw trzy razy.
   Własny „gk-trasy.motyw” to już tylko migracja: przejmij() przenosi go raz
   do wspólnego i KASUJE. Gdyby zostawał, wybór „jak w telefonie” w innym
   programie (on kasuje gk.motyw) wskrzeszałby tutaj stary wybór.          */
const MOTYW_WSPOLNY = 'gk.motyw';
const Motyw = {
  policz(wybor, systemCiemny) {
    return (wybor === 'ciemny' || (wybor !== 'jasny' && systemCiemny)) ? 'ciemny' : 'jasny';
  },
  /* Zawsze przez window. — gołe matchMedia rzuca ReferenceError tam, gdzie go
     nie ma, a że siedzi w try/catch, opcja „jak w telefonie” po prostu nigdy
     by nie zadziałała i nic by tego nie zgłosiło. */
  systemCiemny() {
    try {
      return !!(window.matchMedia
        && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) { return false; }
  },
  /* 'jasny' | 'ciemny' | 'auto'. Brak klucza znaczy „jak w telefonie” — nie
     zapisujemy tam 'auto', żeby dało się odróżnić wybór od nigdy niewybrania. */
  odczytaj() {
    let w = Pamiec.czytajWspolny(MOTYW_WSPOLNY);
    // Obca wartość (np. 'auto') = brak klucza. Własny klucz istnieje już tylko
    // przed przejęciem (albo gdy przejęcie się nie udało — tryb prywatny).
    if (w !== 'jasny' && w !== 'ciemny') w = Pamiec.czytaj('motyw');
    return (w === 'jasny' || w === 'ciemny') ? w : 'auto';
  },
  /* Raz, przy starcie: własny klucz → wspólny. Wspólny już ustawiony (inny
     program GK) wygrywa — własny wtedy tylko znika. Gdy zapis się nie uda
     (tryb prywatny), własny zostaje, żeby nie zgubić wyboru. */
  przejmij() {
    const wlasny = Pamiec.czytaj('motyw');
    if (!wlasny) return;
    const wspolny = Pamiec.czytajWspolny(MOTYW_WSPOLNY);
    const wspolnyUstawiony = wspolny === 'jasny' || wspolny === 'ciemny';
    if (!wspolnyUstawiony && (wlasny === 'jasny' || wlasny === 'ciemny')
        && !Pamiec.zapiszWspolny(MOTYW_WSPOLNY, wlasny)) return;   // tryb prywatny — zostaje stary
    Pamiec.usun('motyw');
  },
  zastosuj() {
    const wybor = this.odczytaj();
    const motyw = this.policz(wybor === 'auto' ? '' : wybor, this.systemCiemny());
    const korzen = document.documentElement;
    korzen.setAttribute('data-motyw', motyw);
    korzen.style.colorScheme = motyw === 'ciemny' ? 'dark' : 'light';
    const pasek = document.querySelector('meta[name=theme-color]');
    if (pasek) pasek.setAttribute('content', motyw === 'ciemny' ? '#191817' : '#4E4E4E');
    return motyw;
  },
  ustaw(wybor) {
    if (wybor === 'jasny' || wybor === 'ciemny') {
      if (Pamiec.zapiszWspolny(MOTYW_WSPOLNY, wybor)) {
        Pamiec.usun('motyw');
      } else {
        komunikat('Nie mogę zapamiętać wyboru w tej przeglądarce — wróci po odświeżeniu', 'blad');
      }
    } else {
      // „Jak w telefonie” = brak klucza, tak samo jak w pozostałych programach GK.
      Pamiec.usunWspolny(MOTYW_WSPOLNY);
      Pamiec.usun('motyw');
    }
    return this.zastosuj();
  },
};
Motyw.przejmij();

function komunikat(tresc, rodzaj) {
  const pole = document.getElementById('komunikaty');
  const e = document.createElement('div');
  e.className = 'komunikat ' + (rodzaj || '');
  e.textContent = tresc;
  pole.appendChild(e);
  setTimeout(() => { e.style.opacity = '0'; setTimeout(() => e.remove(), 250); },
    rodzaj === 'blad' ? 5200 : 2800);
}

/* Nowa wersja programu przyszla, ale ktos akurat cos wpisuje. Przeladowanie
   w tej chwili skasowaloby otwarte okno razem z podpisem odbiorcy i zdjeciami
   zrobionymi aparatem w aplikacji — tych nie ma w galerii telefonu. Dlatego
   przy otwartym oknie (albo polu z kursorem) tylko zapamietujemy, ze trzeba,
   i odswiezamy dopiero po zamknieciu okna.                                  */
let przeladowanieCzeka = false;

function moznaPrzeladowac() {
  if (document.body.classList.contains('okno-otwarte')) return false;
  const aktywny = document.activeElement;
  return !(aktywny && /^(INPUT|TEXTAREA|SELECT)$/.test(aktywny.tagName || ''));
}

function przeladujPoNowejWersji() {
  if (!moznaPrzeladowac()) {
    if (!przeladowanieCzeka) {
      komunikat('Jest nowa wersja — odświeży się po zamknięciu okna', 'ok');
    }
    przeladowanieCzeka = true;
    return;
  }
  przeladowanieCzeka = false;
  komunikat('Nowa wersja programu — odświeżam', 'ok');
  setTimeout(() => location.reload(), 400);
}

function sprobujZaleglegoPrzeladowania() {
  if (przeladowanieCzeka && moznaPrzeladowac()) przeladujPoNowejWersji();
}

/* Telefon moze wyrzucic zapisy czekajace na zasieg (podpisy, zdjecia), gdy
   brakuje mu miejsca — chyba ze strona dostanie pamiec „trwala". Prosimy
   o nia raz, po zalogowaniu. Odmowa niczego nie psuje. */
function poprosOTrwalaPamiec() {
  try {
    const pamiec = navigator.storage;
    if (!pamiec || !pamiec.persist) return;
    Promise.resolve(pamiec.persisted ? pamiec.persisted() : false)
      .then(juz => juz || pamiec.persist())
      .catch(() => { /* przegladarka nie chce — trudno */ });
  } catch (e) { /* starsza przegladarka */ }
}

let licznikZajetosci = 0;
function zajety(wlacz) {
  licznikZajetosci = Math.max(0, licznikZajetosci + (wlacz ? 1 : -1));
  document.getElementById('zajetosc').classList.toggle('ukryty', licznikZajetosci === 0);
}

/* „1 zapis", „2 zapisy", „5 zapisów" — inaczej komunikaty wygladaja niechlujnie. */
function odmiana(ile, jeden, dwa, piec) {
  const n = Math.abs(ile);
  if (n === 1) return jeden;
  const ostatnia = n % 10, dwieOstatnie = n % 100;
  if (ostatnia >= 2 && ostatnia <= 4 && (dwieOstatnie < 12 || dwieOstatnie > 14)) return dwa;
  return piec;
}

/* Data RRRR-MM-DD wedlug zegara TEGO telefonu, nie UTC. toISOString() liczy
   w UTC, wiec w Polsce miedzy polnoca a 01:00/02:00 dawal wczorajsza date:
   kierowca widzial wczorajsze zlecenie, a „Ten miesiac" zaczynal sie
   ostatniego dnia poprzedniego. Wszystkie daty z kalendarza ida przez to. */
function dataLokalna(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
function dzisiaj() { return dataLokalna(new Date()); }
/* Znacznik czasu zapisany przez toISOString() (UTC) — na ekran po czasie lokalnym. */
function czasZIso(iso) {
  const d = new Date(iso || '');
  return isNaN(d.getTime()) ? '' : dataLokalna(d) + ' ' + d.toTimeString().slice(0, 5);
}
function godzinaTeraz() { return new Date().toTimeString().slice(0, 5); }
function czasTeraz() {
  const d = new Date();
  return dataLokalna(d) + ' ' + d.toTimeString().slice(0, 8);
}
function polskaData(iso) {
  if (!iso) return '';
  const [r, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${r}`;
}
function samaGodzina(czas) { return czas ? String(czas).slice(11, 16) : ''; }

/* ---------------------------------------------------------------- okienko */

/* Okno, w ktorym cos juz wpisano, nie znika od dotkniecia obok. Zdjecia
   robione aparatem w aplikacji nie trafiaja do galerii telefonu, wiec ich
   utrata oznacza powrot pod rampe.                                          */
function oknoMaTresc() {
  const pole = document.getElementById('okno-tresc');
  if (!pole || document.getElementById('okno-tlo').classList.contains('ukryty')) return false;
  if (pole.querySelector('.miniatura')) return true;
  if (pole.querySelector('.pole-podpisu.zapelnione')) return true;
  if (pole.querySelector('.chip.wybrany')) return true;
  return [...pole.querySelectorAll('input, textarea')].some(p =>
    p.type !== 'file' && p.type !== 'checkbox' && p.type !== 'date'
    && p.type !== 'radio' && (p.value || '').trim() && !p.dataset.wstepne);
}

async function zamknijZPytaniem() {
  if (oknoMaTresc() && !await potwierdz('Porzucić to, co wpisane?',
    'Zdjęcia i podpis z tego okna przepadną — nie ma ich w galerii telefonu.')) return;
  zamknijOkno();
}

function okno({ tytul, tresc, przyciski, poOtwarciu, szerokie }) {
  const tlo = document.getElementById('okno-tlo');
  document.getElementById('okno-tytul').textContent = tytul || '';
  const poleTresci = document.getElementById('okno-tresc');
  poleTresci.innerHTML = tresc || '';
  const stopka = document.getElementById('okno-stopka');
  stopka.innerHTML = '';
  (przyciski || []).forEach(p => {
    const b = document.createElement('button');
    b.textContent = p.napis;
    b.className = p.klasa || '';
    b.onclick = () => p.klik(zamknijOkno);
    stopka.appendChild(b);
  });
  document.getElementById('okno').style.maxWidth = szerokie ? '860px' : '';
  tlo.classList.remove('ukryty');
  odswiezZnacznikOkna();
  poleTresci.scrollTop = 0;
  if (poOtwarciu) poOtwarciu(poleTresci);
  return zamknijOkno;
}
function zamknijOkno() {
  document.getElementById('okno-tlo').classList.add('ukryty');
  odswiezZnacznikOkna();
}

/* Co robimy, gdy otwiera się albo zamyka okno modalne.

   To jest CZWARTE podejście do jednego błędu: mapa Leaflet malowała się nad
   oknem. Trzy poprzednie poprawki siedziały w arkuszu (z-index, isolation,
   klasa na body) i u nas działały, a u właściciela nie. Ta nie polega na
   arkuszu wcale: style wpisujemy elementom WPROST, z !important, prosto stąd.
   Styl inline z !important stoi w kaskadzie wyżej niż jakikolwiek arkusz —
   nasz, stary z pamięci podręcznej, czy wstrzyknięty przez rozszerzenie.

   Przy otwartym oknie: każdy kontener mapy (po klasie Leafletu, nie tylko
   naszej) dostaje visibility:hidden, a warstwy okien — najwyższy możliwy
   z-index. Przy zamknięciu wszystko wraca i mapy dostają invalidateSize,
   bo Leaflet nie przelicza rozmiaru, gdy był niewidoczny.                   */
const NAJWYZSZY_ZINDEX = '2147483647';

/* Mapy wyjete z dokumentu na czas okna: [element, znacznik miejsca]. Znacznik
   to pusty komentarz wstawiony tam, gdzie stala mapa — po zamknieciu okna
   mapa wraca dokladnie w to miejsce. Jesli ekran zdazyl sie w miedzyczasie
   przerysowac i znacznika juz nie ma, mapy nie wstawiamy nigdzie: nowy ekran
   zrobil sobie nowa. */
let schowaneMapy = [];

function schowajMapyFizycznie() {
  document.querySelectorAll('.leaflet-container').forEach(m => {
    if (!m.parentNode) return;
    const znacznik = document.createComment('mapa schowana na czas okna');
    m.parentNode.replaceChild(znacznik, m);
    schowaneMapy.push([m, znacznik]);
  });
}

function przywrocMapy() {
  const doPrzywrocenia = schowaneMapy;
  schowaneMapy = [];
  doPrzywrocenia.forEach(([m, znacznik]) => {
    if (znacznik.parentNode && document.contains(znacznik)) {
      znacznik.parentNode.replaceChild(m, znacznik);
    }
  });
}

function odswiezZnacznikOkna() {
  const warstwy = ['okno-tlo', 'pytanie-tlo'].map(id => document.getElementById(id));
  const otwarte = warstwy.some(w => w && !w.classList.contains('ukryty'));
  document.body.classList.toggle('okno-otwarte', otwarte);

  // KOLEJNOSC MA ZNACZENIE: przy zamykaniu mapy najpierw wracaja do dokumentu,
  // a dopiero potem zdejmujemy im style — querySelectorAll nie widzi elementow
  // wyjetych z drzewa i bez tego mapa wracalaby na ekran nadal niewidoczna.
  if (!otwarte) przywrocMapy();

  document.querySelectorAll('.leaflet-container, .mapa').forEach(m => {
    if (otwarte) {
      m.style.setProperty('visibility', 'hidden', 'important');
      m.style.setProperty('z-index', '0', 'important');
    } else {
      m.style.removeProperty('visibility');
      m.style.removeProperty('z-index');
    }
  });
  // Ostatnia, fizyczna linia obrony: na czas okna mapa jest WYJETA z dokumentu.
  // Element, ktorego nie ma w drzewie, nie maluje sie nigdzie — niezaleznie od
  // z-index, arkuszy, rozszerzen przegladarki i bledow kompozytora.
  if (otwarte) schowajMapyFizycznie();
  warstwy.forEach((w, i) => {
    if (!w) return;
    // Sam z-index. Inline 'position:fixed' bylo tu zbedne (arkusz i tak je daje),
    // a pasuje do wzorca, ktorym blokery nakladek wycinaja elementy:
    // div[style*="position: fixed"]{display:none!important}. Szkoda ryzykowac.
    w.style.setProperty('z-index', String(Number(NAJWYZSZY_ZINDEX) - 10 + i), 'important');
  });
  // Toasty i kółko „pracuję" mają stać NAD oknem — dostają jeszcze wyżej.
  const kom = document.getElementById('komunikaty');
  const zaj = document.getElementById('zajetosc');
  if (kom) kom.style.setProperty('z-index', NAJWYZSZY_ZINDEX, 'important');
  if (zaj) zaj.style.setProperty('z-index', NAJWYZSZY_ZINDEX, 'important');

  if (!otwarte && window.Mapa && Mapa.odswiezWszystkie) Mapa.odswiezWszystkie();
  // Nowa wersja czekala na zamkniecie okna — teraz juz mozna.
  if (!otwarte) setTimeout(sprobujZaleglegoPrzeladowania, 0);
}

/* Pytanie "na pewno?" rysuje sie w OSOBNEJ warstwie, nad zwyklym oknem.
   Kiedy korzystalo z tego samego okna co formularze, zadanie pytania
   nadpisywalo formularz, a odpowiedz — obojetnie ktora — zamykala wszystko.
   Kierowca kasujacy jedno rozmazane zdjecie tracil komplet dowodow dostawy. */
/* opcje: { tak, nie, groznie, html }. Nazwy przyciskow bywaja wazniejsze od
   pytania — „Zglos niezgodnosc" i „Popraw numer" mowia kierowcy pod rampa
   znacznie wiecej niz „Tak" i „Nie". groznie maluje potwierdzenie na czerwono. */
function potwierdz(pytanie, opis, opcje) {
  opcje = opcje || {};
  return new Promise(zwroc => {
    const tlo = document.getElementById('pytanie-tlo');
    document.getElementById('pytanie-tytul').textContent = pytanie || 'Na pewno?';
    document.getElementById('pytanie-tresc').innerHTML =
      opis ? `<p class="slaby">${opcje.html ? opis : escHtml(opis)}</p>`
           : '<p class="slaby">Na pewno?</p>';

    const stopka = document.getElementById('pytanie-stopka');
    stopka.innerHTML = '';
    const zakoncz = (odpowiedz) => {
      tlo.classList.add('ukryty');
      odswiezZnacznikOkna();
      document.removeEventListener('keydown', naKlawisz, true);
      zwroc(odpowiedz);
    };
    const naKlawisz = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();          // Escape zamyka pytanie, nie okno pod spodem
      zakoncz(false);
    };

    for (const [napis, klasa, odpowiedz] of [
      [opcje.nie || 'Nie', '', false],
      [opcje.tak || 'Tak', opcje.groznie ? 'glowny niszczacy' : 'glowny', true]]) {
      const b = document.createElement('button');
      b.textContent = napis;
      b.className = klasa;
      b.onclick = () => zakoncz(odpowiedz);
      stopka.appendChild(b);
    }
    tlo.onclick = e => { if (e.target === tlo) zakoncz(false); };
    document.addEventListener('keydown', naKlawisz, true);
    tlo.classList.remove('ukryty');
    odswiezZnacznikOkna();
    (stopka.lastChild || {}).focus?.();
  });
}

/* ------------------------------------------------------------ adres danych */

/* Gdzie szukać danych (D33, wzór: GK Flota).

   Aplikacja stoi w dwóch miejscach naraz i to jest celowe:
   — otwarta z programu (biuro, firmowe wifi, tunel) → dane są pod tym samym
     adresem, API_BAZA jest pusta i wszystko idzie ścieżkami względnymi;
   — otwarta ze stałego adresu na GitHub Pages → tam leży sam wygląd,
     a dane obsługuje komputer w biurze pod adresem tunelu. Ten adres zmienia
     się po każdym uruchomieniu programu, więc NIE jest wpisany w kod —
     aplikacja czyta go z pliku adres.json leżącego obok niej, a program
     w biurze sam go tam aktualizuje.

   Po co: przeglądarka wiąże kolejkę niewysłanych zdjęć, zapisane logowanie
   i pamięć offline z ADRESEM strony. Wchodząc wprost pod zmienny adres tunelu,
   kierowca po każdym restarcie programu zostawiałby podpisy z rampy pod
   starym adresem, bez drogi powrotu. Stały front to rozwiązuje.             */
let API_BAZA = '';
let _adresWDrodze = null;
let _stronaZProgramu = false;      // adres.json = 404: stronę wydał sam program
let _ostatnioSprawdzonoAdres = 0;
const ODSTEP_SPRAWDZANIA_ADRESU = 30000;

/* Ustalenie adresu danych jest WARUNKIEM każdego zapytania, nie krokiem
   startowym obok nich: formularz logowania działa od pierwszej chwili, a odczyt
   adres.json trwa. Kto pierwszy potrzebuje adresu, ten go ustala, reszta czeka
   na ten sam wynik. */
function adresDanychGotowy() {
  if (!_adresWDrodze) _adresWDrodze = ustalBazeApi();
  return _adresWDrodze;
}

/* adres.json: opis z polem api | 'brak' (404 — nie jesteśmy na Pages)
   | null (nie wiadomo, np. brak zasięgu). no-store i znacznik czasu, bo to
   jedyny plik, który MUSI być świeży — także w pamięci serwerów GitHuba. */
async function czytajPlikAdresu() {
  try {
    const odp = await fetch('adres.json?t=' + Date.now(), { cache: 'no-store' });
    if (odp.status === 404) return 'brak';
    if (!odp.ok) return null;
    const opis = await odp.json();
    return (opis && opis.api) ? opis : null;
  } catch (e) { return null; }
}

function ustawBazeApi(opis, zrodlo) {
  API_BAZA = String(opis.api).replace(/\/+$/, '');
  stan.adresDanych = Object.assign({}, opis, { zrodlo });
  if (zrodlo === 'plik') Kolejka.zapamietaj('adres-api', opis).catch(() => {});
}

async function ustalBazeApi() {
  _ostatnioSprawdzonoAdres = Date.now();
  const opis = await czytajPlikAdresu();
  if (opis === 'brak') { _stronaZProgramu = true; return; }
  if (opis) { ustawBazeApi(opis, 'plik'); return; }
  // Pliku nie dało się przeczytać — zwykle brak zasięgu na Pages. Zapamiętany
  // adres istnieje wyłącznie w pamięci TEGO adresu strony i zapisała go tylko
  // wcześniejsza udana próba, więc nie ma czego pomylić. Bierzemy ostatni
  // znany, żeby aplikacja wstała i przyjęła zapisy do kolejki.
  let zapisany = null;
  try { zapisany = await Kolejka.przypomnij('adres-api'); } catch (e) { /* trudno */ }
  if (zapisany && zapisany.api) ustawBazeApi(zapisany, 'pamiec');
}

/* Program w biurze dostał nowy adres tunelu (restart, zerwany tunel).
   Telefon dowiaduje się o tym przy błędzie sieci: czyta adres.json jeszcze
   raz (najwyżej co 30 s, żeby telefon bez zasięgu nie młócił GitHuba)
   i przełącza się BEZ przeładowania — kolejka zapisów zostaje, bo leży pod
   tym samym adresem strony. Zwraca true, gdy adres się zmienił. */
async function odswiezAdresDanych(wymus) {
  if (_stronaZProgramu) return false;
  if (!wymus && Date.now() - _ostatnioSprawdzonoAdres < ODSTEP_SPRAWDZANIA_ADRESU) return false;
  _ostatnioSprawdzonoAdres = Date.now();
  const opis = await czytajPlikAdresu();
  if (opis === 'brak') { _stronaZProgramu = true; return false; }
  if (!opis) return false;
  const nowy = String(opis.api).replace(/\/+$/, '');
  if (nowy === API_BAZA) return false;
  ustawBazeApi(opis, 'plik');
  return true;
}

/* Pełny adres danych — dla miejsc, w których przeglądarka idzie sama
   (src obrazka, link do pobrania CSV), a nie przez fetch. */
function adresDanych(sciezka) { return API_BAZA + sciezka; }

/* Adres samej aplikacji: na Pages https://…github.io/gk-trasy-aplikacja/,
   z programu http://…:8770/. Na niego wraca kierowca z GK Flota („Moje auto”). */
function adresAplikacji() { return new URL('./', location.href).href; }

/* Martwy tunel daje albo błąd sieci (nie ma już takiego adresu, TLS, DNS),
   albo stronę błędu Cloudflare 530/1033 — 502, gdy tunel stoi, a program nie. */
const KODY_MARTWEGO_TUNELU = [502, 530];

/* fetch do programu w biurze. Przy błędzie sieci sprawdza, czy program nie
   dostał nowego adresu — i jeśli tak, ponawia zapytanie JEDEN raz pod nowym.
   Ponowienie jest bezpieczne: zapisy z kolejki mają swój numer (uuid). */
async function pobierz(sciezka, opcje) {
  await adresDanychGotowy();
  let odp;
  try {
    odp = await fetch(API_BAZA + sciezka, opcje);
  } catch (e) {
    if (await odswiezAdresDanych()) return fetch(API_BAZA + sciezka, opcje);
    throw e;
  }
  if (KODY_MARTWEGO_TUNELU.indexOf(odp.status) >= 0 && await odswiezAdresDanych()) {
    return fetch(API_BAZA + sciezka, opcje);
  }
  return odp;
}

/* ------------------------------------------------------------- serwer API */

const API = {
  async zadanie(metoda, sciezka, dane) {
    const opcje = { method: metoda, headers: {} };
    if (stan.token) opcje.headers.Authorization = 'Bearer ' + stan.token;
    if (dane !== undefined) {
      opcje.headers['Content-Type'] = 'application/json';
      opcje.body = JSON.stringify(dane);
    }
    const odp = await pobierz(sciezka, opcje);
    if (odp.status === 401) { sesjaWygasla(); throw new Error('Sesja wygasła — zaloguj się ponownie'); }
    let wynik = null;
    try { wynik = await odp.json(); } catch (e) { wynik = null; }
    if (!odp.ok) {
      const blad = new Error((wynik && wynik.blad) || `Błąd serwera (${odp.status})`);
      // Kod HTTP jest potrzebny tam, gdzie 409 znaczy „zapytaj i ponów",
      // a nie „nie da się" — np. przy kasowaniu podpisów przez retencję.
      blad.kod = odp.status;
      throw blad;
    }
    return wynik;
  },
  get(s) { return API.zadanie('GET', s); },
  post(s, d) { return API.zadanie('POST', s, d || {}); },
  del(s) { return API.zadanie('DELETE', s); },
};

/* Powiadomienia przy ZAMKNIĘTEJ aplikacji (Web Push) — tak samo jak aplikacje
   hali w GK Panel Kierownika. Telefon zapisuje się u serwera push swojej
   przeglądarki (klucz VAPID programu) i oddaje programowi adres subskrypcji.
   Program wysyła pusty push, a sw.js dociąga treść z /api/push/co-nowego.

   Przeglądarki pozwalają na to tylko pod https:// (tunel) albo na localhost —
   pod http://192.168… mówimy o tym wprost, zamiast udawać, że działa.
   „Włączone” trzymamy w tym urządzeniu (Pamiec 'push'): na wspólnym
   telefonie po wylogowaniu subskrypcja przechodzi na następną osobę.        */
const Powiadomienia = {
  mozliwe() {
    return typeof navigator !== 'undefined' && !!navigator.serviceWorker
      && typeof window.PushManager !== 'undefined' && typeof window.Notification !== 'undefined';
  },
  wlaczoneTutaj() { return Pamiec.czytaj('push') === '1'; },
  zapamietaj(wlaczone) {
    // Tryb prywatny: zapis się nie uda — przy następnym wejściu trzeba włączyć jeszcze raz.
    if (wlaczone) Pamiec.zapisz('push', '1'); else Pamiec.usun('push');
  },
  async subskrypcja() {
    if (!this.mozliwe()) return null;
    try {
      const rej = await navigator.serviceWorker.getRegistration();
      return rej ? await rej.pushManager.getSubscription() : null;
    } catch (e) { return null; }
  },
  /* 'niedostepne' (http, stara przeglądarka) | 'zablokowane' | 'wlaczone' | 'wylaczone' */
  async stan() {
    if (!this.mozliwe() || !window.isSecureContext) return 'niedostepne';
    if (Notification.permission === 'denied') return 'zablokowane';
    return (this.wlaczoneTutaj() && await this.subskrypcja()) ? 'wlaczone' : 'wylaczone';
  },
  /* Zgoda przeglądarki i subskrypcja w JEDNYM dotknięciu — przeglądarka pyta
     o zgodę tylko w odpowiedzi na gest człowieka. */
  async wlacz() {
    if (!this.mozliwe() || !window.isSecureContext) {
      throw new Error('Niedostępne tutaj: potrzebny adres https:// (tunel), a na iPhonie '
        + 'aplikacja dodana do ekranu początkowego.');
    }
    if (await Notification.requestPermission() !== 'granted') {
      throw new Error('Powiadomienia są zablokowane — zezwól na nie w ustawieniach przeglądarki '
        + 'dla tej strony i dotknij jeszcze raz.');
    }
    const rej = await navigator.serviceWorker.ready;
    const { klucz } = await API.get('/api/push/klucz');
    let sub = await rej.pushManager.getSubscription();
    if (!sub) {
      sub = await rej.pushManager.subscribe({ userVisibleOnly: true,
                                              applicationServerKey: Powiadomienia.zB64u(klucz) });
    }
    await API.post('/api/push/zapisz', { subskrypcja: sub.toJSON() });
    this.zapamietaj(true);
  },
  async wylacz() {
    const sub = await this.subskrypcja();
    if (sub) {
      try { await API.post('/api/push/wypisz', { endpoint: sub.endpoint }); } catch (e) {
        /* bez sieci — serwer wypisze telefon sam po odpowiedzi 410 */ }
      try { await sub.unsubscribe(); } catch (e) { /* i tak nie wróci */ }
    }
    this.zapamietaj(false);
  },
  /* Po zalogowaniu na telefonie z włączonymi powiadomieniami: subskrypcja
     przechodzi na osobę, która się właśnie zalogowała. */
  async odnow() {
    try {
      if (!this.wlaczoneTutaj() || !this.mozliwe() || Notification.permission !== 'granted') return;
      const sub = await this.subskrypcja();
      if (sub) await API.post('/api/push/zapisz', { subskrypcja: sub.toJSON() });
    } catch (e) { /* spróbujemy przy następnym logowaniu */ }
  },
  zB64u(t) {
    const b = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - t.length % 4) % 4));
    return Uint8Array.from(b, c => c.charCodeAt(0));
  },
};

/* Jeden przycisk w oknie „Moje konto”: Włącz powiadomienia / Włączone + Wyłącz. */
async function rysujPowiadomienia(pole) {
  if (!pole) return;
  const s = await Powiadomienia.stan();
  pole.innerHTML = s === 'wlaczone'
    ? `<p class="male"><b>Włączone</b> — także przy zamkniętej aplikacji.</p>
       <button id="btn-push" data-push="wylacz">Wyłącz</button>`
    : s === 'zablokowane'
      ? `<p class="male slaby">Zablokowane w przeglądarce — zezwól na powiadomienia
           w ustawieniach przeglądarki dla tej strony.</p>`
      : s === 'niedostepne'
        ? `<p class="male slaby">Niedostępne tutaj: potrzebny adres https:// (tunel —
             zapytaj biuro), a na iPhonie aplikacja dodana do ekranu początkowego
             (iOS 16.4 albo nowszy).</p>`
        : `<button class="glowny" id="btn-push" data-push="wlacz">Włącz powiadomienia</button>`;
  const b = pole.querySelector('#btn-push');
  if (b) b.onclick = async () => {
    b.disabled = true;
    try {
      await Powiadomienia[b.dataset.push]();
      komunikat(b.dataset.push === 'wlacz' ? 'Powiadomienia włączone' : 'Powiadomienia wyłączone', 'ok');
    } catch (e) {
      komunikat(poLudzku(e), 'blad');
    }
    rysujPowiadomienia(pole);
  };
}

/* Adres z powiadomienia („#moja”, „#trasa=12”, „#raporty”) → ekran aplikacji. */
function otworzAdres(adres) {
  const m = /^#([a-z]+)(?:=(\d+))?$/.exec(String(adres || ''));
  if (!m || !EKRANY[m[1]] || !stan.uz) return false;
  pokazEkran(m[1], m[2] ? { id: Number(m[2]) } : {});
  return true;
}

/* Opakowanie na akcje uzytkownika: pokazuje kolo, lapie blad, wypisuje go. */
async function sprobuj(praca, komunikatSukcesu) {
  zajety(true);
  try {
    const w = await praca();
    if (komunikatSukcesu) komunikat(komunikatSukcesu, 'ok');
    return w;
  } catch (e) {
    komunikat(poLudzku(e), 'blad');
    return null;
  } finally {
    zajety(false);
  }
}

/* --------------------------------------------------------- kolejka offline */

async function doKolejki(op, komunikatSukcesu) {
  // Po odrzuconej sesji ekran jest tylko do odczytu: nowe zapisy dopiero po
  // ponownym zalogowaniu (sesjaWygasla). Ślad GPS idzie w tle, bez ludzkiej
  // ręki — po cichu go pomijamy, zamiast straszyć komunikatem co 2 minuty.
  if (stan.sesjaWygasla) {
    if (op.typ === 'pozycje') return null;
    komunikat('Sesja wygasła — zaloguj się ponownie. Nic nie zginęło.', 'blad');
    oknoPonownegoLogowania();
    throw new Error('Sesja wygasła — zaloguj się ponownie');
  }
  // Kto to zapisał. Bez tego kolejka po wylogowaniu przechodzi na następną
  // osobę, która zaloguje się na tym telefonie — serwer odrzuci cudze
  // potwierdzenia, a telefon by je skasował. Czyli utrata pracy kierowcy.
  op.uzytkownik = stan.uz ? stan.uz.id : null;
  try {
    await Kolejka.dodaj(op);
  } catch (e) {
    // Cicha porazka w tym miejscu jest najgorsza z mozliwych: kierowca widzi
    // ptaszka, a podpisu i zdjec nie ma nigdzie. Mowimy wprost i przerywamy.
    komunikat('NIE ZAPISANO. ' + poLudzku(e), 'blad');
    throw e;
  }
  await odswiezStanSieci();
  if (komunikatSukcesu) {
    komunikat(stan.online ? komunikatSukcesu : komunikatSukcesu + ' (wyślę, gdy wróci zasięg)', 'ok');
  }
  synchronizuj();
  return op;
}

async function synchronizuj(cicho = true) {
  if (stan.synchronizuje || !stan.token || !stan.uz) return;
  // Flagę stawiamy przed pierwszym await. Zdarzenia 'online' i
  // 'visibilitychange' potrafią wypaść w tym samym ticku i bez tego dwie
  // wysyłki ruszyłyby równolegle, dublując zdjęcia.
  stan.synchronizuje = true;
  try {
    // Wysyłamy wyłącznie własne zapisy. Cudze czekają na swojego właściciela.
    const paczka = (await Kolejka.lista()).filter(o => o.uzytkownik === stan.uz.id);
    if (!paczka.length || !navigator.onLine) { await odswiezStanSieci(); return; }
    await odswiezStanSieci();
    // Paczke dobieramy wedlug wagi, a nie liczby. Dwanascie potwierdzen bez
    // zdjec wazy tyle co nic, ale dwanascie ze zdjeciami przekroczyloby limit
    // serwera i utknelyby na zawsze.
    const LIMIT = 6 * 1024 * 1024;
    const wysylka = [];
    let waga = 0;
    for (const o of paczka) {
      const czysta = Object.assign({}, o, { dodano: undefined, prob: undefined });
      const ile = JSON.stringify(czysta).length;
      if (wysylka.length && waga + ile > LIMIT) break;
      wysylka.push(czysta);
      waga += ile;
      if (wysylka.length >= 12) break;
    }
    // Mówimy serwerowi, ile zapisów zostaje w telefonie — biuro musi odróżnić
    // „kierowca tego nie zrobił" od „zrobił, ale nie ma zasięgu".
    const zostaje = Math.max(0, (await Kolejka.ile().catch(() => 0)) - wysylka.length);
    const wynik = await API.post('/api/sync', { operacje: wysylka, w_kolejce: zostaje });
    for (const p of wynik.przyjete) await Kolejka.usun(p.uuid);

    // Nic nie kasujemy po cichu. Zapis, ktorego serwer nie przyjal, laduje
    // na polce odrzuconych — z powodem, do obejrzenia przez czlowieka.
    // Podpis i zdjecia z rampy sa nie do odtworzenia; komunikat znikajacy
    // po pieciu sekundach nie jest wystarczajacym sladem.
    const wgUuid = Object.fromEntries(paczka.map(o => [o.uuid, o]));
    for (const o of wynik.odrzucone) {
      const op = wgUuid[o.uuid];
      if (!op) continue;
      if (o.trwaly) {
        await Kolejka.odrzuc(op, o.blad);
      } else {
        await Kolejka.oznaczProbe(op);
        // po kilku nieudanych probach tez odkladamy, zeby nie krecic sie
        // w kolko i nie dublowac zdjec przy kazdym podejsciu
        if ((op.prob || 0) >= MAKS_PROB) {
          await Kolejka.odrzuc(op, `${o.blad} (nie udało się wysłać ${MAKS_PROB} razy)`);
        }
      }
    }
    if (wynik.przyjete.length && !cicho) {
      const n = wynik.przyjete.length;
      komunikat(`Wysłano ${n} ${odmiana(n, 'zapis', 'zapisy', 'zapisów')}`, 'ok');
    }
    if (wynik.przyjete.length) {
      const zostalo = await Kolejka.ile();
      if (zostalo) { stan.synchronizuje = false; return synchronizuj(cicho); }
      if (EKRANY[stan.ekran] && EKRANY[stan.ekran].poSynchronizacji) EKRANY[stan.ekran].poSynchronizacji();
    }
  } catch (e) {
    if (!cicho) komunikat('Nie udało się wysłać. ' + poLudzku(e), 'blad');
  } finally {
    stan.synchronizuje = false;
    await odswiezStanSieci();
  }
}

async function odswiezStanSieci() {
  stan.online = navigator.onLine;
  const wszystkie = await Kolejka.lista();
  const moje = stan.uz ? wszystkie.filter(o => o.uzytkownik === stan.uz.id) : wszystkie;
  stan.wKolejce = moje.length;
  stan.obceWKolejce = wszystkie.length - moje.length;
  stan.odrzucone = await Kolejka.ileOdrzuconych();
  const kropka = document.getElementById('stan-sieci');
  kropka.className = 'stan-sieci' + (stan.odrzucone ? ' odrzucone'
    : (!stan.online ? ' offline' : (stan.wKolejce ? ' czeka' : '')));
  const ileZapisow = `${stan.wKolejce} ${odmiana(stan.wKolejce, 'zapis', 'zapisy', 'zapisów')}`;
  kropka.title = stan.odrzucone
    ? `${stan.odrzucone} ${odmiana(stan.odrzucone, 'zapis nie przeszedł', 'zapisy nie przeszły',
        'zapisów nie przeszło')} — dotknij ikony konta`
    : !stan.online
      ? (stan.wKolejce ? `Brak sieci — ${ileZapisow} czeka na wysłanie` : 'Brak sieci — pracujesz offline')
      : (stan.wKolejce ? `${ileZapisow} w wysyłce` : 'Połączono');
  const znacznik = document.getElementById('znacznik-kolejki');
  if (znacznik) znacznik.textContent = stan.wKolejce ? `⏳ ${stan.wKolejce}` : '';
}

/* ------------------------------------------------------------- logowanie */

async function zaloguj(login, pin) {
  // pobierz(), a nie goły fetch pod /api/logowanie: na Pages goły adres pytałby
  // o dane sam GitHub, a ten oddaje stronę „404” w HTML-u — kierowca widziałby
  // „serwer odpowiedział czymś, czego program nie rozumie” przy działającym programie.
  const odp = await pobierz('/api/logowanie', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, pin, urzadzenie: navigator.userAgent.slice(0, 110) }),
  });
  let wynik;
  try {
    // Tunel albo firmowe proxy potrafi oddac strone bledu w HTML-u zamiast
    // JSON-a. Bez tego kierowca dostawal w polu logowania angielski wyrzut
    // parsera zamiast zdania, z ktorym da sie cokolwiek zrobic.
    wynik = await odp.json();
  } catch (e) {
    throw new Error('Serwer odpowiedział czymś, czego program nie rozumie. '
      + 'Sprawdź adres albo spróbuj za chwilę.');
  }
  if (!odp.ok) throw new Error(wynik.blad || 'Nie udało się zalogować');
  // Kto był tu ostatnio. Po wygasłej sesji (sesjaWygasla) jego profil
  // i kartoteka celowo zostały w telefonie — przy tej samej osobie to one
  // pozwalają wrócić bez utraty czegokolwiek. INNA osoba nie może jednak
  // dostać cudzej kartoteki (jak przy wylogowaniu). Kolejki nie ruszamy:
  // cudze zapisy czekają na swojego właściciela (synchronizuj je pomija).
  let poprzedni = stan.uz;
  if (!poprzedni) {
    try { poprzedni = await Kolejka.przypomnij('profil'); } catch (e) { poprzedni = null; }
  }
  if (poprzedni && poprzedni.id !== wynik.id) {
    try { await Kolejka.zapomnij('slowniki'); } catch (e) { /* zaraz i tak nadpisze */ }
    stan.klienci = []; stan.pojazdy = []; stan.lokalizacje = []; stan.ustawienia = {};
  }
  stan.token = wynik.token;
  Pamiec.zapisz('token', wynik.token);   // tryb prywatny albo pełna pamięć — zalogowanie i tak ma się udać
  stan.uz = wynik;
  zakonczTrybDoOdczytu();
  await Kolejka.zapamietaj('profil', wynik);   // zeby jutro wejsc bez zasiegu
  poprosOTrwalaPamiec();
  Powiadomienia.odnow();                       // w tle — logowanie na to nie czeka
  return wynik;
}

async function wyloguj(cicho) {
  if (!cicho) {
    const czeka = stan.wKolejce;
    if (czeka && !await potwierdz(
      `W kolejce czeka ${czeka} ${odmiana(czeka, 'zapis', 'zapisy', 'zapisów')}`,
      'Zostaną w tym telefonie i wyślą się, gdy zalogujesz się ponownie. '
      + 'Nikt inny ich nie wyśle ani nie skasuje. Wylogować?')) return;
    // Razem z wylogowaniem wypisujemy ten telefon z powiadomień TEJ osoby —
    // na wspólnym telefonie następna nie może dostawać cudzych zleceń.
    let endpoint = '';
    try { const sub = await Powiadomienia.subskrypcja(); endpoint = sub ? sub.endpoint : ''; } catch (e) { /* bez push */ }
    try { await API.post('/api/wyloguj', endpoint ? { endpoint } : {}); } catch (e) { /* trudno, i tak wychodzimy */ }
  }
  stan.token = ''; stan.uz = null;
  Pamiec.usun('token');
  zakonczTrybDoOdczytu();
  // Kartoteka klientow i profil zostawaly w telefonie po wylogowaniu —
  // bezterminowo, bo nic ich nigdy nie kasowalo. Zgubiony albo oddany telefon
  // oddawal wtedy komus obcemu cala baze odbiorcow firmy.
  // KOLEJKI I ODRZUCONYCH NIE RUSZAMY: to jedyny egzemplarz podpisow i zdjec,
  // ktore czekaja na zasieg.
  try {
    await Kolejka.zapomnij('slowniki');
    await Kolejka.zapomnij('profil');
  } catch (e) { /* brak pamieci nie moze zatrzymac wylogowania */ }
  stan.klienci = []; stan.pojazdy = []; stan.lokalizacje = []; stan.ustawienia = {};
  pokazLogowanie();
}

function pokazLogowanie() {
  document.getElementById('aplikacja').classList.add('ukryty');
  document.getElementById('ekran-logowania').classList.remove('ukryty');
  document.getElementById('blad-logowania').textContent = '';
  document.getElementById('form-logowania').reset();
}

/* Serwer odrzucił sesję (401): zmiana PIN-u, konto wyłączone w biurze albo
   telefon nieużywany ponad 30 dni. Dawniej wyloguj(true) — a ono kasuje
   profil i kartotekę, więc kierowca w trasie lądował na pustym ekranie
   logowania i bez zasięgu nie miał już nawet listy punktów.

   Teraz: token znika (i tak nie działa), ale profil, kartoteka i KOLEJKA
   ZOSTAJĄ. Ekran, na którym kierowca był, zostaje — tylko do odczytu, z wstęgą
   „Zaloguj się ponownie”. Ta sama osoba loguje się w okienku i wraca dokładnie
   tam, gdzie była; czekające zapisy wysyłają się same. Inna osoba — jak
   zwykłe logowanie (zaloguj): cudza kartoteka znika, cudze zapisy nie wychodzą. */
function sesjaWygasla() {
  stan.token = '';
  Pamiec.usun('token');
  // Bez profilu nie ma czego pokazywać do odczytu (np. sam start aplikacji) —
  // tam uruchom() pokaże zwykły ekran logowania.
  if (!stan.uz || stan.sesjaWygasla) return;
  stan.sesjaWygasla = true;
  document.body.classList.add('sesja-wygasla');
  let wstega = document.getElementById('wstega-sesji');
  const tresc = document.getElementById('tresc');
  if (!wstega && tresc && tresc.parentNode) {
    wstega = document.createElement('div');
    wstega.id = 'wstega-sesji';
    wstega.className = 'wstega uwaga wstega-sesji';
    tresc.parentNode.insertBefore(wstega, tresc);
  }
  if (wstega) {
    wstega.innerHTML = 'Sesja wygasła — zapisy czekają w telefonie. '
      + '<button class="glowny maly" id="btn-zaloguj-ponownie">Zaloguj się ponownie</button>';
    wstega.querySelector('#btn-zaloguj-ponownie').onclick = oknoPonownegoLogowania;
  }
}

function zakonczTrybDoOdczytu() {
  stan.sesjaWygasla = false;
  document.body.classList.remove('sesja-wygasla');
  const wstega = document.getElementById('wstega-sesji');
  if (wstega && wstega.remove) wstega.remove();
}

/* Logowanie w okienku nad ekranem tylko do odczytu — nic pod spodem nie znika. */
function oknoPonownegoLogowania() {
  const login = (stan.uz && stan.uz.login) || '';
  okno({
    tytul: 'Zaloguj się ponownie',
    tresc: `<p class="male">Nic nie zginęło — zapisy z telefonu wyślą się po zalogowaniu.</p>
      <label>Imię i nazwisko albo login
        <input id="pl-login" autocomplete="username" autocapitalize="none" value="${escHtml(login)}"></label>
      <label>PIN
        <input id="pl-pin" type="password" inputmode="numeric" autocomplete="current-password"></label>
      <div class="blad-logowania" id="pl-blad"></div>`,
    przyciski: [
      { napis: 'Później', klik: z => z() },
      { napis: 'Zaloguj', klasa: 'glowny', klik: async z => {
        const blad = document.getElementById('pl-blad');
        blad.textContent = '';
        zajety(true);
        try {
          await zalogujPonownie(document.getElementById('pl-login').value.trim(),
            document.getElementById('pl-pin').value);
          z();
        } catch (e) {
          blad.textContent = poLudzku(e);
        } finally {
          zajety(false);
        }
      } },
    ],
  });
}

async function zalogujPonownie(login, pin) {
  const poprzedni = stan.uz ? stan.uz.id : null;
  const ekran = stan.ekran;
  await zaloguj(login, pin);
  if (stan.uz.id !== poprzedni) {
    await wejdzDoAplikacji();                  // inna osoba: od zera, jak zwykłe logowanie
    return;
  }
  await odswiezStanSieci();
  synchronizuj(false);
  if (ekran) pokazEkran(ekran);                // świeże dane w tym samym miejscu
}

/* --------------------------------------------------------------- ekrany */

const NAZWA_ROLI = { admin: 'administrator', biuro: 'biuro', kierowca: 'kierowca' };

/* Trzy role, dwa progi. 'biuro' to wszystko, co robi sie w biurze; 'administrator'
   to dodatkowo konta i Ustawienia. Kierowca nie widzi ani jednego, ani drugiego. */
function jestBiuro() { return stan.uz && stan.uz.rola !== 'kierowca'; }
function jestAdministratorem() { return stan.uz && stan.uz.rola === 'admin'; }

function menuDlaRoli() {
  const biuro = jestBiuro();
  document.querySelectorAll('.tylko-biuro').forEach(e => e.classList.toggle('ukryty', !biuro));
  document.querySelectorAll('.tylko-administrator')
    .forEach(e => e.classList.toggle('ukryty', !jestAdministratorem()));
  document.querySelectorAll('.tylko-kierowca').forEach(e => e.classList.toggle('ukryty', biuro));
  // Arkusz powieksza na telefonie male przyciski kierowcy (style.css, rola-kierowca).
  document.body.classList.toggle('rola-kierowca', !biuro);
  // „Moje auto" otwiera GK Flota — ma sens tylko wtedy, gdy programy są połączone.
  const mojeAuto = !biuro && !!(stan.uz && stan.uz.flotex);
  const przyciskAuta = document.getElementById('btn-moje-auto');
  if (przyciskAuta) przyciskAuta.classList.toggle('ukryty', !mojeAuto);

  const dolne = biuro
    ? [['pulpit', '📊', 'Pulpit'], ['trasy', '🗺️', 'Trasy'],
       ['zalegle', '⏰', 'Zaległe'], ['klienci', '🏢', 'Klienci']]
    : [['moja', '🚚', 'Moja trasa'], ['zaladunek', '📦', 'Załadunek'],
       ['klienci', '🏢', 'Klienci'], ['raporty', '🕒', 'Raport pracy']]
      .concat(mojeAuto ? [['mojeauto', '🔧', 'Moje auto']] : []);
  const pasek = document.getElementById('pasek-dolny');
  pasek.innerHTML = dolne.map(([e, i, n]) =>
    `<button data-ekran="${e}"><span class="i">${i}</span><span>${n}</span></button>`).join('');
  pasek.querySelectorAll('button').forEach(b =>
    b.onclick = () => pokazEkran(b.dataset.ekran));
}

async function pokazEkran(nazwa, parametry) {
  const ekran = EKRANY[nazwa];
  if (!ekran) return;
  if (ekran.tylkoBiuro && !jestBiuro()) return;
  if (ekran.tylkoAdministrator && !jestAdministratorem()) return;
  stan.ekran = nazwa;
  document.getElementById('tytul-ekranu').textContent = ekran.tytul;
  document.querySelectorAll('.menu button[data-ekran], .pasek-dolny button[data-ekran]')
    .forEach(b => b.classList.toggle('wybrany', b.dataset.ekran === nazwa));
  zamknijMenu();
  const tresc = document.getElementById('tresc');
  tresc.innerHTML = '<div class="pusto">Wczytuję…</div>';
  window.scrollTo(0, 0);
  try {
    await ekran.rysuj(tresc, parametry || {});
  } catch (e) {
    tresc.innerHTML = `<div class="karta"><h2>Nie udało się wczytać</h2>
      <p class="slaby">${escHtml(poLudzku(e))}</p>
      <button class="glowny" onclick="pokazEkran('${nazwa}')">Spróbuj ponownie</button></div>`;
  }
}

function otworzMenu() {
  document.getElementById('menu').classList.add('otwarte');
  document.getElementById('zaslona').classList.add('widoczna');
}
function zamknijMenu() {
  document.getElementById('menu').classList.remove('otwarte');
  document.getElementById('zaslona').classList.remove('widoczna');
}

/* ------------------------------------------------------ dane podstawowe */

/* Nasze miejsca pobieramy ŚWIEŻO za każdym razem, gdy ma się z nich wybierać.

   Lista jest krótka (kilka pozycji), więc to nic nie kosztuje — a trzymanie jej
   w pamięci raz na sesję kończyło się tym, że po skasowaniu albo połączeniu
   magazynów biuro dalej widziało w trasie stan sprzed zmiany. Kopia w pamięci
   służy już tylko na wypadek braku sieci.                                     */
async function odswiezLokalizacje() {
  try {
    stan.lokalizacje = await API.get('/api/lokalizacje');
  } catch (e) {
    stan.lokalizacje = stan.lokalizacje || [];      // bez sieci zostaje kopia
  }
  return stan.lokalizacje;
}

async function wczytajSlowniki() {
  try {
    // Lokalizacje sa tu razem z klientami, bo okno dodawania punktow do trasy
    // musi je miec ZAWSZE — takze po odswiezeniu strony wprost na ekranie trasy,
    // z pominieciem pulpitu. Kierowca ich nie pobierze (endpoint jest dla biura),
    // wiec brak uprawnien traktujemy jak pusta liste, a nie jak awarie.
    const [klienci, pojazdy, ustawienia, lokalizacje] = await Promise.all([
      API.get('/api/klienci'), API.get('/api/pojazdy'), API.get('/api/ustawienia'),
      API.get('/api/lokalizacje').catch(() => []),
    ]);
    stan.klienci = klienci; stan.pojazdy = pojazdy; stan.ustawienia = ustawienia;
    stan.lokalizacje = lokalizacje;
    await Kolejka.zapamietaj('slowniki', { klienci, pojazdy, ustawienia, lokalizacje });
  } catch (e) {
    const kopia = await Kolejka.przypomnij('slowniki');
    if (kopia) {
      stan.klienci = kopia.klienci; stan.pojazdy = kopia.pojazdy; stan.ustawienia = kopia.ustawienia;
      stan.lokalizacje = kopia.lokalizacje || [];
      komunikat('Brak połączenia — pracuję na danych z ostatniej synchronizacji');
    } else {
      stan.klienci = []; stan.pojazdy = []; stan.ustawienia = {}; stan.lokalizacje = [];
      komunikat('Brak połączenia i brak kopii danych w telefonie', 'blad');
    }
  }
}

function powodyNieudanych() {
  return (stan.ustawienia.powody_nieudanych || '')
    .split('\n').map(s => s.trim()).filter(Boolean);
}

/* Przegladarki wpuszczaja tryb offline (service worker) tylko na localhost
   albo po HTTPS. Pod zwyklym http://192.168… jest wylaczony i nie da sie tego
   obejsc — wiec zamiast po cichu nie dzialac, mowimy o tym wprost.          */
function trybOffline() {
  if (!('serviceWorker' in navigator)) {
    return {
      pelny: false,
      opis: 'ograniczony',
      wyjasnienie: 'Aplikacja trzyma potwierdzenia bez zasięgu i wysyła je po powrocie, ' +
        'ale musi być otwarta od wyjazdu. Otwórz ją jeszcze na firmowym wifi. ' +
        'Pełny tryb offline włącza dopiero adres z https:// — patrz instrukcja.',
    };
  }
  return {
    pelny: true,
    opis: 'pełny',
    wyjasnienie: 'Aplikacja otwiera się i działa bez zasięgu, także po ponownym ' +
      'uruchomieniu telefonu.',
  };
}

/* ---------------------------------------------------------------- konto */

/* Trzy stemple wersji w jednym miejscu: pliki na dysku serwera, skrypt
   wczytany do przeglądarki i arkusz wczytany do przeglądarki. Gdy się różnią,
   przeglądarka chodzi na starej kopii — i to widać od razu, bez zgadywania.
   Do tego kilka żywych liczb o warstwach okna, bo mapa nad oknem wracała
   czterokrotnie i za każdym razem brakowało właśnie tych danych.           */
function stempelWersji() {
  const dysk = stan.uz.wersja || '?';
  const skrypt = (typeof WERSJA_SKRYPTU === 'string') ? WERSJA_SKRYPTU : '?';
  const arkusz = (getComputedStyle(document.documentElement)
    .getPropertyValue('--wersja-arkusza') || '?').replace(/['"\s]/g, '') || '?';
  // Na GitHub Pages wygląd i program w biurze to dwie niezależne kopie —
  // o spójności przeglądarki mówią wtedy tylko skrypt i arkusz z jednej paczki.
  const osobneAdresy = !!API_BAZA;
  const zgodne = osobneAdresy ? skrypt === arkusz : (dysk === skrypt && dysk === arkusz);
  const pagesStarsze = osobneAdresy && zgodne && dysk !== '?' && dysk !== skrypt;
  return `
    <div class="wstega ${zgodne ? 'info' : 'blad'}" id="stempel-wersji" style="margin-top:10px">
      <b>${zgodne ? 'Program aktualny' : 'Przeglądarka ma starą kopię programu'}</b>
      <div class="male" style="margin-top:6px; font-weight:400">
        ${osobneAdresy ? 'program w biurze' : 'pliki na dysku'}: <code>${escHtml(dysk)}</code><br>
        skrypt w przeglądarce: <code>${escHtml(skrypt)}</code><br>
        arkusz w przeglądarce: <code>${escHtml(arkusz)}</code><br>
        ${osobneAdresy ? `aplikacja z GitHub Pages, dane: <code>${escHtml(API_BAZA)}</code><br>` : ''}
        warstwa okna: <code id="stempel-warstwa">…</code>
      </div>
      ${pagesStarsze ? `<div class="male" style="margin-top:6px">Na GitHub Pages jest inna wersja
        aplikacji niż program w biurze — administrator: Ustawienia → „Wyślij aplikację na GitHub”.</div>` : ''}
      ${zgodne ? '' : `<button class="maly" id="btn-odswiez-program" style="margin-top:8px">
        Odśwież program</button>`}
    </div>`;
}

/* Czyści pamięć podręczną aplikacji i wczytuje ją od nowa. Dane firmy są na
   serwerze, a niewysłane zapisy w IndexedDB — tego NIE ruszamy. */
/* Trzy stemple muszą być zgodne: pliki na dysku, skrypt i arkusz w przeglądarce.
   Gdy nie są, przeglądarka chodzi na MIESZANCE wersji — a to potrafi się zdarzyć
   przy jednym mrugnięciu sieci, bo service worker podaje wtedy pojedynczy plik
   z kopii. Taka mieszanka niczego nie zgłasza: stary i nowy plik parsują się
   tak samo poprawnie, aplikacja po prostu zachowuje się nie tak, jak w kodzie.
   Dlatego program naprawia to sam, raz na sesję — bez proszenia o cokolwiek. */
async function sprawdzSpojnoscWersji() {
  const dysk = (stan.uz && stan.uz.wersja) || '';
  if (!dysk || dysk === '?') return;
  const skrypt = (typeof WERSJA_SKRYPTU === 'string') ? WERSJA_SKRYPTU : '';
  const arkusz = (getComputedStyle(document.documentElement)
    .getPropertyValue('--wersja-arkusza') || '').replace(/['"\s]/g, '');

  // API_BAZA niepuste: wygląd z GitHub Pages, dane z programu w biurze — dwie
  // NIEZALEŻNE kopie. Rozjazd z programem znaczy wtedy „biuro nie wysłało nowej
  // wersji”, a nie „przeglądarka ma mieszankę”. Kasowanie pamięci niczego by
  // nie naprawiło, a przeładowanie w kółko zostawiłoby kierowcę bez aplikacji.
  // Mieszankę poznaje się wtedy po dwóch plikach z TEJ SAMEJ paczki.
  const osobneAdresy = !!API_BAZA;
  const mieszanka = (skrypt !== arkusz) || (!osobneAdresy && dysk !== skrypt);
  if (!mieszanka) {
    // O nieopublikowanej wersji mówimy temu, kto może to naprawić — kierowca
    // nie ma dostępu do Ustawień i dostałby ostrzeżenie bez wyjścia.
    if (osobneAdresy && dysk !== skrypt && jestAdministratorem()) {
      komunikat('Na GitHub Pages jest inna wersja aplikacji niż program w biurze. '
        + 'Ustawienia → „Wyślij aplikację na GitHub”.', 'blad');
    }
    return;
  }
  // Bez zasięgu kasowanie pamięci podręcznej jest nie do odrobienia: po
  // przeładowaniu nie ma skąd wziąć plików i kierowca zostaje ze stroną błędu.
  if (!navigator.onLine) {
    komunikat('Program chodzi na mieszance wersji. Naprawię to przy najbliższym '
      + 'zasięgu — na razie pracuj dalej.', 'blad');
    return;
  }

  // sessionStorage też jest wspólny dla całego źródła Pages — stąd przedrostek.
  const klucz = Pamiec.PRZEDROSTEK + 'naprawa-wersji';
  const proba = osobneAdresy ? skrypt + '|' + arkusz : dysk;
  let juzProbowano = false;
  try { juzProbowano = sessionStorage.getItem(klucz) === proba; } catch (e) { /* tryb prywatny */ }
  if (juzProbowano) {
    // Druga próba nic nie da — mówimy wprost zamiast kręcić się w kółko.
    komunikat('Przeglądarka chodzi na mieszance wersji programu. '
      + 'Otwórz 👤 Moje konto i pokaż tę ramkę serwisantowi.', 'blad');
    return;
  }
  try { sessionStorage.setItem(klucz, proba); } catch (e) { /* trudno */ }
  komunikat('Porządkuję pliki programu — chwila…', 'ok');
  await odswiezProgram();
}

/* Kasuje TYLKO własny service worker i własne pamięci podręczne (trasex-…).
   Na wspólnym źródle GitHub Pages leżą obok nich te z GK Flota i aplikacji
   hali — skasowanie wszystkiego zabrałoby kierowcy offline w innym programie. */
async function odswiezProgram() {
  try {
    if ('serviceWorker' in navigator) {
      // getRegistration() bez adresu = worker TEJ strony. Lista wszystkich
      // rejestracji oddałaby workery wszystkich aplikacji GK na wspólnym źródle Pages.
      const nasz = await navigator.serviceWorker.getRegistration();
      if (nasz) await nasz.unregister();
    }
    if (window.caches) {
      const klucze = await caches.keys();
      await Promise.all(klucze.filter(k => k.indexOf('trasex-') === 0).map(k => caches.delete(k)));
    }
  } catch (e) { /* i tak przeladujemy */ }
  location.reload();
}

function oknoKonta() {

  okno({
    tytul: 'Moje konto',
    tresc: `
      <p><b>${escHtml(stan.uz.imie)}</b> · ${escHtml(stan.uz.login)}
         · ${NAZWA_ROLI[stan.uz.rola] || stan.uz.rola}</p>
      ${stempelWersji()}
      <fieldset><legend>Wygląd</legend>
        <label class="plaska"><input type="radio" name="motyw" value="jasny">Jasny</label>
        <label class="plaska"><input type="radio" name="motyw" value="ciemny">Ciemny</label>
        <label class="plaska"><input type="radio" name="motyw" value="auto">Jak w telefonie</label>
        <p class="male slaby">Dotyczy tego urządzenia, nie konta — zostaje po wylogowaniu,
           a na wspólnym telefonie widzą to samo wszyscy.</p>
      </fieldset>
      <fieldset><legend>Powiadomienia</legend>
        <p class="male slaby">${jestBiuro()
          ? 'Nieudana dostawa i raport z usterkami — od razu, także przy zamkniętej aplikacji.'
          : 'Nowe albo zmienione zlecenie na dziś i jutro oraz uwagi od biura — także przy zamkniętej aplikacji.'}</p>
        <div id="push-konto"><p class="male slaby">Sprawdzam…</p></div>
      </fieldset>
      <fieldset><legend>Zmiana PIN-u</legend>
        ${stan.uz.zrodlo === 'gk' && stan.uz.konta_z_panelu ? `<p class="male slaby">Konto z Panelu
          (GK Panel Kierownika) — nowy PIN działa we wszystkich aplikacjach GK.</p>` : ''}
        <label>Obecny PIN<input id="pin-stary" type="password" inputmode="numeric"></label>
        <label>${stan.uz.zrodlo === 'gk' && stan.uz.konta_z_panelu
          ? (jestBiuro() ? 'Nowe hasło (min. 8 znaków)' : 'Nowy PIN (4–8 cyfr)')
          : 'Nowy PIN (min. 4 znaki)'}<input id="pin-nowy" type="password" inputmode="numeric"></label>
        <button class="glowny" id="btn-zmien-pin">Zmień PIN</button>
      </fieldset>
      <fieldset><legend>Dane w tym telefonie</legend>
        <p class="male slaby">W kolejce do wysłania: <b id="ile-w-kolejce">…</b></p>
        <p class="male slaby ${stan.obceWKolejce ? '' : 'ukryty'}" id="obce-w-kolejce"></p>
        <div id="odrzucone-zapisy"></div>
        <p class="male slaby">Tryb offline: <b>${escHtml(trybOffline().opis)}</b><br>
           ${escHtml(trybOffline().wyjasnienie)}</p>
        <div class="przyciski">
          <button id="btn-wyslij-teraz">Wyślij teraz</button>
          <button id="btn-wyloguj-2">Wyloguj</button>
        </div>
      </fieldset>`,
    poOtwarciu: pole => {
      // Przełącza się od razu, bez zamykania okna: cały wygląd wisi na jednym
      // atrybucie <html>, więc nie ma czego przerysowywać.
      const motyw = Motyw.odczytaj();
      pole.querySelectorAll('input[name=motyw]').forEach(r => {
        r.checked = (r.value === motyw);
        r.onchange = () => Motyw.ustaw(r.value);
      });
      rysujPowiadomienia(pole.querySelector('#push-konto'));
      pole.querySelector('#ile-w-kolejce').textContent = stan.wKolejce;
      if (stan.obceWKolejce) {
        pole.querySelector('#obce-w-kolejce').innerHTML =
          `⚠️ Dodatkowo <b>${stan.obceWKolejce}</b> ${odmiana(stan.obceWKolejce,
            'zapis czeka', 'zapisy czekają', 'zapisów czeka')} na inną osobę,
           która pracowała na tym telefonie. Wyślą się, gdy ta osoba się tu zaloguje —
           nie kasuj danych aplikacji, bo przepadną.`;
      }
      pole.querySelector('#btn-zmien-pin').onclick = async () => {
        const stary = pole.querySelector('#pin-stary').value;
        const nowy = pole.querySelector('#pin-nowy').value;
        const w = await sprobuj(() => API.post('/api/zmien-pin', { stary, nowy }),
          'Hasło zmienione — pozostałe urządzenia zostały wylogowane');
        if (!w) return;
        // Zmiana hasła unieważnia stare sesje, więc trzeba przejąć nowy token,
        // inaczej wyrzuciłoby z aplikacji osobę, która właśnie ją zmieniła.
        if (w.token) { stan.token = w.token; Pamiec.zapisz('token', w.token); }
        zamknijOkno();
      };
      rysujOdrzucone(pole.querySelector('#odrzucone-zapisy'));
      pole.querySelector('#btn-wyslij-teraz').onclick = () => synchronizuj(false);
      const odswiez = pole.querySelector('#btn-odswiez-program');
      if (odswiez) odswiez.onclick = odswiezProgram;
      // liczone teraz, gdy okno JUZ jest otwarte — wczesniej zawsze pokazywalo „brak"
      const warstwa = pole.querySelector('#stempel-warstwa');
      if (warstwa) {
        const st = getComputedStyle(document.getElementById('okno-tlo'));
        const mapa = document.querySelector('.leaflet-container');
        warstwa.textContent = `${st.position} / z-index ${st.zIndex}`
          + ` · body: ${document.body.classList.contains('okno-otwarte') ? 'okno-otwarte' : 'brak'}`
          + (mapa ? ` · mapa: ${getComputedStyle(mapa).visibility}` : ' · mapy brak na ekranie');
      }
      pole.querySelector('#btn-wyloguj-2').onclick = () => { zamknijOkno(); wyloguj(); };
    },
  });
}

/* Zapisy, ktorych serwer nie przyjal. Nie kasujemy ich za czlowieka —
   pokazujemy, co i dlaczego nie przeszlo, i zostawiamy decyzje jemu.        */
async function rysujOdrzucone(pole) {
  const lista = await Kolejka.listaOdrzuconych();
  if (!lista.length) { pole.innerHTML = ''; return; }

  const opis = (o) => {
    if (o.typ === 'dostawa') {
      const zalaczniki = (o.podpis ? 1 : 0) + ((o.zdjecia || []).length);
      return `Dostawa (punkt ${o.przystanek})`
        + (zalaczniki ? ` · ${zalaczniki} ${odmiana(zalaczniki, 'załącznik', 'załączniki', 'załączników')}` : '');
    }
    if (o.typ === 'raport') return `Raport pracy z ${polskaData(o.data)}`;
    if (o.typ === 'pozycje') return 'Ślad GPS';
    if (o.typ === 'stan_trasy') return 'Rozpoczęcie/zakończenie trasy';
    return o.typ;
  };

  pole.innerHTML = `
    <div class="wstega uwaga" style="margin-top:12px">
      <b>${lista.length} ${odmiana(lista.length, 'zapis nie przeszedł', 'zapisy nie przeszły',
        'zapisów nie przeszło')}.</b> Nic nie zostało skasowane — leżą w tym telefonie.
      Pokaż to biuru; gdy usuną przyczynę, dotknij „Spróbuj ponownie".
    </div>
    ${lista.map(o => `<div class="karta scisla" style="margin-bottom:8px">
        <div class="male"><b>${escHtml(opis(o))}</b></div>
        <div class="male slaby">${escHtml(o.blad)}</div>
        <div class="male slaby">zapisane ${escHtml(czasZIso(o.dodano))}</div>
        <div class="przyciski" style="margin-top:8px">
          <button class="maly" data-ponow="${escHtml(o.uuid)}">Spróbuj ponownie</button>
          <button class="maly" data-porzuc="${escHtml(o.uuid)}">Porzuć</button>
        </div>
      </div>`).join('')}`;

  pole.querySelectorAll('[data-ponow]').forEach(b => b.onclick = async () => {
    await Kolejka.ponow(b.dataset.ponow);
    await odswiezStanSieci();
    await rysujOdrzucone(pole);
    synchronizuj(false);
  });
  pole.querySelectorAll('[data-porzuc]').forEach(b => b.onclick = async () => {
    if (!await potwierdz('Porzucić ten zapis?',
      'Zniknie z telefonu na dobre. Jeśli był w nim podpis albo zdjęcia — nie da się ich odzyskać.')) return;
    await Kolejka.zapomnijOdrzucona(b.dataset.porzuc);
    await odswiezStanSieci();
    await rysujOdrzucone(pole);
  });
}

/* ----------------------------------------------------------------- start */

async function uruchom() {
  document.getElementById('form-logowania').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const pole = document.getElementById('blad-logowania');
    pole.textContent = '';
    zajety(true);
    try {
      await zaloguj(f.get('login').trim(), f.get('pin'));
      await wejdzDoAplikacji();
    } catch (blad) {
      pole.textContent = poLudzku(blad);
    } finally {
      zajety(false);
    }
  };

  document.getElementById('btn-menu').onclick = otworzMenu;
  document.getElementById('zaslona').onclick = zamknijMenu;
  document.getElementById('okno-zamknij').onclick = zamknijZPytaniem;
  document.getElementById('okno-tlo').onclick = e => {
    if (e.target.id === 'okno-tlo') zamknijZPytaniem();
  };
  document.getElementById('btn-konto').onclick = oknoKonta;
  // Podpowiedź w atrybucie title jest na telefonie niewidzialna, a to właśnie
  // kierowca ma się dowiedzieć, że coś nie przeszło. Kropka musi być klikalna.
  document.getElementById('stan-sieci-btn').onclick = oknoKonta;
  document.getElementById('btn-szukaj').onclick = oknoSzukania;
  document.getElementById('btn-wyloguj').onclick = () => wyloguj();
  document.querySelectorAll('.menu button[data-ekran]').forEach(b =>
    b.onclick = () => pokazEkran(b.dataset.ekran));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') zamknijZPytaniem(); });

  /* „Jak w telefonie” ma nadążyć, gdy telefon sam przełączy się o zmierzchu
     przy otwartej aplikacji. addListener to wersja dla starszych przeglądarek. */
  try {
    const czujnik = window.matchMedia('(prefers-color-scheme: dark)');
    if (czujnik.addEventListener) czujnik.addEventListener('change', () => Motyw.zastosuj());
    else if (czujnik.addListener) czujnik.addListener(() => Motyw.zastosuj());
  } catch (e) { /* bez tego motyw po prostu nie zmieni się w locie */ }

  window.addEventListener('online', () => { odswiezStanSieci(); synchronizuj(); });
  window.addEventListener('offline', odswiezStanSieci);
  setInterval(() => { if (navigator.onLine) synchronizuj(); }, 25000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && navigator.onLine) synchronizuj();
  });

  if ('serviceWorker' in navigator) {
    /* Aplikacja sama bierze nową wersję.

       Bez tego poprawka mogła leżeć na dysku, a przeglądarka i telefon dalej
       chodziły na starej kopii — i tak właśnie dwa razy „nie zadziałała"
       poprawka układu mapy. Service worker po instalacji nowej wersji przejmuje
       stronę (skipWaiting + clients.claim w sw.js), a wtedy przeglądarka zgłasza
       controllerchange. Wtedy przeładowujemy stronę DOKŁADNIE RAZ — strażnik
       przeladowano pilnuje, żeby nie wpaść w pętlę odświeżania.               */
    let przeladowano = false;
    // Przy PIERWSZEJ instalacji też pada controllerchange, choć nic się nie
    // zmieniło w plikach — przeładowanie byłoby wtedy tylko mignięciem ekranu.
    // Odświeżamy więc tylko wtedy, gdy stronę prowadził już jakiś worker.
    const bylJuzWorker = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (przeladowano || !bylJuzWorker) return;
      przeladowano = true;
      przeladujPoNowejWersji();
    });
    // Kursor wyszedl z pola (kierowca skonczyl pisac) — moze juz wolno.
    document.addEventListener('focusout', () => setTimeout(sprobujZaleglegoPrzeladowania, 0));
    // Dotknięcie powiadomienia przy OTWARTEJ aplikacji: sw.js nie otwiera
    // drugiego okna, tylko prosi to o pokazanie właściwego ekranu.
    if (navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data && e.data.typ === 'otworz') otworzAdres(e.data.adres);
      });
    }
    navigator.serviceWorker.register('sw.js')
      .then(rejestracja => {
        // Sprawdzenie przy każdym wejściu i raz na godzinę dla telefonu,
        // który potrafi zostać otwarty przez cały dzień w busie.
        rejestracja.update().catch(() => {});
        setInterval(() => rejestracja.update().catch(() => {}), 3600 * 1000);
      })
      .catch(() => { /* dziala tez bez tego */ });
  }

  await odswiezStanSieci();
  if (stan.token) {
    try {
      stan.uz = await API.get('/api/ja');
      await Kolejka.zapamietaj('profil', stan.uz);
      await wejdzDoAplikacji();
      return;
    } catch (e) {
      // Rozroznienie jest tu najwazniejsze: gdy serwer odrzucil sesje,
      // API.get juz wyczyscilo token i trzeba sie zalogowac. Gdy padla sama
      // siec — token dalej jest dobry, a kierowca stoi w polu i musi wejsc.
      const profil = await Kolejka.przypomnij('profil');
      if (stan.token && profil) {
        stan.uz = profil;
        await wejdzDoAplikacji();
        komunikat('Brak połączenia — pracujesz na danych z telefonu');
        return;
      }
    }
  }
  pokazLogowanie();
}

async function wejdzDoAplikacji() {
  document.getElementById('ekran-logowania').classList.add('ukryty');
  document.getElementById('aplikacja').classList.remove('ukryty');
  document.getElementById('menu-imie').textContent = stan.uz.imie;
  document.getElementById('menu-rola').textContent = NAZWA_ROLI[stan.uz.rola] || stan.uz.rola;
  menuDlaRoli();
  // Zanim cokolwiek narysujemy: czy przegladarka na pewno ma komplet plikow
  // z jednej wersji. Gdy nie — funkcja sama przeladuje aplikacje.
  await sprawdzSpojnoscWersji();
  await wczytajSlowniki();
  synchronizuj();
  // Aplikację otworzyło dotknięcie powiadomienia (sw.js: „./#trasa=12”) —
  // od razu właściwy ekran, a adres czyścimy, żeby odświeżenie nie wracało tam.
  const zPowiadomienia = location.hash;
  if (zPowiadomienia) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* trudno */ }
  }
  if (!otworzAdres(zPowiadomienia)) pokazEkran(jestBiuro() ? 'pulpit' : 'moja');
  if (stan.uz.haslo_startowe) oknoStartowegoHasla();
}

/* Fabryczne hasło „1234" na koncie kierowniczym, przy adresie dostępnym
   z internetu, to najprostsza droga do tego, żeby ktoś obcy zobaczył całą firmę.
   Dlatego pytamy o zmianę przy każdym wejściu, dopóki nie zostanie zmienione.  */
function oknoStartowegoHasla() {
  const nazwa = NAZWA_ROLI[stan.uz.rola] || 'biuro';
  okno({
    tytul: 'Zmień fabryczne hasło',
    tresc: `<div class="wstega uwaga">Konto „${escHtml(nazwa)}" ma nadal hasło startowe <b>1234</b>.</div>
      <p class="male">To konto widzi całą firmę — klientów, trasy, raporty i ślady GPS.
         Jeśli aplikacja jest dostępna z internetu, zostawienie tego hasła oznacza,
         że dostanie się tu każdy, kto zgadnie adres.</p>
      <label>Nowe hasło <span class="slaby">(min. 8 znaków)</span>
        <input id="sh-nowe" type="password" autocomplete="new-password"></label>
      <label>Powtórz hasło
        <input id="sh-powtorz" type="password" autocomplete="new-password"></label>`,
    przyciski: [
      { napis: 'Później', klik: z => z() },
      { napis: 'Zmień teraz', klasa: 'glowny', klik: async z => {
        const nowe = document.getElementById('sh-nowe').value;
        if (nowe !== document.getElementById('sh-powtorz').value) {
          komunikat('Hasła się nie zgadzają', 'blad');
          return;
        }
        const w = await sprobuj(() => API.post('/api/zmien-pin', { stary: '1234', nowy: nowe }),
          'Hasło zmienione');
        if (!w) return;
        if (w.token) { stan.token = w.token; Pamiec.zapisz('token', w.token); }
        stan.uz.haslo_startowe = false;
        z();
      } },
    ],
  });
}

document.addEventListener('DOMContentLoaded', uruchom);
