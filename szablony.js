/* Szablony tras (biuro) i lista załadunku (kierowca).

   Szablon to stały zestaw klientów w stałej kolejności — „poniedziałek,
   Kalisz północ". Poranne układanie przestaje zaczynać się od zera.

   Lista załadunku to płaska lista towaru ze wszystkich punktów dnia do
   odhaczenia przy bramie magazynu. Dziś, żeby sprawdzić co ładować, trzeba
   wejść w każdy punkt po kolei — więc nikt tego nie robi.                   */

EKRANY.szablony = {
  tytul: 'Zlecenia stałe',
  tylkoBiuro: true,
  async rysuj(pole) {
    const [szablony, kierowcy] = await Promise.all([
      API.get('/api/szablony'), listaKierowcow(),
    ]);
    const busy = stan.pojazdy.filter(b => b.aktywny);

    pole.innerHTML = `
      <div class="pasek-narzedzi">
        <button class="glowny" id="sz-nowy">+ Nowy szablon</button>
        <button id="sz-wroc">← Zlecenia</button>
      </div>
      <p class="male slaby">Szablon zapamiętuje zestaw klientów i ich kolejność.
        Z jednego szablonu robisz dzień jednym kliknięciem — bez przeklikiwania
        tych samych kilkunastu punktów co rano.</p>

      ${szablony.length ? szablony.map(s => `
        <div class="karta">
          <div class="karta-gora">
            <div>
              <h3 style="margin:0">${escHtml(s.nazwa)}</h3>
              <div class="male slaby">${s.ile} ${odmiana(s.ile, 'punkt', 'punkty', 'punktów')}
                ${s.kierowca_imie ? '· ' + escHtml(s.kierowca_imie) : ''}
                ${s.pojazd_nazwa ? '· ' + escHtml(s.pojazd_nazwa) : ''}</div>
            </div>
            <div class="przyciski">
              <button class="maly glowny" data-uzyj="${s.id}">Zrób z tego zlecenie</button>
              <button class="maly" data-edytuj="${s.id}">Zmień</button>
              <button class="maly" data-usun="${s.id}">Usuń</button>
            </div>
          </div>
          <div class="male">${s.punkty.map((p, i) =>
            `${i + 1}. ${p.nasze ? '🏭 ' : ''}${escHtml(p.klient_nazwa)}`).join(' &nbsp;·&nbsp; ') || '<i>pusty</i>'}</div>
        </div>`).join('')
        : `<div class="karta"><div class="pusto"><span class="duza-ikona">📋</span>
             Nie ma jeszcze żadnego szablonu.
             <div class="male" style="margin-top:8px">Najprościej: otwórz gotową trasę
               i użyj „Zapisz jako szablon".</div></div></div>`}`;

    pole.querySelector('#sz-wroc').onclick = () => pokazEkran('trasy');
    pole.querySelector('#sz-nowy').onclick = () => oknoSzablonu(null, kierowcy, busy);
    pole.querySelectorAll('[data-edytuj]').forEach(b => b.onclick = () =>
      oknoSzablonu(szablony.find(s => s.id === Number(b.dataset.edytuj)), kierowcy, busy));
    pole.querySelectorAll('[data-uzyj]').forEach(b => b.onclick = () =>
      oknoTrasyZSzablonu(szablony.find(s => s.id === Number(b.dataset.uzyj)), kierowcy, busy));
    pole.querySelectorAll('[data-usun]').forEach(b => b.onclick = async () => {
      if (!await potwierdz('Usunąć zlecenie stałe?', 'Zlecenia zrobione z niego zostają nietknięte.')) return;
      const w = await sprobuj(() => API.del('/api/szablony/' + b.dataset.usun), 'Usunięto');
      if (w) pokazEkran('szablony');
    });
  },
};

