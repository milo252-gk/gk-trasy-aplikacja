/* „Zaproś kierowcę” — jak wsadzić GK Trasy do telefonu kierowcy (D33).

   Ekran biura, pokazywany kierowcy stojącemu obok. Cała robota polega na tym,
   żeby nikt nie przepisywał adresu: kierowca skanuje kod aparatem, dodaje
   stronę do ekranu głównego i ma aplikację. Wzór: „Dla kierowców” w GK Flota.

   Adres jest zawsze NAJLEPSZY dostępny: stały adres na GitHub Pages, potem
   adres tunelu, a na końcu adres w firmowym wifi. Ekran mówi też wprost, czy
   ten kod będzie działał jutro — adres szybkiego tunelu zmienia się po każdym
   uruchomieniu programu, więc wydrukowany kod przestaje prowadzić donikąd.  */

EKRANY.zaproszenie = {
  tytul: 'Zaproś kierowcę',
  tylkoBiuro: true,

  async rysuj(pole) {
    const z = await API.get('/api/zaproszenie');
    const naGithubie = z.skad === 'github';
    const tunelowy = z.skad === 'tunel';
    // Na Pages stały jest adres SAMEJ aplikacji — dane nadal stoją w biurze.
    // Bez tunelu kierowca spod domu zobaczy tylko ekran logowania, dlatego to
    // dwa osobne zdania, a nie jedno.
    const daneWSwiat = !!z.adres_danych;
    const admin = jestAdministratorem();

    pole.innerHTML = `
      ${z.skad === 'siec' ? `<div class="wstega uwaga">
        <b>Ten adres działa tylko w firmowym wifi.</b> Kierowca spod domu ani z trasy
        się nie połączy. Żeby aplikacja otwierała się z dowolnej sieci, administrator
        włącza tunel w <b>Ustawieniach → Dostęp z internetu</b>, a potem wysyła aplikację
        w <b>Ustawieniach → Aplikacja na GitHub Pages</b>.</div>` : ''}

      ${naGithubie && daneWSwiat ? `<div class="wstega ok">
        <b>Ten adres jest stały i działa w każdej sieci.</b> Kod można wydrukować
        i powiesić w szatni — za rok będzie prowadził w to samo miejsce. Telefony same
        znajdują program w biurze, także gdy tunel dostanie po restarcie nowy adres.</div>` : ''}

      ${naGithubie && !daneWSwiat ? `<div class="wstega uwaga">
        <b>Aplikacja otworzy się wszędzie, ale program w biurze nie ma teraz adresu
        w internecie.</b> Kierowca zobaczy ekran logowania i nic więcej, dopóki tunel
        nie ruszy (Ustawienia → Dostęp z internetu; zwykle wystarczy uruchomić
        GK Trasy jeszcze raz).</div>` : ''}

      ${naGithubie && daneWSwiat && z.pages && !z.pages.adres_aktualny ? `<div class="wstega uwaga">
        Program jeszcze nie wpisał nowego adresu tunelu na GitHub Pages — zwykle trwa to
        chwilę po starcie. Jeśli to nie minie, administrator sprawdza
        <b>Ustawienia → Aplikacja na GitHub Pages</b>.</div>` : ''}

      ${naGithubie && z.pages && z.pages.starsza && admin ? `<div class="wstega uwaga">
        Na GitHub Pages jest starsza wersja aplikacji niż program w biurze.
        <b>Ustawienia → Wyślij aplikację na GitHub.</b></div>` : ''}

      ${tunelowy && !z.adres_trwaly ? `<div class="wstega uwaga">
        <b>Ten adres zmieni się po ponownym uruchomieniu programu.</b> Nie drukuj tego
        kodu ani nie rozsyłaj go na stałe. Stały adres daje aplikacja na GitHub Pages —
        ${admin ? 'wyślij ją w <b>Ustawieniach → Aplikacja na GitHub Pages</b>.'
                : 'poproś administratora o wysłanie jej na GitHub.'}</div>` : ''}

      ${tunelowy && z.adres_trwaly ? `<div class="wstega ok">
        Adres jest stały (tunel stały). Ten kod można wydrukować i powiesić w szatni.</div>` : ''}

      <div class="karta">
        <div class="karta-gora"><h3>Zeskanuj telefonem</h3>
          <button class="maly" id="zp-drukuj">Drukuj</button></div>
        <div class="zaproszenie">
          <div class="zaproszenie-kod">${z.qr}</div>
          <div class="zaproszenie-obok">
            <p class="slaby male" style="margin:0 0 6px">Adres aplikacji:</p>
            <p class="zaproszenie-adres" id="zp-adres">${escHtml(z.adres)}</p>
            <div class="przyciski"><button id="zp-kopiuj">Skopiuj adres</button></div>
            <p class="slaby male">Aparat w telefonie rozpozna kod sam — nie trzeba żadnej
              dodatkowej aplikacji. Wystarczy wycelować i dotknąć powiadomienia.</p>
          </div>
        </div>
      </div>

      <div class="karta">
        <h3>Powiedz kierowcy, żeby zrobił to raz</h3>
        <p class="slaby male">Bez tego kroku aplikacja otwiera się jako zwykła strona.
          Po nim ma własną ikonę, pełny ekran i — pod adresem <code>https://</code> —
          otwiera się także bez zasięgu.</p>
        <div class="dwie-kolumny">
          <div>
            <h4>iPhone (Safari)</h4>
            <ol class="kroki">
              <li>Zeskanuj kod i otwórz stronę.</li>
              <li>Dotknij <b>Udostępnij</b> (kwadrat ze strzałką, na dole ekranu).</li>
              <li>Wybierz <b>Dodaj do ekranu początkowego</b> i dotknij <b>Dodaj</b>.</li>
            </ol>
          </div>
          <div>
            <h4>Android (Chrome)</h4>
            <ol class="kroki">
              <li>Zeskanuj kod i otwórz stronę.</li>
              <li>Dotknij <b>trzech kropek</b> w prawym górnym rogu.</li>
              <li>Wybierz <b>Zainstaluj aplikację</b> albo <b>Dodaj do ekranu głównego</b>.</li>
            </ol>
          </div>
        </div>
        <div class="wstega info" style="margin-top:12px">Kierowca loguje się imieniem
          i nazwiskiem (albo loginem) i swoim PIN-em — tym samym, co w innych
          aplikacjach GK.</div>
        ${naGithubie ? `<div class="wstega info"><b>Ten krok robi się raz na zawsze.</b>
          Ikona na telefonie prowadzi pod stały adres, więc kierowca nie skanuje kodu
          drugi raz — ani po zmianie adresu tunelu, ani po restarcie komputera w biurze.
          Zapisy czekające na zasięg zostają tam, gdzie były.</div>` : ''}
      </div>`;

    pole.querySelector('#zp-kopiuj').onclick = () => skopiujAdres(z.adres);
    pole.querySelector('#zp-drukuj').onclick = () => window.print();
  },
};

/* Kopiowanie dwiema drogami: schowek przeglądarki działa tylko pod https://
   albo na localhost, a biuro bywa pod http://192.168…                     */
async function skopiujAdres(adres) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(adres);
      komunikat('Adres skopiowany', 'ok');
      return;
    }
  } catch (e) { /* lecimy dalej, jest druga droga */ }
  try {
    const pomocnicze = document.createElement('textarea');
    pomocnicze.value = adres;
    pomocnicze.setAttribute('readonly', '');
    pomocnicze.style.position = 'fixed';
    pomocnicze.style.opacity = '0';
    document.body.appendChild(pomocnicze);
    pomocnicze.select();
    const udalo = document.execCommand('copy');
    document.body.removeChild(pomocnicze);
    komunikat(udalo ? 'Adres skopiowany' : 'Zaznacz adres i skopiuj ręcznie', udalo ? 'ok' : 'blad');
  } catch (e) {
    komunikat('Zaznacz adres i skopiuj ręcznie', 'blad');
  }
}
