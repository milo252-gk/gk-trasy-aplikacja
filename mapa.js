/* Mapa: Leaflet + kafelki OpenStreetMap.

   Dlaczego OSM, a nie Mapy Google: OSM jest naprawdę bezpłatny — bez konta,
   bez karty płatniczej i bez limitu wyświetleń. Mapy Google wymagają konta
   rozliczeniowego z kartą nawet w darmowym progu (10 000 wyświetleń/mies.,
   potem ok. 7 USD za 1000, bez automatycznego ogranicznika wydatków).
   Właściciel świadomie wybrał OSM (2026-09-03).

   To NIE dotyczy odnośników „Wyślij do Google Maps" i nawigacji u kierowcy —
   te zostają, bo są zwykłymi adresami internetowymi i nic nie kosztują.

   Warunki OSM, których trzymamy się w kodzie (operations.osmfoundation.org):
     • widoczna atrybucja „© OpenStreetMap contributors",
     • wyłącznie https i dokładnie ten adres kafelków,
     • ŻADNEGO buforowania kafelków ani pracy offline — dlatego service worker
       (sw.js) celowo przepuszcza wszystko, co idzie poza nasz serwer,
     • żadnego pobierania zapasowego: ściągamy tylko to, co ktoś właśnie ogląda.

   Sam program działa bez mapy; mapa to podgląd, nie warunek pracy.          */