async function oknoSzablonu(s, kierowcy, busy) {
  // Tak samo jak przy trasie: lista naszych miejsc musi być aktualna w chwili,
  // w której ktoś ma z niej wybierać.
  await odswiezLokalizacje();
  const nowy = !s;
  s = s || { nazwa: '', kierowca: null, pojazd: null, uwagi: '', punkty: [],
             baza: null, uklad: 'baza_baza' };
  // Ta sama lista co przy trasie — jedna funkcja w biuro.js, zeby oba okna
  // nie rozjechaly sie po pierwszej zmianie. Klucze niosa typ („L3"/„K3"),
  // a kolejnosc zaznaczania jest kolejnoscia punktow w szablonie.
  const wybrane = s.punkty.map(kluczPunktu);
  const lista = (szukaj) => listaPunktowDoWyboru({ juz: new Set(), wybrane, szukaj });

  okno({
    tytul: nowy ? 'Nowe zlecenie stałe' : 'Zlecenie stałe: ' + s.nazwa,
    szerokie: true,
    tresc: `
      <label>Nazwa <span class="slaby">(np. „Poniedziałek — Kalisz północ")</span>
        <input id="sb-nazwa" value="${escHtml(s.nazwa)}"></label>
      <div class="dwie">
        <label>Domyślny kierowca
          <select id="sb-kierowca"><option value="">— wybiorę przy tworzeniu —</option>
            ${kierowcy.map(k => `<option value="${k.id}" ${s.kierowca === k.id ? 'selected' : ''}>
              ${escHtml(k.imie)}</option>`).join('')}</select></label>
        <label>Domyślny bus
          <select id="sb-pojazd"><option value="">— nie wybieram —</option>
            ${busy.map(b => `<option value="${b.id}" ${s.pojazd === b.id ? 'selected' : ''}>
              ${escHtml(b.nazwa)}</option>`).join('')}</select></label>
      </div>
      <div class="dwie">
        <label>Baza w tym zleceniu
          <select id="sb-baza"><option value="">— baza domyślna —</option>
            ${(stan.lokalizacje || []).filter(l => l.aktywna !== 0).map(l =>
              `<option value="${l.id}" ${s.baza === l.id ? 'selected' : ''}>
                ${escHtml(l.nazwa)}</option>`).join('')}</select></label>
        <label>Układ zlecenia
          <select id="sb-uklad">${opcjeUkladu(s.uklad)}</select></label>
      </div>
      <p class="male slaby" style="margin:-6px 0 10px">Układ jedzie razem ze zleceniem
        zrobionym z tego wzorca — stały kurs między naszymi magazynami nie będzie
        co tydzień doliczał powrotu, którego nikt nie robi.</p>
      <label>Uwagi dla kierowcy<textarea id="sb-uwagi">${escHtml(s.uwagi || '')}</textarea></label>
      <h3 style="margin-top:14px">Punkty w szablonie</h3>
      <p class="male slaby">Możesz wstawić także nasze miejsce — np. doładunek w magazynie
        w środku dnia. Kolejność bierze się z kolejności zaznaczania; poprawisz ją
        strzałkami po zrobieniu trasy z szablonu.</p>
      <input id="sb-szukaj" placeholder="Szukaj po nazwie, mieście, ulicy…" autocomplete="off">
      <div id="sb-lista" style="margin-top:10px;max-height:38vh;overflow-y:auto">${lista('')}</div>`,
    przyciski: [
      { napis: 'Anuluj', klik: z => z() },
      { napis: 'Zapisz zlecenie stałe', klasa: 'glowny', klik: async z => {
        const nazwa = val('sb-nazwa');
        if (!nazwa) { komunikat('Podaj nazwę zlecenia stałego', 'blad'); return; }
        if (!wybrane.length) { komunikat('Zaznacz przynajmniej jeden punkt', 'blad'); return; }
        const w = await sprobuj(() => API.post('/api/szablony', {
          id: s.id, nazwa,
          kierowca: document.getElementById('sb-kierowca').value || null,
          pojazd: document.getElementById('sb-pojazd').value || null,
          uwagi: val('sb-uwagi'),
          baza: document.getElementById('sb-baza').value || null,
          uklad: document.getElementById('sb-uklad').value,
          punkty: wybrane.map(punktZKlucza),
        }), 'Zapisano');
        if (w) { z(); pokazEkran('szablony'); }
      } },
    ],
    poOtwarciu: pole => {
      const przypnij = () => pole.querySelectorAll('#sb-lista input').forEach(p => {
        p.onchange = () => {
          const klucz = p.value;
          if (p.checked) { if (!wybrane.includes(klucz)) wybrane.push(klucz); }
          else wybrane.splice(wybrane.indexOf(klucz), 1);
        };
      });
      przypnij();
      pole.querySelector('#sb-szukaj').oninput = e => {
        pole.querySelector('#sb-lista').innerHTML = lista(e.target.value.trim().toLowerCase());
        przypnij();
      };
    },
  });
}

