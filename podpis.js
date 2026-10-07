/* Podpis palcem i zdjecia z aparatu.
   Zdjecie z telefonu ma 3-5 MB. Przez slaby zasieg to wieczne czekanie, wiec
   zmniejszamy je jeszcze w telefonie, zanim trafi do kolejki. 1280 px w
   zupelnosci wystarcza, zeby odczytac podpisany dokument.                    */

const Podpis = (() => {
  function zaloz(plotno) {
    const rys = plotno.getContext('2d');
    let pisze = false, cos = false, ostatni = null;

    function dopasuj() {
      const gestosc = window.devicePixelRatio || 1;
      const p = plotno.getBoundingClientRect();
      const kopia = cos ? plotno.toDataURL() : null;
      plotno.width = Math.round(p.width * gestosc);
      plotno.height = Math.round(p.height * gestosc);
      rys.setTransform(gestosc, 0, 0, gestosc, 0, 0);
      /* '#fff' i '#16232f' to KARTKA I ATRAMENT, nie kolory interfejsu — i tak
         mają zostać także w motywie ciemnym. Ten piksel wchodzi do PNG-a przez
         obraz() niżej, idzie na serwer, do galerii dowodów i na wydruk dla
         klienta, gdzie tło jest białe. Ciemne płótno dałoby czarny prostokąt na
         papierze, a przezroczyste — podpis niewidzialny w każdej ciemnej
         przeglądarce zdjęć. Wartości zsynchronizowane z --podpis-tlo
         i --podpis-atrament w style.css.                                      */
      rys.fillStyle = '#fff'; rys.fillRect(0, 0, p.width, p.height);
      rys.lineWidth = 2.4; rys.lineCap = 'round'; rys.lineJoin = 'round'; rys.strokeStyle = '#16232f';
      if (kopia) { const o = new Image(); o.onload = () => rys.drawImage(o, 0, 0, p.width, p.height); o.src = kopia; }
    }

    function punkt(zdarzenie) {
      const p = plotno.getBoundingClientRect();
      const z = zdarzenie.touches ? zdarzenie.touches[0] : zdarzenie;
      return { x: z.clientX - p.left, y: z.clientY - p.top };
    }
    function start(e) { e.preventDefault(); pisze = true; ostatni = punkt(e); }
    function ciagnij(e) {
      if (!pisze) return;
      e.preventDefault();
      const teraz = punkt(e);
      rys.beginPath(); rys.moveTo(ostatni.x, ostatni.y); rys.lineTo(teraz.x, teraz.y); rys.stroke();
      ostatni = teraz; cos = true;
      plotno.classList.add('zapelnione');
    }
    function koniec() { pisze = false; }

    ['mousedown', 'touchstart'].forEach(n => plotno.addEventListener(n, start, { passive: false }));
    ['mousemove', 'touchmove'].forEach(n => plotno.addEventListener(n, ciagnij, { passive: false }));
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(n => plotno.addEventListener(n, koniec));
    window.addEventListener('resize', dopasuj);
    dopasuj();

    return {
      wyczysc() { cos = false; plotno.classList.remove('zapelnione'); dopasuj(); },
      pusty() { return !cos; },
      obraz() { return cos ? plotno.toDataURL('image/png') : null; },
      /* Odtworzenie podpisu z zapisanego brudnopisu. Bez tego odzyskana dostawa
         wracałaby bez podpisu — czyli bez jedynej rzeczy, po którą trzeba by
         wrócić do klienta. */
      wstaw(dataURL) {
        if (!dataURL) return;
        const o = new Image();
        o.onload = () => {
          const r = plotno.getBoundingClientRect();
          rys.drawImage(o, 0, 0, r.width, r.height);
          cos = true;
          plotno.classList.add('zapelnione');
        };
        o.src = dataURL;
      },
    };
  }
  return { zaloz };
})();

/* Zmniejszenie zdjecia przed wlozeniem do kolejki. */
function zmniejszZdjecie(plik, maksBok = 1280, jakosc = 0.72) {
  return new Promise((zwroc, odrzuc) => {
    const czytnik = new FileReader();
    czytnik.onerror = () => odrzuc(new Error('Nie udało się odczytać zdjęcia'));
    czytnik.onload = () => {
      const obraz = new Image();
      obraz.onerror = () => odrzuc(new Error('To nie jest zdjęcie'));
      obraz.onload = () => {
        let { width: sz, height: wy } = obraz;
        const skala = Math.min(1, maksBok / Math.max(sz, wy));
        sz = Math.round(sz * skala); wy = Math.round(wy * skala);
        const plotno = document.createElement('canvas');
        plotno.width = sz; plotno.height = wy;
        plotno.getContext('2d').drawImage(obraz, 0, 0, sz, wy);
        zwroc(plotno.toDataURL('image/jpeg', jakosc));
      };
      obraz.src = czytnik.result;
    };
    czytnik.readAsDataURL(plik);
  });
}
