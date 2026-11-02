// 실제 연결 코드를 가짜 소켓·시계로 검사한다. 브라우저·외부 네트워크는 사용하지 않는다.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../ui/league-net.js'), 'utf8');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function fixture() {
  let now = 0, serial = 0;
  const tasks = new Map(), sockets = [], channels = [];
  const later = (fn, ms, interval = false) => { const id = ++serial; tasks.set(id, { fn, at: now + ms, ms, interval }); return id; };
  function tick(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...tasks].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, t] = next; now = t.at; tasks.delete(id);
      if (t.interval) tasks.set(id, { ...t, at: now + t.ms });
      t.fn();
    }
    now = end;
  }
  class Socket {
    constructor() { this.readyState = 1; this.sent = []; sockets.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    receive(m) { this.onmessage({ data: JSON.stringify(m) }); }
    reply(m, status = 'ok') { this.receive({ topic: m.topic, event: 'phx_reply', ref: m.ref, join_ref: m.join_ref, payload: { status, response: { reason: '검사용 거절' } } }); }
    join() { this.onopen(); this.reply(this.sent.at(-1)); }
    close() { this.readyState = 3; this.onclose(); }
  }
  class Channel {
    constructor() { channels.push(this); }
    postMessage(data) { channels.filter(c => c !== this).forEach(c => c.onmessage({ data })); }
    close() {}
  }
  const context = { window: { KCP: {} }, TextEncoder, console, WebSocket: Socket, BroadcastChannel: Channel,
    setTimeout: later, clearTimeout: id => tasks.delete(id), setInterval: (fn, ms) => later(fn, ms, true), clearInterval: id => tasks.delete(id) };
  vm.runInNewContext(source, context);
  const N = context.window.KCP.leagueNet;
  // 단위4-A: ACK·경고 검사는 진행자 연결로 한정한다. 팀 연결의 기본값은 아래에서 별도로 확인한다.
  const conn = N.open({ kind: 'supabase', room: 'TESTROOM', url: 'ws://127.0.0.1/realtime/v1/websocket', key: 'fixture', ack: true });
  return { N, conn, sockets, tasks, tick, socket: sockets[0] };
}
{
  const { conn, socket, tick } = fixture();
  socket.join();
  ok(socket.sent[0].payload.config.broadcast.ack === true, 'join에서 모든 broadcast의 ack 요청');
  const delivered = [], missed = [], oversized = [];
  conn.on('delivered', x => delivered.push(x)); conn.on('undelivered', x => missed.push(x)); conn.on('oversize', x => oversized.push(x));
  conn.send('snap', { text: '가'.repeat(70000) });
  const m = socket.sent.at(-1), size = Buffer.byteLength(JSON.stringify(m));
  ok(size > 200000 && size < 256000, '256KB 아래 UTF-8 프레임은 이전 200KB 경계를 넘어 전송');
  socket.receive({ topic: m.topic, event: 'phx_reply', ref: '없는-ref', payload: { status: 'ok' } });
  ok(delivered.length === 0, '모르는 ref 무시'); socket.reply(m);
  ok(delivered.length === 1 && delivered[0].ev === 'snap' && delivered[0].bytes === size, 'ack ok는 해당 프레임의 종류·UTF-8 바이트와 delivered 알림');
  ok(Number.isSafeInteger(delivered[0].seq) && delivered[0].seq > 0, 'delivered에 연결 내 전송 순서 번호 포함');
  tick(5000); ok(missed.length === 0, 'ack 수신 시 타이머 해제');
  const payload = { text: 'x'.repeat(220000) };
  conn.send('snap', payload); const fail = socket.sent.at(-1), failBytes = Buffer.byteLength(JSON.stringify(fail));
  tick(4999); ok(missed.length === 0, '5초 이전에는 미확인 아님'); tick(1);
  ok(missed.length === 1 && missed[0].ev === 'snap' && missed[0].bytes === failBytes && missed[0].reason === 'timeout', '5초 후 프레임 바이트·시간 초과 이유와 미확인 알림');
  ok(missed[0].seq > delivered[0].seq, '시간 초과 undelivered에도 증가한 전송 순서 번호 포함');
  socket.reply(fail); ok(delivered.length === 1, '시간 초과 뒤 늦은 ack 무시');
  let count = socket.sent.length;
  ok(conn.send('snap', payload) && socket.sent.length === count + 1 && Buffer.byteLength(JSON.stringify(socket.sent.at(-1))) === failBytes, '미확인 뒤에도 같은 크기를 계속 보냄');
  socket.reply(socket.sent.at(-1), 'error');
  count = socket.sent.length;
  ok(conn.send('snap', { text: 'x'.repeat(230000) }) && socket.sent.length === count + 1 && oversized.length === 0, '미확인·error 뒤에도 SEND_CAP 아래 더 큰 상태를 계속 보냄');
  socket.reply(socket.sent.at(-1));
  conn.send('req', { text: '작은 요청' }); const rejected = socket.sent.at(-1); socket.reply(rejected, 'error');
  ok(missed.at(-1).ev === 'req' && missed.at(-1).bytes === Buffer.byteLength(JSON.stringify(rejected)) && missed.at(-1).reason === '검사용 거절', 'error 답도 프레임 바이트·서버 이유와 미확인 알림');
  ok(missed.at(-1).seq > delivered.at(-1).seq, '서버 거절 undelivered에도 전송 순서 번호 포함');
  const misses = missed.length; tick(5000);
  ok(missed.length === misses, 'error 답 뒤 시간 초과 중복 알림 없음');
  conn.close(); tick(10000);
}
{
  const { conn, socket } = fixture(); socket.join();
  const oversized = []; conn.on('oversize', x => oversized.push(x));
  const envelope = { topic: 'realtime:kcp-league-TESTROOM', event: 'broadcast', payload: { type: 'broadcast', event: 'snap', payload: '' }, ref: '2', join_ref: '1' };
  const data = 'x'.repeat(256000 - Buffer.byteLength(JSON.stringify(envelope)));
  ok(conn.send('snap', data) && Buffer.byteLength(JSON.stringify(socket.sent.at(-1))) === 256000, 'SEND_CAP 256000B까지 전송');
  const count = socket.sent.length;
  ok(conn.send('snap', data + 'x') === false && socket.sent.length === count && oversized.length === 1 && oversized[0].bytes === 256001, 'SEND_CAP 초과만 oversize로 전송 차단');
  conn.close();
}
{
  const { conn, socket, tick, tasks, sockets } = fixture(); socket.join();
  const delivered = [], missed = [];
  conn.on('delivered', x => delivered.push(x)); conn.on('undelivered', x => missed.push(x));
  for (let i = 0; i < 100; i++) conn.send('req', { i });
  ok([...tasks.values()].filter(t => !t.interval).length === 64, '대기 ack 타이머 최대 64개');
  ok(missed.length === 36 && missed.every((m, i) => m.reason === 'pending-limit' && m.bytes === Buffer.byteLength(JSON.stringify(socket.sent[i + 1]))), '표가 꽉 차면 오래된 36개부터 미확인으로 정리');
  ok(missed.every((m, i) => Number.isSafeInteger(m.seq) && (i === 0 || m.seq > missed[i - 1].seq)), '대기 상한 정리 이벤트도 전송 순서 번호 증가');
  for (const m of socket.sent.slice(1, 37)) socket.reply(m);
  ok(delivered.length === 0, '정리한 오래된 ref의 ack 무시');
  socket.reply(socket.sent[37]);
  ok(delivered.length === 1 && [...tasks.values()].filter(t => !t.interval).length === 63, '남은 가장 오래된 ref의 ack는 정상 처리');
  tick(5000); ok(missed.length === 99, '상한 정리 후 남은 63개도 각각 한 번만 시간 초과');
  conn.send('snap', '재연결 전'); const beforeReconnect = socket.sent.at(-1);
  socket.close(); tick(1000); const next = sockets.at(-1); next.join();
  socket.reply(beforeReconnect);
  ok(delivered.length === 1, '재연결 뒤 이전 소켓의 늦은 ack 무시');
  conn.send('snap', '재연결 후'); next.reply(next.sent.at(-1));
  ok(delivered.length === 2, '재연결 뒤 새 프레임 ack 정상 처리');
  ok(delivered[1].seq > Math.max(delivered[0].seq, ...missed.map(m => m.seq)), '소켓 재연결 뒤에도 연결 객체의 전송 순서 번호 증가');
  conn.send('snap', '닫기 전'); const late = next.sent.at(-1);
  conn.close(); next.reply(late); tick(10000);
  ok(delivered.length === 2 && missed.length === 99 && tasks.size === 0, '닫을 때 모든 타이머 해제·닫은 뒤 늦은 ack 무시');
}
// 기본값과 명시적 false 모두 ACK 추적 없이 팀 요청을 보낸다.
for (const option of [{}, { ack: false }]) {
  const { N, conn, sockets, tasks, tick } = fixture();
  conn.close();
  const team = N.open({ kind: 'supabase', room: 'TESTROOM', url: 'ws://127.0.0.1/realtime/v1/websocket', key: 'fixture', ...option });
  const socket = sockets.at(-1), results = [];
  team.on('delivered', x => results.push(x)); team.on('undelivered', x => results.push(x));
  team.send('req', { i: -1 }); socket.join();
  ok(socket.sent[0].payload.config.broadcast.ack === false, '팀 연결은 기본값·명시적 false 모두 broadcast.ack 비활성');
  for (let i = 0; i < 100; i++) team.send('req', { i });
  ok(socket.sent.filter(m => m.event === 'broadcast').length === 101, 'ACK 비활성 연결도 가입 전 대기 요청과 이후 요청을 모두 전송');
  ok([...tasks.values()].filter(t => !t.interval).length === 0 && results.length === 0, 'ACK 비활성 연결은 대기 타이머·상한 정리 이벤트 0개');
  for (const m of socket.sent.slice(1)) socket.reply(m);
  tick(5000);
  ok(results.length === 0, 'ACK 비활성 연결은 서버 답변·시간 경과에도 전달 이벤트 없음');
  team.close(); ok(tasks.size === 0, 'ACK 비활성 연결을 닫으면 남은 타이머 없음');
}
{
  const { N, conn, tick } = fixture(), a = N.open({ room: 'LOCAL' }), b = N.open({ room: 'LOCAL' });
  let got, events = 0; b.on('snap', x => { got = x; });
  a.on('undelivered', () => events++); a.on('delivered', () => events++);
  ok(a.send('snap', '로컬') && got === '로컬', '로컬 수신 유지'); tick(6000);
  ok(events === 0 && a.send('snap', 'x'.repeat(200001)) === false, '로컬 ack 없음·기존 크기 제한 유지');
  a.close(); b.close(); conn.close();
}
// 실제 진행자 open 구독과 경고 함수를 실제 연결 이벤트로 검사한다.
{
  const ui = fs.readFileSync(require('node:path').join(__dirname, '../../ui/league.js'), 'utf8');
  const openStart = ui.indexOf('      L.conn = NET.open('), openEnd = ui.indexOf(';', openStart);
  let hostOptions;
  vm.runInNewContext(ui.slice(openStart, openEnd + 1), {
    L: {}, save: { room: 'TESTROOM', net: { kind: 'supabase', ack: false } },
    NET: { open: options => { hostOptions = options; } }
  });
  ok(hostOptions.room === 'TESTROOM' && hostOptions.ack === true, '진행자 NET.open은 저장된 설정과 무관하게 ACK 요청');
  const teamOpenStart = ui.indexOf('      L.conn = NET.open(', openEnd);
  let teamOptions;
  vm.runInNewContext(ui.slice(teamOpenStart, ui.indexOf(';', teamOpenStart) + 1), {
    L: { net: { kind: 'supabase' } }, save: { room: 'TESTROOM' },
    NET: { open: options => { teamOptions = options; } }
  });
  ok(teamOptions.room === 'TESTROOM' && !teamOptions.ack, '팀 NET.open은 ACK 활성 옵션을 추가하지 않음');
  vm.runInNewContext(ui.slice(teamOpenStart, ui.indexOf(';', teamOpenStart) + 1), {
    L: { net: { kind: 'supabase', ack: true } }, save: { room: 'TESTROOM' },
    NET: { open: options => { teamOptions = options; } }
  });
  ok(teamOptions.ack === false, '팀 NET.open은 저장값에 ack:true가 있어도 끔');
  const start = ui.indexOf('  function hostChannelWatch()');
  const block = ui.slice(start, ui.indexOf('  function hostSend(', start));
  const statusStart = ui.indexOf('      L.conn.onStatus(s =>');
  const statusHook = ui.slice(statusStart, ui.indexOf('\n', statusStart));
  const { conn, socket, tick } = fixture();
  let writes = 0, text = '';
  const warning = { get textContent() { return text; }, set textContent(value) { text = value; writes++; } };
  const status = { dataset: {} }, subscribed = [], on = conn.on;
  conn.on = (ev, fn) => { subscribed.push(ev); on(ev, fn); };
  const session = { role: 'host', conn, saveWarning: true };
  const context = { L: session, session, connLabel: s => s, document: { getElementById: id => id === 'lg-host-warning' ? warning : status } };
  vm.runInNewContext(block + statusHook, context);
  ok(subscribed.length === 0, '연결 open 이전에는 경고 구독 없음');
  socket.join();
  ok(subscribed.length === 2 && subscribed.includes('delivered') && subscribed.includes('undelivered') && socket.sent.length === 1, '첫 open에 전달 결과만 구독·시험 프레임 없음');
  ok(text.includes('저장하지 못했어요') && !text.includes('전달 확인을 서버에서 받지 못했어요'), '초기에는 저장 경고만 표시');
  conn.send('snap', { text: 'x'.repeat(220000) }); tick(5000);
  ok(text.includes('방금 상태(220KB)의 전달 확인을 서버에서 받지 못했어요. 팀 화면이 멈췄으면 연결을 확인해요.'), '미확인 snap의 크기·연결 확인 경고 표시');
  ok(text.includes('저장하지 못했어요') && !text.includes('256KB') && !text.includes('한도'), '저장 경고와 공존·한도 추정 안내 없음');
  conn.send('req', '다른 종류'); socket.reply(socket.sent.at(-1));
  ok(text.includes('전달 확인을 서버에서 받지 못했어요'), 'snap 이외 delivered는 경고 유지');
  conn.send('snap', '다음 상태');
  ok(text.includes('전달 확인을 서버에서 받지 못했어요'), 'send 반환만으로 미확인 경고를 지우지 않음');
  socket.reply(socket.sent.at(-1));
  ok(!text.includes('전달 확인을 서버에서 받지 못했어요') && text.includes('저장하지 못했어요'), '다음 snap delivered에서 해제·저장 경고 유지');
  conn.send('snap', '이전 상태 A'); tick(4000);
  conn.send('snap', '새 상태 B'); socket.reply(socket.sent.at(-1));
  const afterDelivered = writes; tick(1000);
  ok(writes === afterDelivered && !text.includes('전달 확인을 서버에서 받지 못했어요'), 'B delivered 뒤 A 시간 초과가 경고를 다시 켜지 않음');
  conn.send('snap', '새 상태 C'); tick(5000);
  ok(text.includes('전달 확인을 서버에서 받지 못했어요'), '마지막 delivered보다 새 snap 시간 초과는 경고 표시');
  conn.send('snap', '회복 전 상태'); socket.reply(socket.sent.at(-1));
  conn.send('snap', '이전 상태 D'); const older = socket.sent.at(-1);
  conn.send('snap', '새 상태 E'); socket.reply(socket.sent.at(-1), 'error');
  socket.reply(older);
  ok(text.includes('전달 확인을 서버에서 받지 못했어요'), 'E 거절 뒤 늦게 온 D delivered가 경고를 지우지 않음');
  conn.send('snap', '회복 상태'); socket.reply(socket.sent.at(-1));
  socket.receive({ topic: socket.sent[0].topic, event: 'phx_error' }); tick(1000); socket.reply(socket.sent.at(-1));
  ok(subscribed.length === 2, '재연결 open에서도 전달 결과 구독 중복 없음');
  const before = writes;
  conn.send('snap', '재연결 상태'); tick(5000);
  ok(writes === before + 1 && text.includes('전달 확인을 서버에서 받지 못했어요'), '재연결 뒤 미확인 경고는 한 번만 갱신');
  session.conn = { kind: 'local' }; context.hostWarning();
  ok(!text.includes('전달 확인을 서버에서 받지 못했어요'), '로컬 연결에는 전달 경고 없음');
  session.role = 'team'; session.conn = conn; context.hostWarning();
  ok(!text.includes('전달 확인을 서버에서 받지 못했어요'), '팀에는 전달 경고 없음');
  const lastWrites = writes; context.L = { role: 'host', conn, saveWarning: false };
  conn.send('snap', '옛 세션'); socket.reply(socket.sent.at(-1));
  ok(writes === lastWrites, '종료한 진행자 세션의 전달 이벤트는 새 화면을 바꾸지 않음');
  conn.close();
}
// mockrt의 실제 RFC 6455 파서·중계 코드를 포트를 열지 않고 검사한다.
{
  const { EventEmitter } = require('node:events');
  const mockSource = fs.readFileSync(require('node:path').join(__dirname, 'mockrt.js'), 'utf8');
  const server = new EventEmitter(); server.listen = () => {};
  let statsHandler;
  vm.runInNewContext(mockSource, {
    require: name => name === 'http' ? { createServer: fn => { statsHandler = fn; return server; } } : require(name),
    Buffer, URL, console, process: { argv: ['node', 'mockrt.js', '19339', '--max-bytes', '87000'], env: {} }
  });
  function peer(ack) {
    const sock = new EventEmitter(), messages = [];
    sock.write = data => {
      if (!Buffer.isBuffer(data)) return;
      const n = data[1] & 127, offset = n < 126 ? 2 : n === 126 ? 4 : 10;
      messages.push(JSON.parse(data.subarray(offset).toString()));
    };
    sock.destroy = sock.end = () => sock.emit('close');
    server.emit('upgrade', { url: '/realtime/v1/websocket?apikey=fixture&vsn=1.0.0', headers: { 'sec-websocket-key': 'fixture' } }, sock);
    const send = m => {
      const data = Buffer.from(JSON.stringify(m)), mask = Buffer.from([1, 2, 3, 4]);
      let head;
      if (data.length < 126) head = Buffer.from([0x81, 0x80 | data.length]);
      else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0xfe; head.writeUInt16BE(data.length, 2); }
      else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0xff; head.writeBigUInt64BE(BigInt(data.length), 2); }
      const frame = Buffer.concat([head, mask, data.map((x, i) => x ^ mask[i % 4])]);
      // TCP 청크 경계가 헤더·본문과 일치하지 않는 경우도 검사한다.
      sock.emit('data', frame.subarray(0, 3)); sock.emit('data', frame.subarray(3));
    };
    send({ topic: 'realtime:test', event: 'phx_join', ref: '1', join_ref: '1', payload: { config: { broadcast: { self: false, ack } } } });
    return { send, messages };
  }
  const a = peer(true), b = peer(false);
  function broadcast(peer, size, ref) {
    const m = { topic: 'realtime:test', event: 'broadcast', payload: { type: 'broadcast', event: 'snap', payload: '' }, ref, join_ref: '1' };
    m.payload.payload = 'x'.repeat(size - Buffer.byteLength(JSON.stringify(m))); peer.send(m);
  }
  broadcast(a, 87000, '2'); broadcast(a, 87001, '3'); broadcast(b, 500, '4');
  ok(a.messages.some(m => m.ref === '2' && m.payload.status === 'ok'), 'mockrt ack:true는 같은 ref로 성공 답변');
  ok(!a.messages.some(m => m.ref === '3') && b.messages.filter(m => m.event === 'broadcast').length === 1, 'mockrt 한도 초과는 ack·전달 모두 생략');
  ok(!b.messages.some(m => m.ref === '4') && a.messages.some(m => m.event === 'broadcast'), 'mockrt ack:false는 답변 없이 중계');
  a.send({ topic: 'phoenix', event: 'heartbeat', ref: '5', payload: {} });
  ok(a.messages.some(m => m.ref === '5'), 'mockrt 초과 버림 뒤에도 연결 유지');
  let stats; statsHandler({}, { setHeader() {}, end: text => { stats = JSON.parse(text); } });
  ok(stats.dropped === 1 && stats.broadcasts === 3 && stats.badJoin === 0, 'mockrt stats 버림 수 집계');
}
console.log(`mockrt 포함 채널 ACK·경고 검사 ${checks}개 통과`);
