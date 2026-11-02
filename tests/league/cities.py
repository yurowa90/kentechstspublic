import os, sys
pass  # pillow 필요: pip install pillow
from PIL import Image
from playwright.sync_api import sync_playwright
D = os.path.dirname(os.path.abspath(__file__)); SH = os.path.join(D, "shots")
IDS = ["hwaseong", "pyeongtaek", "anseong", "dangjin", "asan", "cheonan"]
with sync_playwright() as pw:
    br = pw.chromium.launch(); pg = br.new_page(viewport={"width": 1280, "height": 800}, locale="ko-KR")
    pg.goto("http://127.0.0.1:9410/index.html#home"); pg.wait_for_timeout(600)
    for i in IDS:
        pg.evaluate("""(id) => { const app = document.getElementById('app'); app.innerHTML = '';
          KCP.buildGame.mount(app, { packs: [id], league: true, load: () => ({ v: 2, map: id, maps: { [id]: { seed: 3110, builds: [], lines: [], policies: [], missions: [], shed: 'home', season: 'summer', fab2: false } }, runs: 0, jAuto: true, journal: [] }), save: () => {}, season: () => 'summer' }); }""", i)
        pg.wait_for_timeout(1400)
        pg.screenshot(path=f"{SH}/city-{i}.png")
    br.close()
ims = [Image.open(f"{SH}/city-{i}.png").resize((640, 400)) for i in IDS]
sheet = Image.new("RGB", (1280, 1200))
for k, im in enumerate(ims): sheet.paste(im, ((k % 2) * 640, (k // 2) * 400))
sheet.save(f"{SH}/cities-sheet.png")
print("ok")