function oknoTrasyZSzablonu(s, kierowcy, busy) {
  okno({
    tytul: 'Zlecenie ze stałego „' + s.nazwa + '"',
    tresc: `
      <p class="male slaby">Powstanie nowa trasa z ${s.ile}
        ${odmiana(s.ile, 'punktem', 'punktami', 'punktami')} w kolejności z szablonu.</p>
      <label>Dzień<input type="date" id="ts-data" value="${dzisiaj()}"></label>
      <div class="dwie">
        <label>Kierowca
          <select id="ts-kierowca"><option value="">— jak w szablonie —</option>
            ${kierowcy.map(k => `<option value="${k.id}" ${s.kierowca === k.id ? 'selected' : ''}>
              ${escHtml(k.imie)}</option>`).join('')}</select></label>
        <label>Bus
          <select id="ts-pojazd"><option value="">— jak w szablonie —</option>
            ${busy.map(b => opcjaBusa(b, s.pojazd === b.id)).join('')}</select></label>
      </div>`,
    przyciski: [
      { napis: 'Anuluj', klik: z => z() },
      { napis: 'Utwórz zlecenie', klasa: 'glowny', klik: async z => {
        if (!await zgodaNaBus(document.getElementById('ts-pojazd').value || s.pojazd)) return;
        const w = await sprobuj(() => API.post(`/api/szablony/${s.id}/trasa`, {
          data: document.getElementById('ts-data').value,
          kierowca: document.getElementById('ts-kierowca').value || null,
          pojazd: document.getElementById('ts-pojazd').value || null,
        }), 'Zlecenie utworzone');
        if (w) { z(); pokazEkran('trasa', { id: w.id }); }
      } },
    ],
  });
}

/* ==================================================== lista załadunku */

/* Załadunek nie jest już samym odhaczaniem na telefonie. Każda pozycja wymaga
   zdjęcia towaru i numeru zamówienia PRZEPISANEGO Z DOKUMENTU przy palecie —
   kierowca nie widzi numeru wpisanego przez biuro, bo wtedy przepisywałby go
   z ekranu i cała kontrola nic by nie dawała. Telefon porównuje skróty na
   miejscu, więc pomyłka wychodzi pod rampą, a nie po powrocie.            */

EKRANY.zaladunek = {
  tytul: 'Załadunek',
  async rysuj(pole, param) {
    const data = param.data || dzisiaj();
    const trasa = await wczytajMojaTrase(data);
    if (!trasa || !trasa.przystanki.length) {
      pole.innerHTML = `<div class="karta"><div class="pusto"><span class="duza-ikona">📦</span>
        Na ten dzień nie ma czego ładować.</div></div>`;
      return;
    }
    // Nasze miejsca nie sa pozycjami zaladunku: przy doladunku w magazynie nie
    // ma dokumentu z numerem przy palecie ani palety do sfotografowania.
    const pozycje = trasa.przystanki.filter(p => p.status !== 'odwolany' && !p.nasze);

    const rysuj = () => {
      const gotowe = pozycje.filter(p => p.zaladowano_o).length;
      const niezgodne = pozycje.filter(p => p.zaladowano_o && p.zaladunek_zgodny === 0
                                            && p.dokument_podany).length;
      pole.innerHTML = `
        <div class="karta scisla">
          <div class="karta-gora"><h2 style="margin:0">Do załadowania</h2>
            <span class="plakietka ${gotowe === pozycje.length ? 'p-dostarczone' : 'p-w_toku'}">
              ${gotowe} z ${pozycje.length}</span></div>
          <div class="postep"><i class="ok" style="width:${
            pozycje.length ? gotowe / pozycje.length * 100 : 0}%"></i></div>
          ${niezgodne ? `<div class="wstega blad" style="margin-top:10px">
              ${niezgodne === 1 ? 'Jedna pozycja ma'
                : `${niezgodne} ${odmiana(niezgodne, 'pozycja ma', 'pozycje mają', 'pozycji ma')}`}
              numer niezgodny z zamówieniem. Sprawdź, czy na busie stoi właściwy towar.</div>` : ''}
          <p class="male slaby" style="margin-top:10px">Przy każdej pozycji zrób zdjęcie
            i przepisz numer zamówienia <b>z dokumentu przy towarze</b>. Działa bez zasięgu.</p>
        </div>
        ${pozycje.map((p, i) => {
          const zrobione = !!p.zaladowano_o;
          const zle = zrobione && p.zaladunek_zgodny === 0 && p.dokument_podany;
          return `
          <button class="przystanek ${zle ? 's-nieudane' : zrobione ? 's-dostarczone' : 's-oczekuje'}"
                  data-poz="${p.id}">
            <span class="numer">${zle ? '!' : zrobione ? '✓' : i + 1}</span>
            <span class="srodek">
              <span class="nazwa">${escHtml(p.klient_nazwa)}</span>
              <span class="adres">${escHtml(p.towar || 'towar nieokreślony')}</span>
              ${zrobione ? `<span class="dopisek">${zle
                  ? '⚠ numer nie zgadza się z zamówieniem'
                  : '📄 numer ' + escHtml(p.numer_kierowcy || '') + ' — zgodny'}</span>` : ''}
              ${p.z_dnia ? `<span class="dopisek">⏰ zaległe z ${escHtml(p.z_dnia)}</span>` : ''}
            </span>
          </button>`;
        }).join('')}`;
      pole.querySelectorAll('[data-poz]').forEach(b => b.onclick = () => {
        oknoZaladunku(pozycje.find(p => p.id === Number(b.dataset.poz)), trasa, rysuj);
      });
    };
    rysuj();
  },
};

