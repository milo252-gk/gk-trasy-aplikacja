/* Przewidywana godzina dojazdu.

   Liczona w przeglądarce, nie na serwerze — dzięki temu działa też w telefonie
   bez zasięgu, a kierowca w trasie potrzebuje jej właśnie tam. Dokładność jest
   szacunkowa i taka ma być: odległość w linii prostej razy 1,35 (bo drogi nie
   są proste), podzielona przez średnią prędkość, plus stały czas rozładunku.

   W ciągu dnia liczymy od ostatniej zamkniętej dostawy, a nie od porannego
   planu — inaczej po pierwszym opóźnieniu wszystkie godziny są nieprawdziwe.

   modelCzasu() jest DOSŁOWNYM tłumaczeniem funkcji model_czasu z trasex.py —
   te same nazwy pól, ta sama kolejność działań, wyłącznie liczby całkowite.
   Testy porównują obie strony co do minuty (testy/t_zgodnosc.py), bo biuro
   i kierowca nie mogą widzieć dwóch różnych godzin tej samej dostawy.        */

const ETA = (() => {
  const KRETOSC_DOMYSLNA = 1.35;

  /* Domyślne liczby przerw — punkt wyjścia, nie obowiązek. Każdą z nich biuro
     ustawia ręcznie w Ustawieniach. Muszą być identyczne z DOMYSLNY_MODEL_CZASU
     w trasex.py. */
  const MODEL = {
    przepisy: true,
    jazda_do_przerwy_min: 270,
    przerwa_min: 45,
    dobowy_limit_jazdy_min: 540,
    praca_do_przerwy_min: 360,
    przerwa_pracownicza_min: 30,
    dluga_praca_min: 540,
    przerwa_dlugiej_pracy_min: 45,
    doba_pracy_min: 780,
  };

  /* Odpowiednik liczbowe() z trasex.py: pole ustawień jest zwykłym tekstem,
     więc „1,35" albo „45 km/h" nie może wywrócić rachunku. */
  function liczba(wartosc, domyslna) {
    const s = String(wartosc == null ? '' : wartosc).replace(',', '.');
    const x = parseFloat(s.replace(/[^0-9.\-]/g, ''));
    return isFinite(x) && x > 0 ? x : domyslna;
  }

  /* POSTÓJ U KLIENTA NIE JEST PRZERWĄ — rozładunek to w rozumieniu przepisów
     inna praca, więc nie zeruje licznika 4,5 godziny prowadzenia. */
  function modelCzasu(kroki, parametry) {
    const p = Object.assign({}, MODEL, parametry || {});
    const lista = kroki || [];
    let jazda = 0, postoje = 0, zaladunki = 0;
    lista.forEach(k => {
      jazda += Math.trunc(k.jazda_min || 0);
      postoje += Math.trunc(k.postoj_min || 0);
      if (k.nasze) zaladunki += Math.trunc(k.postoj_min || 0);
    });

    const punkty = [], przerwy = [];
    if (!p.przepisy) {
      let zegar = 0;
      lista.forEach(k => {
        zegar += Math.trunc(k.jazda_min || 0);
        punkty.push({ przerwa_przed_min: 0, dojazd_min: zegar });
        zegar += Math.trunc(k.postoj_min || 0);
      });
      const razemBez = jazda + postoje;
      return {
        minuty: razemBez, minuty_jazdy: jazda, minuty_postojow: postoje,
        minuty_zaladunkow: zaladunki, minuty_przerw: 0, ile_przerw: 0,
        przerwy: [], punkty: punkty, przepisy: false,
        limit_jazdy_przekroczony: false,
        doba_przekroczona: razemBez > Math.trunc(p.doba_pracy_min),
      };
    }

    const limitJazdy = Math.max(1, Math.trunc(p.jazda_do_przerwy_min));
    const limitPracy = Math.max(1, Math.trunc(p.praca_do_przerwy_min));
    const dlugoscJazdy = Math.max(0, Math.trunc(p.przerwa_min));
    const dlugoscPracy = Math.max(0, Math.trunc(p.przerwa_pracownicza_min));
    let ciagla = 0, odPrzerwy = 0, zegar = 0, minutyPrzerw = 0;
    lista.forEach(k => {
      let zostalo = Math.trunc(k.jazda_min || 0);
      let przerwaTu = 0;
      for (;;) {
        let przejechane, dlugosc;
        if (ciagla + zostalo > limitJazdy) {
          // Math.max(0, ...) — próg pracy bywa przekroczony już na postoju,
          // a wtedy „ile jeszcze wolno jechać" wychodzi ujemne.
          przejechane = Math.max(0, limitJazdy - ciagla);
          dlugosc = dlugoscJazdy;
        } else if (odPrzerwy + zostalo > limitPracy) {
          przejechane = Math.max(0, limitPracy - odPrzerwy);
          dlugosc = dlugoscPracy;
        } else break;
        zegar += przejechane + dlugosc;
        zostalo -= przejechane;
        przerwaTu += dlugosc;
        minutyPrzerw += dlugosc;
        przerwy.push(dlugosc);
        ciagla = 0;
        odPrzerwy = 0;
      }
      zegar += zostalo;
      ciagla += zostalo;
      odPrzerwy += zostalo;
      punkty.push({ przerwa_przed_min: przerwaTu, dojazd_min: zegar });
      const postoj = Math.trunc(k.postoj_min || 0);
      zegar += postoj;
      odPrzerwy += postoj;          // postój to praca, ale nie jazda
    });

    // Bezpiecznik: przepis mówi o ŁĄCZNYM wymiarze przerwy w dniu pracy.
    const praca = jazda + postoje;
    let wymagana = 0;
    if (praca > Math.trunc(p.dluga_praca_min)) wymagana = Math.trunc(p.przerwa_dlugiej_pracy_min);
    else if (praca > limitPracy) wymagana = dlugoscPracy;
    if (wymagana > minutyPrzerw) {
      przerwy.push(wymagana - minutyPrzerw);
      minutyPrzerw = wymagana;
    }

    const razem = jazda + postoje + minutyPrzerw;
    return {
      minuty: razem, minuty_jazdy: jazda, minuty_postojow: postoje,
      minuty_zaladunkow: zaladunki, minuty_przerw: minutyPrzerw,
      ile_przerw: przerwy.length, przerwy: przerwy, punkty: punkty, przepisy: true,
      limit_jazdy_przekroczony: jazda > Math.trunc(p.dobowy_limit_jazdy_min),
      doba_przekroczona: razem > Math.trunc(p.doba_pracy_min),
    };
  }

  /* Godzina wyjazdu i baza są teraz cechą KONKRETNEJ trasy, a nie całej firmy:
     trasa może mieć własną godzinę, a kierowca własny magazyn. Ustawienia
     zostają tylko jako wartości domyślne, gdy trasa nic nie mówi. */
  function ustawienia(trasa) {
    const u = stan.ustawienia || {};
    const t = trasa || {};
    /* Przerwy dolicza się tylko pojazdom, które podlegają przepisom o czasie
       pracy kierowcy (powyżej 3,5 t). Gdy trasa nie ma jeszcze busa, liczymy
       ostrożnie — z przerwami — bo zaniżony czas jest groźniejszy od zawyżonego. */
    const pojazd = (stan.pojazdy || []).find(x => x.id === t.pojazd);
    const cecha = t.pojazd_czas_pracy != null ? t.pojazd_czas_pracy
      : (pojazd ? pojazd.czas_pracy : null);
    return {
      predkosc: Math.max(20, liczba(u.srednia_predkosc, 50)),
      rozladunek: Math.max(0, Math.round(liczba(u.czas_rozladunku_min, 15))),
      zaladunek: Math.max(0, Math.round(liczba(u.czas_zaladunku_min, 30))),
      kretosc: liczba(u.kretosc_drogi, KRETOSC_DOMYSLNA),
      wyjazd: t.wyjazd || t.wyjazd_o || u.godzina_wyjazdu || '07:00',
      baza: t.baza_lat != null ? [t.baza_lat, t.baza_lon]
        : (u.baza_lat ? [Number(u.baza_lat), Number(u.baza_lon)] : null),
      /* Układ zlecenia: baza NIE jest już założeniem. Przy „start u pierwszego
         klienta" nie ma czego liczyć z bazy — dzień zaczyna się w punkcie. */
      startWBazie: (t.uklad || 'baza_baza') === 'baza_baza'
        || (t.uklad || 'baza_baza') === 'baza_punkt',
      model: {
        przepisy: String(u.przerwy_wlaczone || '1') !== '0'
          && (cecha == null ? true : !!Number(cecha)),
        jazda_do_przerwy_min: Math.round(liczba(u.jazda_do_przerwy_min, 270)),
        przerwa_min: Math.round(liczba(u.przerwa_min, 45)),
        praca_do_przerwy_min: Math.round(liczba(u.praca_do_przerwy_min, 360)),
        przerwa_pracownicza_min: Math.round(liczba(u.przerwa_pracownicza_min, 30)),
        dluga_praca_min: Math.round(liczba(u.dluga_praca_min, 540)),
        przerwa_dlugiej_pracy_min: Math.round(liczba(u.przerwa_dlugiej_pracy_min, 45)),
        dobowy_limit_jazdy_min: Math.round(liczba(u.dobowy_limit_jazdy_min, 540)),
        doba_pracy_min: Math.round(liczba(u.doba_pracy_min, 780)),
      },
    };
  }

  function minutyPrzejazdu(z, doPunktu, predkosc, kretosc) {
    if (!z || !doPunktu) return null;
    const km = odlegloscKm(z[0], z[1], doPunktu[0], doPunktu[1])
      * (kretosc || KRETOSC_DOMYSLNA);
    return Math.round(km / predkosc * 60);
  }

  function odlegloscKm(aLat, aLon, bLat, bLon) {
    const R = 6371, rad = Math.PI / 180;
    const f1 = aLat * rad, f2 = bLat * rad;
    const df = (bLat - aLat) * rad, dl = (bLon - aLon) * rad;
    const h = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function naMinuty(godzina) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(godzina || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function naGodzine(minuty) {
    const m = ((Math.round(minuty) % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  /* Dokłada każdemu punktowi pola: eta (HH:MM), spoznienie (minuty po oknie)
     i za_wczesnie (minuty przed oknem). Zwraca liczbę punktów, dla których
     dało się to policzyć. */
  function policz(trasa) {
    const u = ustawienia(trasa);
    const punkty = trasa.przystanki.filter(p => p.status !== 'odwolany');
    punkty.forEach(p => {
      p.eta = null; p.spoznienie = null; p.za_wczesnie = null; p.przerwa_przed = 0;
    });

    // punkt startowy: ostatnia zamknięta dostawa (jeśli dziś już jeżdżą),
    // w przeciwnym razie baza i planowana godzina wyjazdu
    const zamkniete = punkty.filter(p => p.status !== 'oczekuje' && p.zamkniete_o);
    const ostatnia = zamkniete[zamkniete.length - 1];
    let skad = null;
    let minuty = null;
    if (ostatnia && ostatnia.mapa_lat != null) {
      skad = [ostatnia.mapa_lat, ostatnia.mapa_lon];
      minuty = naMinuty(String(ostatnia.zamkniete_o).slice(11, 16));
    } else {
      skad = u.startWBazie ? u.baza : null;
      minuty = naMinuty(trasa.start_o ? String(trasa.start_o).slice(11, 16) : u.wyjazd);
    }
    if (minuty == null) return 0;

    /* Kroki dla modelu: jeden na każdy punkt, który został do zrobienia.
       Punkt bez odnalezionego adresu nie dostanie godziny, ale jego postój
       i tak przesuwa resztę dnia — tak samo liczy to serwer. */
    const doZrobienia = punkty.filter(p => p.status === 'oczekuje');
    const kroki = [];
    let poprzedni = skad;
    doZrobienia.forEach(p => {
      const jazda = (p.mapa_lat != null && poprzedni)
        ? minutyPrzejazdu(poprzedni, [p.mapa_lat, p.mapa_lon], u.predkosc, u.kretosc) : 0;
      kroki.push({
        jazda_min: jazda || 0,
        postoj_min: p.nasze ? u.zaladunek : u.rozladunek,
        nasze: !!p.nasze,
      });
      if (p.mapa_lat != null) poprzedni = [p.mapa_lat, p.mapa_lon];
    });

    const wynik = modelCzasu(kroki, u.model);
    let policzonych = 0;
    doZrobienia.forEach((p, i) => {
      const krok = wynik.punkty[i];
      if (!krok) return;
      p.przerwa_przed = krok.przerwa_przed_min;
      if (p.mapa_lat == null) return;
      const chwila = minuty + krok.dojazd_min;
      p.eta = naGodzine(chwila);
      policzonych += 1;

      const od = naMinuty(p.okno_od), doGodz = naMinuty(p.okno_do);
      if (doGodz != null && chwila > doGodz) p.spoznienie = Math.round(chwila - doGodz);
      if (od != null && chwila < od) p.za_wczesnie = Math.round(od - chwila);
    });
    return policzonych;
  }

  /* Krótki opis pod punktem — to, co człowiek ma przeczytać. */
  function opis(p) {
    if (!p.eta) return '';
    /* Przerwa jest częścią tej godziny — bez dopisku wygląda jak strata czasu
       albo pomyłka w rachunku. */
    const przerwa = p.przerwa_przed
      ? `<span class="slaby"> · ☕ w drodze przerwa ${p.przerwa_przed} min</span>` : '';
    if (p.spoznienie) {
      return `<span style="color:var(--czerwony);font-weight:700">⚠ ${p.eta} — nie zdążysz,`
        + ` zamykają ${escHtml(p.okno_do)}</span>` + przerwa;
    }
    if (p.za_wczesnie && p.za_wczesnie > 15) {
      return `<span style="color:var(--zolty)">🕒 ${p.eta} — otwierają dopiero`
        + ` ${escHtml(p.okno_od)}</span>` + przerwa;
    }
    return `<span class="slaby">🕒 ok. ${p.eta}</span>` + przerwa;
  }

  return { policz, opis, odlegloscKm, naGodzine, naMinuty, modelCzasu, liczba };
})();
