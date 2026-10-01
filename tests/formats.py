"""MP4 capability gating and rereading MediaRecorder WebM; run after smoke.py."""
from pathlib import Path
import json
import subprocess
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1];ART=ROOT/'artifacts'
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=b.new_page(accept_downloads=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto((ROOT/'index.html').as_uri())
 page.locator('#file').set_input_files(ART/'recorded.webm')
 expect(page.locator('#filename')).to_contain_text('recorded.webm',timeout=20000)
 expect(page.locator('#record')).to_be_enabled()
 print('PASS WebM without duration metadata can be reopened',flush=True)
 # This test Chromium supports H.264 video but not AAC recording.
 page.locator('#videoFormat').select_option('mp4')
 expect(page.locator('#record')).to_be_disabled()
 expect(page.locator('#audio')).to_be_checked()
 expect(page.locator('#formatHint')).to_contain_text('保存できません')
 print('PASS unsupported audio+MP4 does not silently remove audio',flush=True)
 page.locator('#audio').uncheck()
 expect(page.locator('#record')).to_be_enabled()
 expect(page.locator('#formatHint')).to_contain_text('MP4 / H.264')
 page.locator('#original').check()
 with page.expect_download(timeout=20000) as d:
  page.locator('#record').click();expect(page.locator('#videoFormat')).to_be_disabled()
 assert d.value.suggested_filename=='soratama.mp4';d.value.save_as(ART/'native.mp4')
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(ART/'native.mp4')]))
 assert len(probe['streams'])==1 and probe['streams'][0]['codec_name']=='h264',probe
 subprocess.run(['ffmpeg','-v','error','-i',str(ART/'native.mp4'),'-f','null','-'],check=True)
 assert float(probe['format']['duration'])>1
 print('PASS MP4 file contains decodable H.264 video',flush=True)
 page.locator('#videoFormat').select_option('auto');expect(page.locator('#formatHint')).to_contain_text('MP4 / H.264')
 page.locator('#audio').check();expect(page.locator('#formatHint')).to_contain_text('WebM')
 print('PASS automatic selection reflects audio capability',flush=True)
 # Verify actual unsupported browsers cannot start MP4 recording.
 page.evaluate("MediaRecorder.isTypeSupported=()=>false")
 page.locator('#videoFormat').select_option('mp4');expect(page.locator('#record')).to_be_disabled()
 page.set_viewport_size({'width':375,'height':900});page.screenshot(path=str(ART/'format-mobile.png'),full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');assert not errors,errors
 print('PASS unsupported formats and mobile layout',flush=True)
 b.close()