function oknoZaladunku(p, trasa, odswiez) {
  const zdjecia = [];
  okno({
    tytul: escHtml(p.klient_nazwa),
    tresc: `
      <p class="male slaby">${escHtml(p.towar || 'towar nieokreślony')}</p>
      ${p.zaladowano_o ? `<div class="wstega ${p.zaladunek_zgodny ? 'ok' : 'blad'}">
          Ta pozycja jest już potwierdzona${p.zaladunek_zgodny ? '' : ', ale numer się nie zgadzał'}.
          Możesz potwierdzić jeszcze raz.</div>` : ''}
      <label>Zdjęcia towaru <span class="slaby">(paleta, dokument przy niej)</span>
        <input type="file" id="z-zdjecie" accept="image/*" capture="environment" multiple>
      </label>
      <div class="miniatury" id="z-miniatury"></div>
      <label style="margin-top:12px">Numer zamówienia
        <span class="slaby">(przepisz z dokumentu przy towarze)</span>
        <input id="z-numer" autocapitalize="characters" autocomplete="off"
               inputmode="text" placeholder="np. WZ 12/34"></label>
      ${p.dokument_podany === false ? `<div class="male slaby">
          Biuro nie podało numeru dla tej pozycji — zapiszemy to, co wpiszesz.</div>` : ''}`,
    poOtwarciu: () => {
      const wejscie = document.getElementById('z-zdjecie');
      const miniatury = document.getElementById('z-miniatury');
      wejscie.onchange = () => dodajZdjecia(wejscie.files, zdjecia, miniatury, wejscie);
    },
    przyciski: [
      { napis: 'Anuluj', klik: z => z() },
      { napis: '✓ Potwierdź załadunek', klasa: 'zielony', klik: async z => {
        const numer = document.getElementById('z-numer').value.trim();
        if (!numer) return komunikat('Wpisz numer zamówienia z dokumentu', 'blad');
        if (!zdjecia.length) return komunikat('Zrób zdjęcie towaru', 'blad');

        // Porównanie na telefonie — działa bez zasięgu. Serwer i tak policzy
        // to jeszcze raz, bo temu, co przyszło z telefonu, nie ufa.
        const pasuje = !p.dokument_skrot || Skrot.numeru(numer) === p.dokument_skrot;
        if (!pasuje) {
          const mimo = await potwierdz('Numer się nie zgadza',
            `Wpisałeś <b>${escHtml(numer)}</b>, a to zamówienie ma inny numer. `
            + 'Sprawdź, czy bierzesz właściwą paletę.',
            { tak: 'Zgłoś niezgodność', nie: 'Popraw numer', groznie: true, html: true });
          if (!mimo) return;
        }
        z();
        // Wysyłamy WSZYSTKIE zdjęcia. Wcześniej szło tylko pierwsze, mimo że
        // ekran pokazywał wszystkie miniatury — kierowca robił drugie, lepsze
        // zdjęcie, widział je i zapisywał to rozmazane.
        await zapiszZaladunek(p, trasa, { numer, zdjecia: zdjecia.slice(), zgodny: pasuje });
        odswiez();
      } },
    ],
  });
}

async function zapiszZaladunek(p, trasa, dane) {
  const zdjecia = dane.zdjecia || (dane.zdjecie ? [dane.zdjecie] : []);
  await doKolejki({
    typ: 'zaladunek', przystanek: p.id, numer: dane.numer,
    zdjecia: zdjecia, czas: czasTeraz(),
  }, dane.zgodny ? 'Załadunek potwierdzony' : 'Zapisano niezgodność numeru');
  Object.assign(p, {
    zaladowano_o: czasTeraz(),
    numer_kierowcy: dane.numer,
    zaladunek_zgodny: dane.zgodny ? 1 : 0,
    zaladunek_zwolniony: 0,
    ile_zalacznikow: (p.ile_zalacznikow || 0) + zdjecia.length,
  });
  if (trasa) await Kolejka.zapamietaj('moja-trasa-' + trasa.data, trasa);
}

/* Ile pozycji nie ma jeszcze potwierdzonego załadunku. Bez tego trasa nie
   ruszy — tak zdecydował właściciel: lepiej, żeby bus stał pod rampą, niż
   żeby pojechał nie ten towar. Serwer pilnuje tego samego, niezależnie. */
async function nieodhaczone(trasa) {
  if (!trasa) return 0;
  return trasa.przystanki.filter(
    p => p.status === 'oczekuje' && !p.zaladowano_o && !p.nasze).length;
}
