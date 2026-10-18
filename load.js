// Test de charge du serveur : 300 connexions dans 50 salons, chat diffusé, délai mesuré.
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const URL = 'ws://localhost:8080';
const ROOMS = 50, PER = 6;
(async () => {
  const clients = [];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: ROOMS * PER }, (_, i) => new Promise((res, rej) => {
    const ws = new WebSocket(URL); const room = 'LOAD' + Math.floor(i / PER);
    const c = { ws, room, got: 0, lat: [] }; clients.push(c);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name: 'u' + i, kind: 'salon' }));
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.t === 'welcome') res(); if (m.t === 'chat') { c.got++; c.lat.push(Date.now() - Number(m.text)); } };
    ws.onerror = rej; setTimeout(() => rej(new Error('timeout')), 15000);
  })));
  ok(true, `${ROOMS * PER} connexions ouvertes en ${Date.now() - t0} ms`);
  // chaque participant envoie 5 messages
  for (let k = 0; k < 5; k++) { for (const c of clients) c.ws.send(JSON.stringify({ t: 'chat', text: String(Date.now()) })); await new Promise(r => setTimeout(r, 200)); }
  await new Promise(r => setTimeout(r, 2000));
  const expected = 5 * PER, got = clients.map(c => c.got), lat = clients.flatMap(c => c.lat).sort((a, b) => a - b);
  ok(got.every(g => g === expected), `chaque participant reçoit les ${expected} messages de son salon (min ${Math.min(...got)})`);
  const p95 = lat[Math.floor(lat.length * 0.95)];
  ok(p95 < 500, `délai de diffusion : médiane ${lat[Math.floor(lat.length / 2)]} ms, 95 % sous ${p95} ms (${lat.length} messages)`);
  const stats = await (await fetch('http://localhost:8080/stats')).json();
  ok(stats.clients >= ROOMS * PER, `serveur : ${stats.rooms} salons et ${stats.clients} connexions actives`);
  clients.forEach(c => c.ws.close());
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
