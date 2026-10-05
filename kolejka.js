/* Kolejka offline.
   Serce trybu terenowego: kierowca potwierdza dostawe, a program NIE probuje
   od razu jej wyslac. Wklada ja do kolejki w telefonie i od razu maluje wynik
   na ekranie. Wysylka dzieje sie w tle, kiedy jest siec. Kazda operacja ma
   swoj numer (uuid), wiec nawet wyslana dwa razy zapisze sie tylko raz.      */

const Kolejka = (() => {
  const NAZWA_BAZY = 'trasy-offline';
  const WERSJA = 2;
  let baza = null;

  function otworz() {
    if (baza) return Promise.resolve(baza);
    return new Promise((zwroc, odrzuc) => {
      const zadanie = indexedDB.open(NAZWA_BAZY, WERSJA);
      zadanie.onupgradeneeded = () => {
        const db = zadanie.result;
        if (!db.objectStoreNames.contains('kolejka')) db.createObjectStore('kolejka', { keyPath: 'uuid' });
        if (!db.objectStoreNames.contains('pamiec')) db.createObjectStore('pamiec', { keyPath: 'klucz' });
        // Osobna polka na zapisy, ktorych serwer nie przyjal. Nic stad nie
        // znika samo — podpis i zdjecia z rampy sa jedynymi danymi w tym
        // programie, ktorych nie da sie odtworzyc.
        if (!db.objectStoreNames.contains('odrzucone')) db.createObjectStore('odrzucone', { keyPath: 'uuid' });
      };
      zadanie.onsuccess = () => { baza = zadanie.result; zwroc(baza); };
      zadanie.onerror = () => odrzuc(zadanie.error);
    });
  }

  function dzialanie(magazyn, tryb, praca) {
    return otworz().then(db => new Promise((zwroc, odrzuc) => {
      const t = db.transaction(magazyn, tryb);
      const zadanie = praca(t.objectStore(magazyn));
      t.oncomplete = () => zwroc(zadanie ? zadanie.result : undefined);
      t.onerror = () => odrzuc(t.error);
    }));
  }

  function numer() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'x-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  return {
    numer,
    /* Operacja trafia do kolejki i tam czeka. Kolejnosc zachowana przez 'dodano'. */
    dodaj(op) {
      op.uuid = op.uuid || numer();
      op.dodano = op.dodano || new Date().toISOString();
      op.prob = 0;
      return dzialanie('kolejka', 'readwrite', s => s.put(op)).then(() => op);
    },
    lista() {
      return dzialanie('kolejka', 'readonly', s => s.getAll())
        .then(w => (w || []).sort((a, b) => a.dodano.localeCompare(b.dodano)));
    },
    usun(uuid) { return dzialanie('kolejka', 'readwrite', s => s.delete(uuid)); },
    ile() { return dzialanie('kolejka', 'readonly', s => s.count()); },
    oznaczProbe(op) {
      op.prob = (op.prob || 0) + 1;
      return dzialanie('kolejka', 'readwrite', s => s.put(op));
    },

    /* Uzupelnia operacje, ktora jeszcze czeka w kolejce. Gdy juz poszla —
       nic sie nie dzieje i tak ma byc (dotyczy tylko dodatkow w rodzaju GPS). */
    uzupelnij(uuid, pola) {
      return dzialanie('kolejka', 'readonly', s => s.get(uuid)).then(op => {
        if (!op) return null;
        return dzialanie('kolejka', 'readwrite', s => s.put(Object.assign(op, pola)));
      });
    },

    /* Przeniesienie do odrzuconych zamiast skasowania. Operacja zostaje
       w telefonie z powodem odmowy, dopoki czlowiek jej nie obejrzy. */
    odrzuc(op, blad) {
      const odrzucona = Object.assign({}, op, {
        blad: String(blad || 'nieznany powód'),
        odrzucono: new Date().toISOString(),
      });
      return dzialanie('odrzucone', 'readwrite', s => s.put(odrzucona))
        .then(() => dzialanie('kolejka', 'readwrite', s => s.delete(op.uuid)));
    },
    listaOdrzuconych() {
      return dzialanie('odrzucone', 'readonly', s => s.getAll()).then(w => w || []);
    },
    ileOdrzuconych() { return dzialanie('odrzucone', 'readonly', s => s.count()); },
    zapomnijOdrzucona(uuid) {
      return dzialanie('odrzucone', 'readwrite', s => s.delete(uuid));
    },
    /* Powrot odrzuconej do kolejki — po tym, jak biuro naprawilo przyczyne. */
    ponow(uuid) {
      return dzialanie('odrzucone', 'readonly', s => s.get(uuid)).then(op => {
        if (!op) return null;
        delete op.blad;
        delete op.odrzucono;
        op.prob = 0;
        return dzialanie('kolejka', 'readwrite', s => s.put(op))
          .then(() => dzialanie('odrzucone', 'readwrite', s => s.delete(uuid)));
      });
    },

    /* Podreczna pamiec na dane, ktore musza byc widoczne bez sieci:
       moja trasa na dzis, lista klientow, ustawienia.                        */
    zapamietaj(klucz, wartosc) {
      return dzialanie('pamiec', 'readwrite',
        s => s.put({ klucz, wartosc, kiedy: new Date().toISOString() }));
    },
    przypomnij(klucz) {
      return dzialanie('pamiec', 'readonly', s => s.get(klucz)).then(w => (w ? w.wartosc : null));
    },
    /* Kasuje JEDEN wpis podręcznej pamięci. Używane przy wylogowaniu, żeby
       kartoteka klientów nie została w telefonie po odejściu kierowcy.
       Kolejki i odrzuconych to nie dotyka — tam leżą podpisy i zdjęcia. */
    zapomnij(klucz) {
      return dzialanie('pamiec', 'readwrite', s => s.delete(klucz));
    },
  };
})();
