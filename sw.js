/* GK Trasy: dawny adres aplikacji (D42) — ten service worker tylko sprząta po sobie.

   Pamięć podręczna jest wspólna dla całego https://milo252-gk.github.io (Panel, Lider, nowa GK Trasy…), więc usuwamy
   z niej WYŁĄCZNIE wpisy spod dawnego adresu tej aplikacji (pusta pamięć znika cała), potem wyrejestrowujemy
   się i przenosimy otwarte okna pod nowy adres. Zapytań nie obsługujemy — wszystko idzie do sieci. */
const NOWY = "https://milo252-gk.github.io/gk-panel-aplikacje/trasy/";
const DAWNY = self.registration.scope;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const nazwa of await caches.keys()) {
      try {
        const pamiec = await caches.open(nazwa);
        const wpisy = await pamiec.keys();
        const dawne = wpisy.filter(z => z.url.indexOf(DAWNY) === 0);
        for (const z of dawne) await pamiec.delete(z);
        if (dawne.length && dawne.length === wpisy.length) await caches.delete(nazwa);
      } catch (blad) { /* jedna pamięć nie zatrzymuje reszty */ }
    }
    await self.clients.claim();
    const okna = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const okno of okna) {
      try {
        const u = new URL(okno.url);
        if (okno.url.indexOf(DAWNY) === 0) await okno.navigate(NOWY + u.search + u.hash);
      } catch (blad) { /* okno zamknięte w międzyczasie */ }
    }
    await self.registration.unregister();
  })());
});
