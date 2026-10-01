"""Isolated Chromium integration checks; server/browser shut down on completion."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json, subprocess, threading
from PIL import Image
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]; ART=ROOT/'artifacts'; ART.mkdir(exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT.parent)))
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
url=f'http://127.0.0.1:{server.server_port}/{ROOT.name}/'
im=Image.new('RGB',(800,600))
for color,box in [('red',(0,0,400,300)),('lime',(400,0,800,300)),('blue',(0,300,400,600)),('yellow',(400,300,800,600))]: im.paste(color,box)
im.save(ART/'quadrants.png');Image.new('RGB',(300,600),'cyan').save(ART/'portrait.png');(ART/'broken.png').write_bytes(b'not an image')
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libvpx','-c:a','libopus','-shortest',str(ART/'input.webm')],check=True)
results=[]
def passed(name): results.append(name);print('PASS',name,flush=True)
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
  errors=[];network=[]
  page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:network.append(r.url))
  page.goto(url);expect(page.locator('#status')).to_contain_text('サンプルを表示中')
  gpu=page.evaluate("""() => {const g=document.querySelector('canvas').getContext('webgl');const x=g.getExtension('WEBGL_debug_renderer_info');return {renderer:x?g.getParameter(x.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER),error:g.getError()}}""")
  assert gpu['error']==0,gpu
  passed('WebGL shader compile/render, project subpath hosting')
  def png(name):
   with page.expect_download() as d: page.locator('#png').click()
   d.value.save_as(ART/name);return Image.open(ART/name).convert('RGB')
  page.locator('#file').set_input_files(ART/'quadrants.png');expect(page.locator('#filename')).to_contain_text('quadrants.png')
  page.locator('#original').check();out=png('original.png')
  assert out.size==(800,600) and out.getpixel((100,100))[0]>240 and out.getpixel((100,500))[2]>240
  passed('Image load, PNG dimensions and original orientation')
  page.locator('#original').uncheck()
  for key in ['shine','blur','distortion']:page.locator('#'+key).fill('0')
  out=png('effect.png')
  assert out.getpixel((350,250))[0]>240 and out.getpixel((350,250))[1]>240
  assert out.getpixel((450,350))[0]>240 and out.getpixel((450,350))[1]<10
  passed('Lens flips both axes')
  page.locator('#invert').uncheck();out=png('upright.png')
  assert out.getpixel((350,250))[0]>240 and out.getpixel((350,250))[1]<10
  passed('Inversion toggle')
  page.locator('#reset').click();box=page.locator('#canvas').bounding_box()
  page.mouse.click(box['x']+box['width']*.3,box['y']+box['height']*.7)
  assert page.locator('#posX').input_value()=='30' and page.locator('#posY').input_value()=='70'
  page.locator('#reset').click();assert page.locator('#posX').input_value()=='50'
  passed('Pointer placement and reset')
  page.locator('#file').set_input_files(ART/'broken.png');expect(page.locator('#status')).to_contain_text('読み取れません');expect(page.locator('#png')).to_be_enabled()
  passed('Corrupt input error preserves usable editor')
  page.locator('#file').set_input_files(ART/'portrait.png');expect(page.locator('#dimensions')).to_have_text('300 × 600')
  passed('Portrait aspect ratio')
  for w in [320,375,414,768]:
   page.set_viewport_size({'width':w,'height':900});page.locator('#demo').click();page.locator('#radius').fill('40');png(f'mobile-{w}.png');page.locator('#reset').click()
   assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
   passed(f'{w}px sample/adjust/save/reset; no overflow')
  page.set_viewport_size({'width':375,'height':900});page.screenshot(path=str(ART/'mobile.png'),full_page=True)
  page.set_viewport_size({'width':1440,'height':1000})
  page.locator('#file').set_input_files(ART/'input.webm');expect(page.locator('#record')).to_be_enabled()
  page.locator('#play').click();expect(page.locator('#play')).to_have_text('一時停止');page.wait_for_timeout(300);page.locator('#play').click();page.locator('#seek').fill('1');expect(page.locator('#time')).to_contain_text('0:01')
  with page.expect_download(timeout=20000) as d:
   page.locator('#record').click();expect(page.locator('#open')).to_be_disabled();expect(page.locator('#radius')).to_be_disabled()
  d.value.save_as(ART/'recorded.webm');expect(page.locator('#status')).to_contain_text('動画を保存しました')
  probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(ART/'recorded.webm')]))
  streams={s['codec_type']:s for s in probe['streams']};assert 'video' in streams and 'audio' in streams
  assert streams['video']['width']==640 and streams['video']['height']==360
  packets=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_packets','-of','json',str(ART/'recorded.webm')]))['packets']
  duration=max(float(x.get('pts_time',0))+float(x.get('duration_time',0)) for x in packets);assert 1.7<duration<3.5,duration
  subprocess.run(['ffmpeg','-v','error','-i',str(ART/'recorded.webm'),'-f','null','-'],check=True)
  audio=subprocess.run(['ffmpeg','-hide_banner','-i',str(ART/'recorded.webm'),'-af','volumedetect','-vn','-f','null','-'],capture_output=True,text=True,check=True)
  assert 'mean_volume: -inf' not in audio.stderr
  passed('Video play/pause/seek, export locks, audio/video decode and duration')
  page.locator('#audio').uncheck()
  with page.expect_download(timeout=20000) as d:
   page.locator('#record').click();page.wait_for_timeout(450);page.locator('#stop').click()
  d.value.save_as(ART/'partial.webm')
  probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(ART/'partial.webm')]))
  assert all(s['codec_type']!='audio' for s in probe['streams']);expect(page.locator('#open')).to_be_enabled()
  passed('Early stop and audio opt-out')
  page.locator('#demo').click();page.screenshot(path=str(ART/'desktop.png'),full_page=True)
  assert not errors,errors
  assert all(r.startswith(url) or r.startswith('blob:') or r.startswith('data:') for r in network),network
  passed('No uncaught JS errors or external network calls')
  page.goto((ROOT/'index.html').as_uri());expect(page.locator('#status')).to_contain_text('サンプルを表示中')
  page.locator('#file').set_input_files(ART/'quadrants.png');expect(page.locator('#filename')).to_contain_text('quadrants.png');png('file-mode.png')
  passed('Direct file:// load and PNG save')
  (ART/'results.json').write_text(json.dumps({'checks':results,'gpu':gpu,'browser':browser.version,'video_duration':duration},ensure_ascii=False,indent=2));browser.close()
finally:
 server.shutdown();server.server_close();thread.join()
print(f'{len(results)} checks passed')
