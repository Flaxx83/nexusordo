/* Glastema – bara demo (#72). Läggs till av scripts/build-lokal.mjs --tema glas, efter appens script.
   "Liquid glass": en förskjutningskarta (R/G = förskjutning i x/y) där kanten trycks längs normalen som en menisk,
   används av ett SVG-filter som backdrop-filter. Bara Chromium stöder url() i backdrop-filter – övriga får frostat glas. */
(() => {
  document.body.classList.add('theme-glas');
  const brand = document.querySelector('.brand');
  if (brand) { const b = document.createElement('span'); b.className = 'glas-badge'; b.textContent = 'Demo – glastema'; brand.appendChild(b); }
  const chromium = /(Chrome|Chromium|Edg)\//.test(navigator.userAgent) && CSS.supports('backdrop-filter', 'url(#x)');
  const calm = matchMedia('(prefers-reduced-transparency: reduce)').matches;
  if (!chromium || calm) return;

  // Förskjutningskarta för en rundad rektangel w×h med hörnradie r; band = kantens bredd i px
  function paintMap(w, h, r, band, strength) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'), im = ctx.createImageData(w, h), px = im.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      // avstånd till kanten (negativt inuti) och normal för en rundad rektangel
      const qx = Math.abs(x + .5 - w / 2) - (w / 2 - r), qy = Math.abs(y + .5 - h / 2) - (h / 2 - r);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), out = Math.hypot(ox, oy);
      const d = out + Math.min(Math.max(qx, qy), 0) - r;
      let nx = 0, ny = 0;
      if (out > 0) { nx = ox / out; ny = oy / out; } else if (qx > qy) nx = 1; else ny = 1;
      nx *= Math.sign(x + .5 - w / 2) || 1; ny *= Math.sign(y + .5 - h / 2) || 1;
      let vx = 0, vy = 0;
      const depth = -d; // kanten: trycks längs normalen, som en menisk
      if (depth >= 0 && depth < band) {
        const t = 1 - depth / band, amp = Math.pow(t, 2.2) * Math.min(depth / 1.2, 1) * strength;
        vx -= nx * amp; vy -= ny * amp;
      }
      const k = (y * w + x) * 4;
      px[k] = Math.max(0, Math.min(255, 128 + vx * 127));
      px[k + 1] = Math.max(0, Math.min(255, 128 + vy * 127));
      px[k + 2] = 128; px[k + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    return c.toDataURL();
  }

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
  document.body.appendChild(svg);
  const made = new Map();
  function filterFor(w, h, r) {
    w = Math.max(8, Math.round(w)); h = Math.max(8, Math.round(h));
    const key = `${w}x${h}x${r}`;
    if (made.has(key)) return made.get(key);
    const id = 'lg' + made.size;
    const f = document.createElementNS(NS, 'filter');
    f.setAttribute('id', id); f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', w); f.setAttribute('height', h);
    f.setAttribute('filterUnits', 'userSpaceOnUse'); f.setAttribute('color-interpolation-filters', 'sRGB');
    f.innerHTML = `<feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b"/>
      <feImage href="${paintMap(w, h, r, Math.min(22, Math.min(w, h) / 3), 1)}" x="0" y="0" width="${w}" height="${h}" result="m"/>
      <feDisplacementMap in="b" in2="m" scale="42" xChannelSelector="R" yChannelSelector="G"/>
      <feColorMatrix type="saturate" values="1.5"/>`;
    svg.appendChild(f); made.set(key, id);
    return id;
  }
  // en filterbana per yta: linsen ersätter frosten
  const apply = el => {
    if (!el.isConnected || el.offsetWidth < 8) return;
    const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12;
    el.style.setProperty('--lg-filter', `url(#${filterFor(el.offsetWidth, el.offsetHeight, r)})`);
  };
  const SEL = '.topbar, .menu, .modal, .tour-pop';
  const scan = () => document.querySelectorAll(SEL).forEach(apply);
  document.body.classList.add('lg-on');
  scan();
  new MutationObserver(() => requestAnimationFrame(scan)).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  addEventListener('resize', () => requestAnimationFrame(scan));
})();