const Mapa = (() => {
  const SRODEK_PL = [52.07, 19.48];
  /* Stałe NIEZALEŻNE od motywu: obie linie leżą na jasnych kafelkach OSM,
     a nie na tle programu. Nie podpinać ich pod --pomarancz/--strefa —
     rozjaśnienie tokenów w motywie ciemnym wyprałoby trasę z mapy.          */
  const BARWA_TRASY = '#E0922E';        // pomarańcz GK Factory
  const BARWA_SLADU = '#BA212D';        // czerwień Strefy Płyt

  const zwykla = L.icon({
    iconUrl: 'vendor/marker-icon.png', iconRetinaUrl: 'vendor/marker-icon-2x.png',
    shadowUrl: 'vendor/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41],
  });

  function znacznikNumer(numer, klasa) {
    return L.divIcon({
      className: '', iconSize: [26, 26], iconAnchor: [13, 13],
      html: '<div class="znacznik-nr ' + (klasa || '') + '">' + numer + '</div>',
    });
  }

  /* --------------------------------------------------- wspólne pomocnicze */

  function wsp(punkt) {                       // [lat, lon] albo {lat, lng}
    return Array.isArray(punkt) ? { lat: punkt[0], lng: punkt[1] } : punkt;
  }

  function dodajWarstwe(mapa, warstwa) {
    (mapa._nasze = mapa._nasze || []).push(warstwa);
    return warstwa;
  }

  function wyczysc(mapa) {
    (mapa._nasze || []).forEach(w => mapa.removeLayer(w));
    mapa._nasze = [];
  }

  function znacznik(mapa, punkt, napis, klasa, bok, dymek, klik) {
    const p = wsp(punkt);
    const ikona = L.divIcon({
      className: '', iconSize: [bok, bok], iconAnchor: [bok / 2, bok / 2],
      html: '<div class="znacznik-nr ' + (klasa || '') + '">' + napis + '</div>',
    });
    const m = L.marker([p.lat, p.lng], { icon: ikona }).addTo(mapa);
    if (dymek) m.bindPopup(dymek);
    if (klik) m.on('click', klik);
    return dodajWarstwe(mapa, m);
  }

  function linia(mapa, punkty, barwa, grubosc, przerywana) {
    const l = L.polyline(punkty.map(p => { const q = wsp(p); return [q.lat, q.lng]; }), {
      color: barwa, weight: grubosc, opacity: przerywana ? .55 : .9,
      dashArray: przerywana ? '7 8' : undefined,
    }).addTo(mapa);
    return dodajWarstwe(mapa, l);
  }

  /* Firma ma dwa znaki: GK Factory i Strefę Płyt. Markę rozpoznajemy po nazwie
     lokalizacji, bo tak są nazwane w kartotece („Strefa Płyt Wolsztyn").
     Sam znaczek jest kwadratem w barwie marki — logo w 30 px byłoby nieczytelne,
     więc pełny znak pokazujemy dopiero w dymku po dotknięciu. */
  function markaLokalizacji(nazwa) {
    return /strefa/i.test(nazwa || '') ? 'strefa' : 'gkf';
  }

  function dymekLokalizacji(l, marka) {
    return '<div class="dymek-lokalizacji">'
      + '<img src="' + (marka === 'strefa' ? 'logo-strefa.jpg' : 'logo-gkf.png') + '" alt="">'
      + '<b>' + escHtml(l.nazwa) + '</b><br>' + escHtml(adresJednymCiagiem(l) || '')
      + (l.domyslna ? '<br><i>domyślna baza firmy</i>' : '') + '</div>';
  }

  /* ------------------------------------------------- rejestr i zakładanie */

  /* Rejestr wszystkich map — po zamknięciu okna trzeba im powiedzieć, że znów
     są widoczne, inaczej Leaflet zostaje z rozmiarem policzonym „na ślepo". */
  const WSZYSTKIE = [];

  function odswiezWszystkie() {
    for (let i = WSZYSTKIE.length - 1; i >= 0; i--) {
      const m = WSZYSTKIE[i];
      if (!m._container || !document.body.contains(m._container)) {
        WSZYSTKIE.splice(i, 1);                 // mapa z ekranu, którego już nie ma
        continue;
      }
      try {
        m.invalidateSize();
        if (m._ostatnieDopasowanie) dopasujWidok(m, m._ostatnieDopasowanie);
      } catch (e) { /* mapa w trakcie usuwania */ }
    }
  }

  function zaloz(element, opcje) {
    // Klasa .mapa zamyka wewnętrzne warstwy Leafletu we własnym kontekście
    // układania. Kiedyś polegało to na tym, że autor szablonu jej nie zapomni —
    // i wystarczyła jedna zapomniana, żeby mapa przykryła okno modalne.
    element.classList.add('mapa');
    const mapa = L.map(element, Object.assign({
      zoomControl: true, attributionControl: true, tap: true,
    }, opcje || {})).setView(SRODEK_PL, 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Pełna formuła wymagana przez warunki OSM — sam „© OpenStreetMap" to za mało.
      attribution: '© <a href="https://www.openstreetmap.org/copyright" '
        + 'target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(mapa);
    WSZYSTKIE.push(mapa);

    // Gdyby mapa powstała PRZY otwartym oknie (ekrany ładują się asynchronicznie,
    // a ktoś już zdążył kliknąć) — od razu ma być schowana. Najpierw styl,
    // bo działa natychmiast.
    if (document.body.classList.contains('okno-otwarte')) {
      element.style.setProperty('visibility', 'hidden', 'important');
    }
    setTimeout(() => {
      mapa.invalidateSize();
      if (mapa._ostatnieDopasowanie) dopasujWidok(mapa, mapa._ostatnieDopasowanie);
      // Dopiero TERAZ, gdy Leaflet skończył się składać, przepuszczamy tę mapę
      // przez pełną ścieżkę chowania — czyli także wyjęcie z dokumentu.
      if (document.body.classList.contains('okno-otwarte')
          && window.odswiezZnacznikOkna) odswiezZnacznikOkna();
    }, 60);
    return mapa;
  }

  /* --------------------------------------------------- rysowanie treści */

  function znacznikFirmowy(mapa, l) {
    const marka = markaLokalizacji(l.nazwa);
    const litera = escHtml((l.nazwa || '?').trim()[0] || '?');
    const bok = l.domyslna ? 36 : 32;
    // Klasy dokładnie takie, jakich oczekuje arkusz: .znacznik-nr.firmowy.strefa
    const klasa = 'firmowy ' + marka + (l.domyslna ? ' domyslna' : '');
    const m = znacznik(mapa, [l.lat, l.lon], litera, klasa, bok, dymekLokalizacji(l, marka));
    (mapa._firmowe = mapa._firmowe || []).push(m);
    return m;
  }

  /* Rysuje przystanki po kolei, opcjonalnie bazę i linię między punktami. */
  function rysujTrase(mapa, przystanki, opcje) {
    const o = opcje || {};
    wyczysc(mapa);
    const punkty = [];

    /* Baza-start i baza-meta to dwie różne rzeczy. Zlecenie może zaczynać się
       w bazie i kończyć u klienta, zaczynać u klienta i wracać do bazy, albo
       nie dotykać bazy wcale. Stara opcja `baza` znaczy „i start, i meta" —
       zostaje dla zgodności, bo woła ją jeszcze kod kierowcy. */
    const bazaStart = o.bazaStart !== undefined ? o.bazaStart : o.baza;
    const bazaKoniec = o.bazaKoniec !== undefined ? o.bazaKoniec : o.baza;
    if (bazaStart) {
      znacznik(mapa, bazaStart, 'B', 'baza', 30,
        escHtml(o.bazaNazwa || 'Baza / magazyn') + '<br><span class="male">start</span>');
      punkty.push(bazaStart);
    }

    przystanki.forEach((p, i) => {
      if (p.mapa_lat == null || p.mapa_lon == null) return;
      // Nasze miejsce dostaje kwadrat zamiast kola, ale NUMER zostaje —
      // mapa pokazuje kolejnosc objazdu, a doladunek bywa piatym punktem dnia.
      const klasa = (p.nasze ? 'nasze ' : '')
        + (p.status === 'dostarczone' ? 'ok' : (p.status === 'nieudane' ? 'nie' : ''));
      znacznik(mapa, [p.mapa_lat, p.mapa_lon], i + 1, klasa, 28,
        '<b>' + escHtml(p.klient_nazwa) + '</b><br>' + escHtml(adresJednymCiagiem(p)),
        o.klik ? () => o.klik(p) : null);
      punkty.push([p.mapa_lat, p.mapa_lon]);
    });

    if (bazaKoniec) {
      // Powrót do bazy widać teraz także na mapie — serwer liczył te kilometry
      // od dawna, a mapa ich nie rysowała.
      const tenSam = bazaStart && bazaStart[0] === bazaKoniec[0] && bazaStart[1] === bazaKoniec[1];
      if (!tenSam) {
        znacznik(mapa, bazaKoniec, 'B', 'baza', 30,
          escHtml(o.bazaNazwa || 'Baza / magazyn') + '<br><span class="male">powrót</span>');
      }
      punkty.push(bazaKoniec);
    }

    if (o.linia && o.linia.length > 1) linia(mapa, o.linia, BARWA_TRASY, 5, false);
    else if (punkty.length > 1) linia(mapa, punkty, BARWA_TRASY, 3, false);

    dopasujWidok(mapa, punkty);
    return punkty.length;
  }

  function rysujSlad(mapa, pozycje, kolor) {
    if (!pozycje.length) return;
    linia(mapa, pozycje.map(p => [p.lat, p.lon]), kolor || BARWA_SLADU, 4, false);
    const ostatnia = pozycje[pozycje.length - 1];
    znacznikPozycji(mapa, [ostatnia.lat, ostatnia.lon],
      escHtml(ostatnia.kierowca_imie || '') + '<br>' + escHtml(ostatnia.czas));
  }

  /* Bus w trasie — zwykła pinezka, żeby odróżnić go od punktów dostaw
     i od naszych lokalizacji. Osobna funkcja, bo poza tym modułem nic
     nie powinno wołać Leafletu wprost. */
  function znacznikPozycji(mapa, punkt, dymek) {
    const p = wsp(punkt);
    const m = L.marker([p.lat, p.lng], { icon: zwykla }).addTo(mapa);
    if (dymek) m.bindPopup(dymek);
    return dodajWarstwe(mapa, m);
  }

  /* Jeden punkt nie tworzy prostokąta — dopasowanie przybliżyłoby do samego
     asfaltu. Wtedy po prostu centrujemy z sensownym powiększeniem. */
  function dopasujWidok(mapa, punkty) {
    if (!punkty || !punkty.length) return;
    // Zapamiętujemy punkty, bo dopasowanie robione zaraz po wstawieniu karty
    // liczy się na kontenerze o jeszcze nieznanym rozmiarze i kończy widokiem
    // całego świata. Po invalidateSize() powtarzamy je na właściwym.
    mapa._ostatnieDopasowanie = punkty;
    // animate:false jest tu istotne. Animowana zmiana widoku czeka na klatkę
    // od przeglądarki, a ta nie przychodzi, gdy karta jest w tle albo ekran
    // telefonu zgaśnie — mapa zostawała wtedy na widoku całej Polski.
    const leaf = punkty.map(p => { const q = wsp(p); return [q.lat, q.lng]; });
    if (leaf.length === 1) return mapa.setView(leaf[0], 13, { animate: false });
    mapa.fitBounds(L.latLngBounds(leaf).pad(0.18), { animate: false });
  }

  /* Kształt trasy po prawdziwych drogach, z publicznego routera OSRM.

     Pytamy z PRZEGLĄDARKI, nie z serwera — i to jest istotne. Systemowy Python
     na Macu ma stary LibreSSL, który nie dogada się z tym serwerem, więc ta sama
     funkcja liczona po stronie programu działałaby na Windowsie, a na Macu nie.
     Przeglądarka ma nowoczesne szyfrowanie i router pozwala pytać wprost
     (Access-Control-Allow-Origin: *), więc działa wszędzie tak samo i bez klucza.

     To usługa darmowa i bez gwarancji — gdy nie odpowie, mapa zostaje przy
     odcinkach w linii prostej i mówi o tym wprost.                            */
  const ROUTER = 'https://router.project-osrm.org/route/v1/driving/';

  async function przebiegPoDrogach(punkty) {
    if (!punkty || punkty.length < 2) return null;
    if (punkty.length > 25) punkty = punkty.slice(0, 25);   // sensowny limit adresu
    const wspolrzedne = punkty.map(p => {
      const q = wsp(p);
      return q.lng.toFixed(6) + ',' + q.lat.toFixed(6);
    }).join(';');
    const odp = await fetch(ROUTER + wspolrzedne + '?overview=full&geometries=geojson',
      { signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined });
    if (!odp.ok) throw new Error('Usługa wyznaczania tras odpowiedziała błędem ' + odp.status);
    const dane = await odp.json();
    if (dane.code !== 'Ok' || !dane.routes || !dane.routes.length) {
      throw new Error('Usługa wyznaczania tras nie znalazła połączenia między tymi punktami');
    }
    const trasa = dane.routes[0];
    return {
      linia: trasa.geometry.coordinates.map(c => [c[1], c[0]]),
      km: Math.round(trasa.distance / 100) / 10,
      minuty: Math.round(trasa.duration / 60),
    };
  }

  return {
    zaloz, odswiezWszystkie, rysujTrase, rysujSlad, znacznikPozycji,
    znacznikFirmowy, znacznikNumer, zwykla, dopasujWidok, przebiegPoDrogach,
  };
})();

function adresJednymCiagiem(k) {
  const czesci = [k.ulica, [k.kod, k.miasto].filter(Boolean).join(' ')].filter(x => x && x.trim());
  return czesci.join(', ');
}

/* Nawigacja i eksport tras idą do Map Google — bo to one są w telefonie
   kierowcy i to ich używa biuro. Odnośnik jest zwykłym adresem, więc nie
   wymaga klucza, konta ani karty i nic nie kosztuje. To coś zupełnie innego
   niż rysowanie mapy w aplikacji, które zostaje na OpenStreetMap.
   Ten adres działa i na Androidzie, i na iPhonie.                           */
function linkNawigacji(przystanek) {
  const cel = (przystanek.mapa_lat != null && przystanek.mapa_lon != null)
    ? `${przystanek.mapa_lat},${przystanek.mapa_lon}`
    : `${przystanek.klient_nazwa} ${adresJednymCiagiem(przystanek)}`;
  return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(cel);
}
