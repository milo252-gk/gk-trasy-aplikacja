/* Skrót numeru zamówienia — musi dać dokładnie ten sam wynik co Python.

   Po co w ogóle skrót: kierowca ma wpisać numer z dokumentu przy palecie,
   a nie przepisać go z aplikacji. Telefon dostaje więc sam skrót i porównuje
   go z tym, co kierowca wystukał — dzięki temu pomyłka wychodzi pod rampą,
   także bez zasięgu.

   Dlaczego własny SHA-256, skoro przeglądarka ma crypto.subtle: bo
   crypto.subtle istnieje TYLKO w bezpiecznym kontekście (https albo
   localhost). Kierowca wchodzący z telefonu po zwykłym http://192.168...
   dostałby undefined i kontrola numeru przestałaby działać dokładnie tam,
   gdzie jest najbardziej potrzebna — w magazynie.                          */

const Skrot = (() => {
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];

  function sha256hex(tekst) {
    const bajty = [];
    for (const znak of unescape(encodeURIComponent(tekst))) bajty.push(znak.charCodeAt(0));
    const dlugoscBitow = bajty.length * 8;
    bajty.push(0x80);
    while (bajty.length % 64 !== 56) bajty.push(0);
    for (let i = 7; i >= 0; i--) bajty.push((dlugoscBitow / Math.pow(2, i * 8)) & 0xff);

    let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
             0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Array(64);
    const obrot = (x, n) => (x >>> n) | (x << (32 - n));

    for (let blok = 0; blok < bajty.length; blok += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = (bajty[blok + i * 4] << 24) | (bajty[blok + i * 4 + 1] << 16)
             | (bajty[blok + i * 4 + 2] << 8) | bajty[blok + i * 4 + 3];
      }
      for (let i = 16; i < 64; i++) {
        const s0 = obrot(w[i - 15], 7) ^ obrot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = obrot(w[i - 2], 17) ^ obrot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = obrot(e, 6) ^ obrot(e, 11) ^ obrot(e, 25);
        const wybor = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + wybor + K[i] + w[i]) | 0;
        const S0 = obrot(a, 2) ^ obrot(a, 13) ^ obrot(a, 22);
        const wiekszosc = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + wiekszosc) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h = h.map((x, i) => (x + [a, b, c, d, e, f, g, hh][i]) | 0);
    }
    return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  /* Ta sama normalizacja co na serwerze: bez wielkości liter, spacji,
     myślników i ukośników. „WZ 12/34", „wz-1234" i „WZ1234" to jeden numer —
     inaczej kierowca dostawałby czerwone ostrzeżenie za sam myślnik. */
  /* \p{L}\p{N} to dokładnie to samo kryterium co isalnum() w Pythonie — dzięki
     temu obie strony liczą skrót z tych samych znaków. Wzorzec budujemy przez
     new RegExp, a nie literałem, CELOWO: literał z nieznaną składnią wywraca
     się przy PARSOWANIU pliku, czyli zabrałby całą kontrolę numeru, a nie tylko
     ten jeden wariant. new RegExp rzuca dopiero przy wywołaniu, więc da się to
     złapać i zejść do prostszego zestawu znaków. */
  const WZOR_ZNAKOW = (() => {
    try {
      return new RegExp('[^\\p{L}\\p{N}]', 'gu');
    } catch (e) {
      return /[^A-Z0-9ĄĆĘŁŃÓŚŹŻ]/g;
    }
  })();

  function normalizuj(numer) {
    return (numer || '').toUpperCase().replace(WZOR_ZNAKOW, '');
  }

  function numeru(numer) {
    const czysty = normalizuj(numer);
    return czysty ? sha256hex('zaladunek:' + czysty).slice(0, 32) : '';
  }

  return { sha256hex, normalizuj, numeru };
})();
