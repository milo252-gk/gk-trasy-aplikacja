/* Service worker — dzieki niemu aplikacja otwiera sie w telefonie bez zasiegu.
   Trzyma kopie samego programu (HTML, style, skrypty, mapa). Danych nie
   buforuje tutaj — od tego jest IndexedDB w kolejka.js.                      */

const WERSJA = 'trasex-1c7d263b2ed1';
/* Zasoby wołamy ZE STEMPLEM wersji w adresie (?v=...). To jedyne, czego żadna
   pamięć podręczna nie obejdzie: po zmianie pliku zmienia się adres, więc stara
   kopia nie ma jak zostać podana. Poprzednio wystarczyło, że przeglądarka
   przytrzymała jeden plik, i aplikacja chodziła jako mieszanka wersji.
   index.html zostaje bez stempla — serwer oddaje go z „no-store". */
const ZASOBY = [
  './style.css', './app.js', './kolejka.js', './mapa.js', './podpis.js', './skrot.js',
  './biuro.js', './kierowca.js', './import.js', './eta.js', './dowody.js',
  './szablony.js', './firma.js', './zaproszenie.js', './ikona.svg', './logo-gkf.png', './logo-strefa.jpg',
  './ikona-192.png', './ikona-512.png', './ikona-maskable-512.png', './apple-touch-icon.png',
  './manifest.webmanifest', './vendor/leaflet.js', './vendor/leaflet.css',
  './vendor/marker-icon.png', './vendor/marker-icon-2x.png', './vendor/marker-shadow.png',
];
const SZKIELET = ['./', './index.html'].concat(ZASOBY.map(a => a + '?v=' + WERSJA));

/* Instalacja pliku po pliku, a NIE addAll.

   addAll jest wszystko-albo-nic na 22 plikach: jedno nieudane pobranie (a tunel
   cloudflared potrafi mrugnac) unieważniało całą instalację. Nowy worker wtedy
   nigdy nie wchodził, stary dalej rządził i podawał starą kopię programu —
   i dokładnie tak wyglądało „poprawka nie dotarła". Teraz brak jednego pliku
   nie blokuje wersji: kopia będzie niepełna, a brakujące pliki i tak przyjdą
   z sieci, bo tryb jest „najpierw sieć". */
self.addEventListener('install', e => {
  e.waitUntil(caches.open(WERSJA)
    .then(c => Promise.allSettled(SZKIELET.map(adres => c.add(adres))))
    .then(() => self.skipWaiting()));
});

/* Kasujemy WYŁĄCZNIE własne stare kopie (trasex-…). Na GitHub Pages wszystkie
   aplikacje GK mają jedno źródło i jedną listę pamięci podręcznych — skasowanie
   „wszystkiego poza moją wersją” zabierałoby offline GK Flota i aplikacjom hali. */
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(klucze => Promise.all(klucze.filter(k => k.indexOf('trasex-') === 0 && k !== WERSJA)
      .map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const adres = new URL(e.request.url);
  if (e.request.method !== 'GET') return;                 // zapisy zawsze do serwera
  if (adres.pathname.startsWith('/api/')) return;         // dane zawsze swieze
  if (adres.pathname.startsWith('/pliki/')) return;
  // adres.json (GitHub Pages) mówi, gdzie dziś stoi program w biurze. Musi być
  // świeży, a każde zapytanie ma inny znacznik czasu — kopia byłaby i stara,
  // i rosłaby bez końca.
  if (adres.pathname.endsWith('/adres.json')) return;

  // Zapytania na zewnatrz (kafelki mapy, router drogowy) sa obce — trzymamy sie
  // od nich z daleka. Kiedys trafialy w awaryjne oddanie index.html, wiec przy
  // braku sieci router zamiast czystego bledu polaczenia dostawal HTML-a.
  if (adres.origin !== self.location.origin) return;

  // Szkielet: najpierw siec (zeby poprawki dochodzily), kopia jako zabezpieczenie.
  // index.html oddajemy awaryjnie tylko przy wchodzeniu na strone — nigdy
  // w miejsce brakujacego skryptu czy obrazka.
  e.respondWith(
    fetch(e.request)
      .then(odp => {
        if (odp && odp.ok) {
          const kopia = odp.clone();
          caches.open(WERSJA).then(c => c.put(e.request, kopia));
        }
        return odp;
      })
      // Kopia awaryjna szuka NAJPIERW w pamieci biezacej wersji. Bez tego
      // caches.match przeszukiwal wszystkie pamieci po kolei i przy jednym
      // mrugnieciu sieci potrafil podac plik ze starej paczki — aplikacja
      // chodzila wtedy jako mieszanka wersji i nic tego nie zglaszalo.
      .catch(() => caches.open(WERSJA).then(c => c.match(e.request))
        .then(k => k || caches.match(e.request))
        .then(k => k || (e.request.mode === 'navigate' ? caches.match('./index.html')
                                                       : Promise.reject())))
  );
});

