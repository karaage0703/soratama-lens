'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('canvas');
  const defaults = {radius:64, zoom:110, distortion:55, blur:45, shine:35, posX:50, posY:50};
  let source, sourceURL, downloadURL, frame = 0, upload = true, busy = false, recording = false;
  let recorder, capture, audioContext, audioSource, audioDestination, cancelLoad = 0;
  let frameCount = 0, fpsStart = performance.now(), stopReason = '';
  const gl = canvas.getContext('webgl', {alpha:false, antialias:false, powerPreference:'high-performance', preserveDrawingBuffer:true});
  const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
  if (!gl) {
    status('WebGLを使用できません。ブラウザのハードウェアアクセラレーションを有効にして再読み込みしてください。', true);
    document.querySelectorAll('button,input,select').forEach(el => el.disabled = true);
    return;
  }
  const isVideo = () => source instanceof HTMLVideoElement;
  const vertex = 'attribute vec2 a; varying vec2 uv; void main(){uv=a*0.5+0.5;gl_Position=vec4(a,0.,1.);}';
  const blurFragment = `precision mediump float;
    varying vec2 uv; uniform sampler2D tex; uniform vec2 stepSize;
    void main(){vec4 c=texture2D(tex,uv)*0.227027;
    c+=(texture2D(tex,uv+stepSize*1.384615)+texture2D(tex,uv-stepSize*1.384615))*0.316216;
    c+=(texture2D(tex,uv+stepSize*3.230769)+texture2D(tex,uv-stepSize*3.230769))*0.070270;
    gl_FragColor=c;}`;
  const effectFragment = `precision highp float;
    varying vec2 uv; uniform sampler2D tex; uniform sampler2D blurred;
    uniform vec2 size; uniform vec2 center; uniform float radius; uniform float zoom;
    uniform float distortion; uniform float shine; uniform float flip; uniform float compare;
    void main(){
      vec3 original=texture2D(tex,uv).rgb;
      if(compare>0.5){gl_FragColor=vec4(original,1.);return;}
      float shortSide=min(size.x,size.y);
      vec2 p=(uv-center)*size/(shortSide*radius);
      float r=length(p); float aa=2.0/(shortSide*radius);
      vec3 bg=texture2D(blurred,uv).rgb;
      // Radial remapping keeps the edge bounded; sign inversion forms the lens image.
      float radial=mix(1.,0.45+0.55*r,distortion);
      vec2 sampleUV=vec2(0.5)+p*radial*0.5/zoom*(shortSide/size)*flip;
      vec3 lens=texture2D(tex,clamp(sampleUV,vec2(0.001),vec2(0.999))).rgb;
      float rim=pow(clamp(r,0.,1.),14.);
      lens*=1.-0.19*shine*rim;
      float gleam=exp(-length((p-vec2(-0.35,0.47))*vec2(1.25,2.4))*10.);
      lens+=shine*(gleam*0.65+rim*0.20);
      float mask=1.-smoothstep(1.-aa,1.,r);
      gl_FragColor=vec4(mix(bg,lens,mask),1.);
    }`;
  function program(fragment) {
    const p = gl.createProgram();
    for (const [type, text] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
      const shader = gl.createShader(type); gl.shaderSource(shader,text); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(p,shader); gl.deleteShader(shader);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  let blurProgram, effectProgram;
  try { blurProgram=program(blurFragment); effectProgram=program(effectFragment); }
  catch (e) { status(`描画の初期化に失敗しました: ${e.message}`,true); document.querySelectorAll('button,input,select').forEach(e=>e.disabled=true); return; }
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  function texture() {
    const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return t;
  }
  const inputTexture=texture(), targets=[texture(),texture()], fbos=[gl.createFramebuffer(),gl.createFramebuffer()];
  const locations = new Map();
  function uniform(p,name) { const key=(p===blurProgram?'b':'e')+name; if(!locations.has(key))locations.set(key,gl.getUniformLocation(p,name)); return locations.get(key); }
  function use(p) { gl.useProgram(p); const a=gl.getAttribLocation(p,'a');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0); }
  function bind(t, unit=0){ gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t); }
  let width=1280,height=800,bw=320,bh=200;
  const maxTexture=gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const maxViewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  function resize() {
    if(!source)return;
    const sw=source.videoWidth||source.naturalWidth||source.width, sh=source.videoHeight||source.naturalHeight||source.height;
    const limit=Math.min(+$('quality').value,maxTexture,maxViewport[0],maxViewport[1]);
    const scale=Math.min(1,limit/Math.max(sw,sh));
    width=Math.max(2,Math.floor(sw*scale/2)*2);height=Math.max(2,Math.floor(sh*scale/2)*2);
    canvas.width=width;canvas.height=height;
    bw=Math.max(2,Math.round(width/4));bh=Math.max(2,Math.round(height/4));
    for(let i=0;i<2;i++) {
      bind(targets[i]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,bw,bh,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,fbos[i]);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,targets[i],0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('描画メモリが不足しています。');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    $('dimensions').textContent=`${width} × ${height}`;upload=true;schedule();
  }
  function render() {
    if(!source||gl.isContextLost())return;
    bind(inputTexture);
    if(upload) { gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);upload=false; }
    const blur=+$('blur').value;
    let background=inputTexture;
    if(blur>0) {
      use(blurProgram);gl.uniform1i(uniform(blurProgram,'tex'),0);gl.viewport(0,0,bw,bh);
      for(let i=0;i<2;i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER,fbos[i]);bind(i?targets[0]:inputTexture);
        const amount=blur/100*5;
        gl.uniform2f(uniform(blurProgram,'stepSize'),i?0:amount/bw,i?amount/bh:0);
        gl.drawArrays(gl.TRIANGLES,0,6);
      }
      background=targets[1];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);use(effectProgram);
    bind(inputTexture);bind(background,1);
    gl.uniform1i(uniform(effectProgram,'tex'),0);gl.uniform1i(uniform(effectProgram,'blurred'),1);
    gl.uniform2f(uniform(effectProgram,'size'),width,height);
    gl.uniform2f(uniform(effectProgram,'center'),+$('posX').value/100,1-(+$('posY').value/100));
    for(const [name,value] of Object.entries({radius:+$('radius').value/200,zoom:+$('zoom').value/100,distortion:+$('distortion').value/100,shine:+$('shine').value/100,flip:$('invert').checked?-1:1,compare:$('original').checked?1:0}))gl.uniform1f(uniform(effectProgram,name),value);
    gl.drawArrays(gl.TRIANGLES,0,6);gl.activeTexture(gl.TEXTURE0);
    frameCount++;
    const now=performance.now();
    if(now-fpsStart>1000){$('renderer').textContent=isVideo()&&!source.paused?`WebGL · ${(frameCount*1000/(now-fpsStart)).toFixed(0)} fps`:'WebGL · 待機';frameCount=0;fpsStart=now;}
  }
  function schedule(){ if(!frame)frame=requestAnimationFrame(()=>{frame=0;render();}); }
  function updateLabels(){ for(const key of Object.keys(defaults))$(key+'Out').value=key==='zoom'?`${(+$('zoom').value/100).toFixed(2)}×`:`${$(key).value}%`; }
  function lock(value) {
    busy=value;
    $('settings').disabled=value;
    for(const id of ['open','file','demo','reset','png','play','seek','audio','videoFormat'])$(id).disabled=value;
    $('record').disabled=value||!isVideo()||!window.MediaRecorder||!canvas.captureStream;
    updateFormat();
  }
  function supportedMime(format) {
    if(!window.MediaRecorder)return null;
    const sound=$('audio').checked;
    // Never use a generic MP4 MIME here: it can select Opus instead of AAC.
    const mp4=['avc1.42001E','avc1.4D0034','avc1'].map(codec=>`video/mp4;codecs=${codec}${sound?',mp4a.40.2':''}`);
    const webm=sound?['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus']:['video/webm;codecs=vp9','video/webm;codecs=vp8'];
    const choices=format==='mp4'?mp4:format==='webm'?webm:[...mp4,...webm];
    return choices.find(type=>MediaRecorder.isTypeSupported(type))||null;
  }
  function updateFormat() {
    const choice=$('videoFormat').value, mime=supportedMime(choice);
    const mp4Available=!!supportedMime('mp4');
    $('formatHint').textContent=mime
      ? `保存形式: ${mime.startsWith('video/mp4')?'MP4 / H.264'+($('audio').checked?' + AAC':'（音声なし）'):'WebM'}。${!mp4Available?'このブラウザは現在の音声設定でMP4保存に未対応です。':''}`
      : 'このブラウザは選択した形式で保存できません。WebMを選ぶか、音声を外してMP4対応を確認してください。';
    $('record').disabled=busy||!isVideo()||!mime||!canvas.captureStream;
  }
  async function resolveDuration(media) {
    if(Number.isFinite(media.duration))return;
    // MediaRecorder WebM commonly has no Duration element. Seek to discover its end.
    const end=waitEvent(media,'seeked');media.currentTime=1e10;await end;
    if(!Number.isFinite(media.duration))throw new Error('動画の長さを取得できません。別の形式でお試しください。');
    const start=waitEvent(media,'seeked');media.currentTime=0;await start;
  }
  function format(t){ if(!Number.isFinite(t))return '0:00';return `${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`; }
  function disposeSource(){
    if(isVideo()){source.pause();source.removeAttribute('src');source.load();}
    if(sourceURL)URL.revokeObjectURL(sourceURL);
    sourceURL=null;
    if(audioContext){void audioContext.close();audioContext=null;audioSource=null;audioDestination=null;}
  }
  function install(newSource,url,name){
    disposeSource();source=newSource;sourceURL=url;
    $('filename').textContent=name;$('transport').hidden=!isVideo();
    if(isVideo()){
      source.loop=true;
      source.addEventListener('play',()=>{$('play').textContent='一時停止';});
      source.addEventListener('pause',()=>{$('play').textContent='再生';});
      source.addEventListener('timeupdate',()=>{
        $('seek').value=source.currentTime;$('time').value=`${format(source.currentTime)} / ${format(source.duration)}`;
        if(recording)status(`動画を保存中… ${format(source.currentTime)} / ${format(source.duration)}（このタブを表示したまま）`);
      });
      source.addEventListener('seeked',()=>{upload=true;schedule();});
      source.addEventListener('ended',()=>{if(recording)stopRecording();});
      source.addEventListener('error',()=>{if(recording)stopRecording('動画の読み取りに失敗したため、ここまでを保存しました。');else status('この動画を再生できません。別の形式でお試しください。',true);});
      $('seek').max=source.duration;$('seek').value=0;$('play').textContent='再生';
      $('time').value=`0:00 / ${format(source.duration)}`;
      const current=source;
      function videoFrame(){if(source!==current)return;upload=true;schedule();if(current.requestVideoFrameCallback)current.requestVideoFrameCallback(videoFrame);}
      if(current.requestVideoFrameCallback)current.requestVideoFrameCallback(videoFrame);
      else {const tick=()=>{if(source!==current)return;if(!current.paused){upload=true;schedule();}requestAnimationFrame(tick);};requestAnimationFrame(tick);}
    }
    resize();lock(false);$('renderer').textContent='WebGL · 準備完了';
  }
  function waitEvent(target,event,timeout=15000){return new Promise((resolve,reject)=>{
    const done=()=>{cleanup();resolve();},bad=()=>{cleanup();reject(new Error('ファイルを読み取れません。対応形式の画像・動画を選んでください。'));};
    const timer=setTimeout(()=>{cleanup();reject(new Error('読み込みがタイムアウトしました。小さいファイルでお試しください。'));},timeout);
    const cleanup=()=>{clearTimeout(timer);target.removeEventListener(event,done);target.removeEventListener('error',bad);};
    target.addEventListener(event,done,{once:true});target.addEventListener('error',bad,{once:true});
  });}
  async function loadFile(file){
    if(!file||busy)return;
    const video=file.type.startsWith('video/')||/\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name);
    if(!video&&!file.type.startsWith('image/')&&!/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name)){status('画像または動画ファイルを選んでください。',true);return;}
    lock(true);status('ファイルを端末内で読み込み中…');
    const generation=++cancelLoad;
    const url=URL.createObjectURL(file);let media;
    try {
      if(video){media=document.createElement('video');media.muted=true;media.playsInline=true;media.preload='auto';const ready=waitEvent(media,'loadeddata');media.src=url;media.load();await ready;
        await resolveDuration(media);
        if(!Number.isFinite(media.duration)||media.duration<=0)throw new Error('長さを取得できない動画には対応していません。');
        if(media.videoWidth>maxTexture||media.videoHeight>maxTexture)throw new Error(`動画がGPUの入力上限 ${maxTexture}px を超えています。`);
      }else{
        media=new Image();const ready=waitEvent(media,'load');media.src=url;await ready;
        if(media.naturalWidth>maxTexture||media.naturalHeight>maxTexture){const scaled=document.createElement('canvas');const s=maxTexture/Math.max(media.naturalWidth,media.naturalHeight);scaled.width=Math.floor(media.naturalWidth*s);scaled.height=Math.floor(media.naturalHeight*s);scaled.getContext('2d').drawImage(media,0,0,scaled.width,scaled.height);media=scaled;}
      }
      if(generation!==cancelLoad){URL.revokeObjectURL(url);return;}
      install(media,url,file.name);status(video?'動画を読み込みました。再生して効果を確認できます。':'画像を読み込みました。スライダーで調整できます。');
    }catch(e){URL.revokeObjectURL(url);if(media instanceof HTMLVideoElement&&media!==source){media.removeAttribute('src');media.load();}lock(false);status(e.message,true);}
  }
  function demo(){
    if(busy)return;
    const c=document.createElement('canvas');c.width=1440;c.height=900;const ctx=c.getContext('2d');
    const sky=ctx.createLinearGradient(0,0,0,900);sky.addColorStop(0,'#203e55');sky.addColorStop(.53,'#dcbd91');sky.addColorStop(.54,'#8ba6a9');sky.addColorStop(1,'#243f4a');ctx.fillStyle=sky;ctx.fillRect(0,0,1440,900);
    ctx.fillStyle='#fae9c7';ctx.beginPath();ctx.arc(1070,240,64,0,Math.PI*2);ctx.fill();
    for(let layer=0;layer<3;layer++){ctx.fillStyle=['#637d86','#405d6b','#284551'][layer];ctx.beginPath();ctx.moveTo(0,510+layer*30);for(let x=0;x<=1440;x+=30){const y=405+layer*55-Math.sin(x/160+layer*2)*65-Math.sin(x/69+layer)*22;ctx.lineTo(x,y);}ctx.lineTo(1440,620);ctx.lineTo(0,620);ctx.fill();}
    for(let i=0;i<65;i++){const y=590+i*4.7;ctx.strokeStyle=`rgba(231,208,164,${.06+(i%4)*.025})`;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(960-(i*17%230),y);ctx.lineTo(1200+(i*23%130),y);ctx.stroke();}
    ctx.fillStyle='#1d333c';ctx.beginPath();ctx.moveTo(0,755);ctx.quadraticCurveTo(240,600,370,900);ctx.lineTo(0,900);ctx.fill();
    for(let i=0;i<12;i++){let x=i*27,y=705+Math.sin(i)*15;ctx.fillRect(x,y-60,3,90);ctx.beginPath();ctx.moveTo(x-24,y);ctx.lineTo(x+2,y-115);ctx.lineTo(x+28,y);ctx.fill();}
    install(c,null,'サンプル風景 · イラスト');status('サンプルを表示中。画像・動画を開くか、そのまま調整を試せます。');
  }
  function save(blob,name){
    if(!blob){status('保存に失敗しました。出力サイズを下げてお試しください。',true);return;}
    if(downloadURL)URL.revokeObjectURL(downloadURL);
    downloadURL=URL.createObjectURL(blob);const link=$('download');link.href=downloadURL;link.download=name;link.textContent=`${name} をダウンロード`;link.hidden=false;link.click();
  }
  function stopRecording(reason='') {if(!recording)return;stopReason=reason;recording=false;source.pause();if(recorder&&recorder.state!=='inactive')recorder.stop();}
  async function record(){
    if(busy||!isVideo())return;
    if(source.duration>600){status('初版の動画保存は10分以内に対応しています。先に動画を短くしてください。',true);return;}
    const mime=supportedMime($('videoFormat').value);
    if(!mime){status('選択した形式はこのブラウザでは保存できません。',true);return;}
    lock(true);status('動画保存を準備中…');stopReason='';let chunks=[],bytes=0;
    try {
      source.pause();source.loop=false;
      if($('audio').checked){
        if(!audioContext){audioContext=new AudioContext();audioSource=audioContext.createMediaElementSource(source);audioDestination=audioContext.createMediaStreamDestination();audioSource.connect(audioDestination);}
        await audioContext.resume();source.muted=false;
      }else source.muted=true;
      if(source.currentTime!==0){const ready=waitEvent(source,'seeked');source.currentTime=0;await ready;}
      upload=true;render();
      capture=canvas.captureStream(30);
      if($('audio').checked)for(const track of audioDestination.stream.getAudioTracks())capture.addTrack(track.clone());
      recorder=new MediaRecorder(capture,{mimeType:mime,videoBitsPerSecond:Math.min(24000000,width*height*5)});
      recorder.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>512*1024*1024)stopRecording('保存サイズが512MBに達したため、ここまでを保存しました。');}};
      recorder.onerror=()=>stopRecording('録画エラーが発生しました。保存ファイルは途中までの可能性があります。');
      recorder.onstop=()=>{
        save(new Blob(chunks,{type:recorder.mimeType}),`soratama.${recorder.mimeType.includes('mp4')?'mp4':'webm'}`);
        chunks=[];capture.getTracks().forEach(t=>t.stop());capture=null;recording=false;
        source.muted=true;source.loop=true;$('stop').hidden=true;$('record').hidden=false;lock(false);
        status(stopReason||'動画を保存しました。下のリンクから再ダウンロードできます。',!!stopReason);
      };
      recorder.start(1000);recording=true;$('stop').hidden=false;$('record').hidden=true;
      await source.play();upload=true;schedule();
    }catch(e){
      if(recording){stopRecording(`保存を完了できませんでした: ${e.message}`);}
      else {if(capture){capture.getTracks().forEach(t=>t.stop());capture=null;}source.muted=true;source.loop=true;lock(false);status(e.message,true);}
    }
  }
  $('open').onclick=()=>$('file').click();
  $('file').onchange=()=>{void loadFile($('file').files[0]);$('file').value='';};
  $('demo').onclick=demo;
  $('settings').oninput=event=>{updateLabels();if(event.target.id==='quality')resize();else schedule();};
  $('reset').onclick=()=>{for(const [key,value] of Object.entries(defaults))$(key).value=value;$('invert').checked=true;$('original').checked=false;updateLabels();schedule();};
  $('png').onclick=()=>{if(busy)return;upload=true;render();canvas.toBlob(blob=>{save(blob,'soratama.png');if(blob)status('PNGを保存しました。');},'image/png');};
  $('play').onclick=async()=>{if(!isVideo()||busy)return;try{if(source.paused)await source.play();else source.pause();}catch(e){status(`再生できません: ${e.message}`,true);}};
  $('seek').oninput=()=>{if(isVideo()&&!busy)source.currentTime=+$('seek').value;};
  $('videoFormat').onchange=updateFormat;$('audio').onchange=updateFormat;
  $('record').onclick=()=>void record();$('stop').onclick=()=>stopRecording('ここまでの動画を保存しました。');
  canvas.onpointerdown=e=>{if(busy)return;canvas.setPointerCapture(e.pointerId);move(e);};
  canvas.onpointermove=e=>{if(canvas.hasPointerCapture(e.pointerId))move(e);};
  function move(e){if(busy)return;const rect=canvas.getBoundingClientRect();$('posX').value=Math.max(0,Math.min(100,(e.clientX-rect.left)/rect.width*100));$('posY').value=Math.max(0,Math.min(100,(e.clientY-rect.top)/rect.height*100));updateLabels();schedule();}
  document.addEventListener('dragover',e=>{e.preventDefault();if(!busy)$('dropzone').classList.add('drag');});
  document.addEventListener('dragleave',e=>{if(!e.relatedTarget)$('dropzone').classList.remove('drag');});
  document.addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('drag');void loadFile(e.dataTransfer.files[0]);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&recording)stopRecording('タブが非表示になったため、ここまでを保存しました。');});
  window.addEventListener('beforeunload',e=>{if(recording){e.preventDefault();e.returnValue='';}});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(recording)stopRecording('GPU描画が中断しました。');status('GPU描画が中断しました。ページを再読み込みしてください。',true);lock(true);});
  updateLabels();demo();
})();
