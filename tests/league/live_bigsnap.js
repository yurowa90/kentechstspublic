/* live.py용 6팀 최대 snap. 외부 연결·학생 글 없이 sec.js와 같은 실제 엔진을 쓴다. */
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
global.window = { KCP: { route() {}, on() {}, esc: String } };
global.document = { documentElement: {} };
for (const file of ["build-maps", "tech-data", "build", "econ-data", "econ", "league-data", "league-core", "league-ai", "league-net"]) {
  require(path.resolve(__dirname, "../../ui", file + ".js"));
}
const K = window.KCP, C = K.leagueCore, N = K.leagueNet, BG = K.buildGame;
const R = Object.values(K.LEAGUE_REGIONS).find(r => r.teams.length === 6);
const ids = R.teams.map(t => t.id);
// 실제 프로젝트 주소·키·방과 무관한 고정 가상값. 실채널도 같은 8글자 방 이름을 쓴다.
const ROOM = "BGSNAPAA", SID = "fixture-session-bigsnap", CLOCK = 1700000000000;

async function main() {
  const maxima = [];
  for (const turns of [12, 36]) {
    let largest = null;
    for (const style of ["careful", "bold"]) {
      const host = await N.createIdentity();
      const S = Object.assign(C.newState(ROOM, R.id, 0, ids, { turns, seedMode: "room" }), { sid: SID });
      for (const team of ids) {
        assert.ok(C.reduce(S, { type: "claim", team, token: "solo-city-" + team }, 0, BG).ok);
      }
      async function record() {
        const signed = await N.signHost(host, "snap", ROOM, SID, C.publicView(S, CLOCK));
        // 새 앱 연결은 join ref=1, 첫/두 번째 send ref=2/3(같은 바이트 수)이다.
        const frameBytes = N.byteLength(N.broadcastMessage(ROOM, "snap", signed, "2", "1"));
        // 상한 두 개(ui/league-net.js): 원격 채널 SEND_CAP 256,000B는 Broadcast 프레임에,
        // 로컬 BroadcastChannel MAX_BYTES 200,000B는 {ev, data}에 적용된다. 6팀 판은 두 연결 방식 모두 가능해야 한다.
        assert.ok(frameBytes <= 256000, "원격 채널 송신 상한(256,000B) 안의 실제 서명 프레임");
        assert.ok(N.byteLength({ ev: "snap", data: signed }) <= 200000, "로컬 연결 송신 상한(200,000B) 안의 같은 스냅");
        if (!largest || frameBytes > largest.frameBytes) {
          largest = { turns, style, month: S.round, phase: S.phase, rev: S.rev,
            frameBytes, signedBytes: N.byteLength(signed), signed };
        }
      }
      await record();
      for (let month = 1; month <= turns; month++) {
        assert.ok(C.host(S, "next", CLOCK + month * 100) && S.round === month && S.phase === "plan");
        await record();
        C.computerPlans(S, BG, null, style);
        await record();
        C.computerPlans(S, BG, null, style, true);
        await record();
        assert.ok(C.run(S, BG, CLOCK + month * 100 + 1) && S.phase === "review");
        assert.equal(S.results.length, month);
        await record();
      }
      assert.ok(C.host(S, "next", CLOCK + (turns + 1) * 100) && S.phase === "end");
      await record();
    }
    maxima.push(largest);
  }
  process.stdout.write(JSON.stringify(maxima) + "\n");
}
main().catch(() => {
  // 예외 원문·스냅·키는 진단 출력에 넣지 않는다.
  process.stderr.write("FAIL 6팀 최대 스냅 생성\n");
  process.exitCode = 1;
});