/* Powiadomienia przy ZAMKNIĘTEJ aplikacji — ten sam sposób co aplikacje hali
   (GK Panel Kierownika, wspolne/hala-push-sw.js). Program wysyła push BEZ
   treści (szyfrowanie treści wymagałoby bibliotek spoza Pythona), więc tutaj
   po jego otrzymaniu pytamy program „co nowego” adresem subskrypcji, który
   działa jak klucz, i dopiero wtedy pokazujemy powiadomienie.               */
/* Gdzie pytać o treść. Aplikacja z GitHub Pages ma dane pod adresem tunelu,
   który zmienia się po każdym uruchomieniu programu w biurze — dlatego adres
   bierzemy ŚWIEŻO z adres.json, a nie z pamięci sprzed restartu. Bez pliku
   (strona wydana przez sam program) dane są pod adresem aplikacji. */
async function adresDanychDlaPush() {
  try {
    const odp = await fetch(new URL('./adres.json', self.registration.scope).href
      + '?t=' + Date.now(), { cache: 'no-store' });
    if (odp.ok) {
      const opis = await odp.json();
      if (opis && opis.api) return String(opis.api).replace(/\/+$/, '') + '/';
    }
  } catch (err) { /* brak pliku albo sieci — zostaje adres aplikacji */ }
  return self.registration.scope;
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let wiadomosci = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const baza = await adresDanychDlaPush();
      const odp = await fetch(new URL('./api/push/co-nowego', baza).href, {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub ? sub.endpoint : '' }) });
      if (odp.ok) wiadomosci = (await odp.json()).wiadomosci || [];
    } catch (err) { /* program nieosiągalny — i tak coś pokażemy, żeby zajrzeć do aplikacji */ }

    // Aplikacja jest na ekranie — sama odświeża dane, drugie powiadomienie tylko by dublowało.
    const okna = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (okna.some(o => o.visibilityState === 'visible')) return;

    if (!wiadomosci.length) {
      wiadomosci = [{ tytul: 'GK Trasy', tresc: 'Coś się zmieniło — otwórz aplikację.', tag: 'gk-trasy', adres: '' }];
    }
    // Ikona PNG: SVG w powiadomieniu nie każda przeglądarka rysuje (Android), PNG — każda.
    const ikona = new URL('./ikona-192.png', self.registration.scope).href;
    await Promise.all(wiadomosci.map(w => self.registration.showNotification(w.tytul || 'GK Trasy', {
      body: w.tresc || '', tag: w.tag || 'gk-trasy', renotify: true, requireInteraction: !!w.pilne,
      icon: ikona, badge: ikona, vibrate: w.pilne ? [300, 150, 300, 150, 300] : [200],
      data: { adres: w.adres || '' } })));
  })());
});

/* Dotknięcie powiadomienia otwiera właściwy ekran: „#moja” (zlecenie kierowcy),
   „#trasa=12” (zlecenie z nieudaną dostawą), „#raporty”. Otwarta aplikacja
   dostaje wiadomość (app.js → otworzAdres), zamknięta otwiera się pod adresem. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const adres = (e.notification.data && e.notification.data.adres) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(okna => {
    const okno = okna[0];
    if (okno) {
      if (adres) okno.postMessage({ typ: 'otworz', adres });
      return okno.focus();
    }
    return self.clients.openWindow(new URL('./' + adres, self.registration.scope).href);
  }));
});
