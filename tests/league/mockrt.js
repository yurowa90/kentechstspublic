// 검사용 가짜 Supabase Realtime(Phoenix vsn 1.0.0) 서버. 의존성 없이 RFC 6455 텍스트 프레임만.
// node mockrt.js <port> [--max-bytes N]  → ws://127.0.0.1:<port>/realtime/v1/websocket
// phx_join → ok 답, broadcast → 같은 topic의 다른 소켓에 전달(self:false), heartbeat → ok 답. 받은 메시지 수를 /stats로.
const http = require("http"), crypto = require("crypto");
const port = +process.argv[2] || 9310;
const sizeArg = process.argv.indexOf("--max-bytes");
const maxBytes = Number(sizeArg >= 0 ? process.argv[sizeArg + 1] : process.env.MOCK_MAX_BYTES) || Infinity;
const socks = new Set();
const stats = { joins: 0, broadcasts: 0, heartbeats: 0, badJoin: 0, dropped: 0, keys: [] };
const srv = http.createServer((req, res) => { res.setHeader("access-control-allow-origin", "*"); res.end(JSON.stringify(stats)); });
srv.on("upgrade", (req, sock) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname !== "/realtime/v1/websocket" || !u.searchParams.get("apikey") || u.searchParams.get("vsn") !== "1.0.0") { sock.destroy(); return; }
  stats.keys.push(u.searchParams.get("apikey"));
  const acc = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  const S = { sock, topics: new Set(), ack: new Set(), buf: Buffer.alloc(0) };
  socks.add(S);
  const send = obj => {
    const data = Buffer.from(JSON.stringify(obj));
    let head;
    if (data.length < 126) head = Buffer.from([0x81, data.length]);
    else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
    try { sock.write(Buffer.concat([head, data])); } catch (e) { /* closed */ }
  };
  S.send = send;
  sock.on("data", chunk => {
    S.buf = Buffer.concat([S.buf, chunk]);
    for (;;) {
      const b = S.buf;
      if (b.length < 2) return;
      const op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      const need = off + (masked ? 4 : 0) + len;
      if (b.length < need) return;
      let payload = b.slice(off + (masked ? 4 : 0), need);
      if (masked) { const m = b.slice(off, off + 4); payload = Buffer.from(payload.map((x, i) => x ^ m[i % 4])); }
      S.buf = b.slice(need);
      if (op === 8) { sock.end(); return; }
      if (op !== 1) continue;
      let msg;
      try { msg = JSON.parse(payload.toString()); } catch (e) { continue; }
      if (msg.topic === "phoenix" && msg.event === "heartbeat") { stats.heartbeats++; send({ topic: "phoenix", event: "phx_reply", payload: { status: "ok", response: {} }, ref: msg.ref }); continue; }
      if (msg.event === "phx_join") {
        const c = msg.payload && msg.payload.config;
        const ok = c && c.broadcast && c.broadcast.self === false && /^realtime:/.test(msg.topic);
        if (!ok) stats.badJoin++;
        else { S.topics.add(msg.topic); if (c.broadcast.ack === true) S.ack.add(msg.topic); else S.ack.delete(msg.topic); stats.joins++; }
        send({ topic: msg.topic, event: "phx_reply", payload: ok ? { status: "ok", response: { postgres_changes: [] } } : { status: "error", response: { reason: "bad join" } }, ref: msg.ref, join_ref: msg.join_ref });
        continue;
      }
      if (msg.event === "broadcast" && S.topics.has(msg.topic) && msg.payload && msg.payload.type === "broadcast") {
        stats.broadcasts++;
        // 검사 장치: 크기 초과 시 연결은 유지한 채 전달과 ack를 모두 생략한다.
        if (payload.length > maxBytes) { stats.dropped++; continue; }
        if (S.ack.has(msg.topic)) send({ topic: msg.topic, event: "phx_reply", payload: { status: "ok" }, ref: msg.ref, join_ref: msg.join_ref });
        socks.forEach(o => { if (o !== S && o.topics.has(msg.topic)) o.send({ topic: msg.topic, event: "broadcast", payload: msg.payload, ref: null }); });
      }
    }
  });
  sock.on("close", () => socks.delete(S));
  sock.on("error", () => socks.delete(S));
});
srv.listen(port, "127.0.0.1", () => console.log("mockrt on", port));
