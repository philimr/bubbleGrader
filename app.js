// ── Constants ──
const SW=816,SH=1056,MKSZ=40,MKMG=10,BubR=9;
const CH=['A','B','C','D','E'];
// Corner marker centres in template space (px).
// Markers are placed just outside the four corners of the bubble grid so that
// paper-edge curl (which affects the corners of the page) does not displace them.
// TL/BL: x=75 — one marker-width to the left of bubble column A (leftmost extent x=96).
// TR/BR: x=650 — one marker-width to the right of bubble column E (rightmost extent x=628).
// Top markers (y=144): between the horizontal separator (y=120) and the first bubble row (y=181).
// Bottom markers (y=988): between the last bubble row (y=967) and the footer text (y=1034).
// All four are well within the 32%-quadrant search areas used by detectCorners().
const TC={TL:[75,144],TR:[650,144],BL:[75,988],BR:[650,988]};
const LX=[105,141,177,213,249]; // left col A-E bubble X
const RX=[475,511,547,583,619]; // right col A-E bubble X
const STARTY=190, ROWH=32;
function bxy(q,c){ return [(q<25?LX:RX)[c], STARTY+(q%25)*ROWH]; }

// ── State ──
const S={ key:new Array(50).fill(null), students:[], stream:null, detected:null, rawCanvas:null,
          baseCanvas:null,    // current full working image after any orientation rotation
          manualCorners:null, manualOri:0, detectedCorners:null, lastRender:null,
          sessionRotation:0 }; // degrees (0/90/180/270) auto-applied to every new image
const STORE_KEY='bubbleGrader.v1';
var adjDragging=-1;
var cropState={active:false,dragging:false,startX:0,startY:0,x:0,y:0,w:0,h:0};
var perspState={active:false,handles:null,dragging:-1};
var previewReq=0;

function validAnswer(a){ return a===null||CH.indexOf(a)>=0||a==='?'; }

function loadSavedData(){
  try{
    var raw=localStorage.getItem(STORE_KEY);
    if(!raw) return;
    var saved=JSON.parse(raw);
    if(saved&&Array.isArray(saved.key)&&saved.key.length===50){
      S.key=saved.key.map(function(a){ return CH.indexOf(a)>=0?a:null; });
    }
    if(saved&&Array.isArray(saved.students)){
      S.students=saved.students.filter(function(s){
        return s&&typeof s.name==='string'&&Array.isArray(s.answers)&&s.answers.length===50;
      }).map(function(s){
        var answers=s.answers.map(function(a){ return validAnswer(a)?a:null; });
        var scored=scoreOf(answers);
        return {name:s.name,answers:answers,correct:scored.correct,total:scored.total,pct:scored.pct};
      });
    }
    if(saved&&typeof saved.className==='string') document.getElementById('className').value=saved.className;
    if(saved&&saved.passPct!==undefined) document.getElementById('passPct').value=saved.passPct;
  }catch(e){
    console.warn('Could not load saved Bubble Grader data',e);
  }
}

function saveData(){
  try{
    localStorage.setItem(STORE_KEY,JSON.stringify({
      key:S.key,
      students:S.students,
      className:document.getElementById('className').value||'',
      passPct:document.getElementById('passPct').value||70
    }));
  }catch(e){
    console.warn('Could not save Bubble Grader data',e);
  }
}

function refreshStudentScores(){
  S.students=S.students.map(function(s){
    var scored=scoreOf(s.answers);
    return {name:s.name,answers:s.answers,correct:scored.correct,total:scored.total,pct:scored.pct};
  });
}

function clearResultsOnly(){
  var msg='Clear all saved student results and class name from this browser? The answer key will be kept.';
  if(!confirm(msg)) return;
  S.students=[];
  document.getElementById('className').value='';
  saveData();
  updateHeader();
  buildResults();
  setAlert('ok','Saved results cleared. The answer key was kept.');
}

function clearKeyAndResults(){
  var msg='Clear the saved answer key, student results, and class name from this browser? This cannot be undone.';
  if(!confirm(msg)) return;
  S.key=new Array(50).fill(null);
  S.students=[];
  document.getElementById('className').value='';
  saveData();
  buildKeyGrid();
  updateHeader();
  buildResults();
  setAlert('ok','Saved answer key and results cleared.');
}

function clearSavedData(){
  clearKeyAndResults();
}

// ── Navigation ──
document.getElementById('navBar').addEventListener('click', function(e){
  var btn = e.target;
  while(btn && !btn.dataset.tab) btn = btn.parentElement;
  if(!btn) return;
  var name = btn.dataset.tab;
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('on'); });
  document.querySelectorAll('.nb').forEach(function(b){ b.classList.remove('on'); });
  document.getElementById('tab-'+name).classList.add('on');
  btn.classList.add('on');
  if(name==='template') buildTemplate();
  if(name==='results') buildResults();
});

// ── Setup: answer key ──
function buildKeyGrid(){
  var g=document.getElementById('keyGrid');
  g.innerHTML='';
  for(var q=0;q<50;q++){
    var row=document.createElement('div');
    row.className='kr';
    row.innerHTML='<span class="qn">'+(q+1)+'</span>';
    (function(qq){
      CH.forEach(function(ch){
        var b=document.createElement('button');
        b.className='cb'+(S.key[qq]===ch?' sel':'');
        b.textContent=ch;
        b.onclick=function(){ S.key[qq]= S.key[qq]===ch?null:ch; refreshStudentScores(); buildKeyGrid(); saveData(); updateHeader(); buildResults(); };
        row.appendChild(b);
      });
    })(q);
    g.appendChild(row);
  }
}
function randomKey(){ S.key=CH.map?Array.from({length:50},function(){ return CH[Math.floor(Math.random()*5)]; }):null; if(!S.key){S.key=[];for(var i=0;i<50;i++)S.key.push(CH[Math.floor(Math.random()*5)]);} refreshStudentScores(); buildKeyGrid(); saveData(); updateHeader(); buildResults(); }
function clearKey(){ S.key=new Array(50).fill(null); refreshStudentScores(); buildKeyGrid(); saveData(); updateHeader(); buildResults(); }

// ── Template ──
function makeSVG(){
  var W=SW,H=SH,LY=STARTY-22;
  var s='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">';
  s+='<rect width="'+W+'" height="'+H+'" fill="white"/>';
  for(var r=0;r<25;r++) if(r%2===0){
    var y=STARTY+r*ROWH-14;
    s+='<rect x="58" y="'+y+'" width="228" height="'+ROWH+'" fill="#f5f5f3"/>';
    s+='<rect x="428" y="'+y+'" width="228" height="'+ROWH+'" fill="#f5f5f3"/>';
  }
  // Markers just outside the 4 corners of the bubble grid, well away from the paper edges
  // where curl is most likely. TC in app.js stores their centres and must stay in sync.
  // TL [55,124]→centre(75,144)  TR [630,124]→centre(650,144)
  // BL [55,968]→centre(75,988)  BR [630,968]→centre(650,988)
  [[55,124],[630,124],[55,968],[630,968]].forEach(function(xy){
    s+='<rect x="'+xy[0]+'" y="'+xy[1]+'" width="'+MKSZ+'" height="'+MKSZ+'" fill="black"/>';
  });
  // Asymmetric orientation mark between header separator and column labels (y≈127–155).
  // Kept away from printer non-printable margin and corner detection quadrants.
  // Scanner uses this to auto-detect sheet direction (OM_Y=145 in processImage).
  s+='<rect x="298" y="135" width="20" height="20" fill="black"/>';
  s+='<polygon points="308,127 301,135 315,135" fill="black"/>';
  s+='<text x="'+W/2+'" y="68" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" font-weight="bold" fill="#111">BUBBLE ANSWER SHEET — 50 Questions</text>';
  s+='<text x="65" y="108" font-family="Arial,sans-serif" font-size="10.5" fill="#444">NAME:</text>';
  s+='<line x1="96" y1="110" x2="420" y2="110" stroke="#bbb" stroke-width=".8"/>';
  s+='<text x="430" y="108" font-family="Arial,sans-serif" font-size="10.5" fill="#444">DATE:</text>';
  s+='<line x1="458" y1="110" x2="576" y2="110" stroke="#bbb" stroke-width=".8"/>';
  s+='<text x="586" y="108" font-family="Arial,sans-serif" font-size="10.5" fill="#444">CLASS:</text>';
  s+='<line x1="618" y1="110" x2="750" y2="110" stroke="#bbb" stroke-width=".8"/>';
  s+='<line x1="60" y1="120" x2="'+(W-60)+'" y2="120" stroke="#d0d0d0" stroke-width="1"/>';
  s+='<line x1="'+W/2+'" y1="124" x2="'+W/2+'" y2="'+(H-46)+'" stroke="#e0e0e0" stroke-width=".7"/>';
  CH.forEach(function(ch,i){
    s+='<text x="'+LX[i]+'" y="'+LY+'" text-anchor="middle" font-family="Arial,sans-serif" font-size="10.5" font-weight="bold" fill="#666">'+ch+'</text>';
    s+='<text x="'+RX[i]+'" y="'+LY+'" text-anchor="middle" font-family="Arial,sans-serif" font-size="10.5" font-weight="bold" fill="#666">'+ch+'</text>';
  });
  for(var q=0;q<50;q++){
    var col=q<25?0:1, row=q%25, y=STARTY+row*ROWH;
    var nx=col?438:68, xs=col?RX:LX;
    s+='<text x="'+nx+'" y="'+(y+4)+'" text-anchor="end" font-family="Arial,sans-serif" font-size="10.5" fill="#555">'+(q+1)+'.</text>';
    xs.forEach(function(bx){ s+='<circle cx="'+bx+'" cy="'+y+'" r="'+BubR+'" fill="none" stroke="#444" stroke-width="1.1"/>'; });
  }
  s+='<text x="'+W/2+'" y="'+(H-22)+'" text-anchor="middle" font-family="Arial,sans-serif" font-size="9.5" fill="#bbb">Fill each bubble completely with a dark pen or pencil · Do not mark outside the circles</text>';
  s+='</svg>';
  return s;
}

function buildTemplate(){
  var svg=makeSVG();
  var uri='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  var img=new Image();
  img.src=uri;
  img.style.cssText='max-width:380px;width:100%';
  var p=document.getElementById('tplPrev');
  p.innerHTML=''; p.appendChild(img);
}

function printTpl(){
  var svg=makeSVG();
  var uri='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg)));
  var w=window.open('','_blank');
  if(!w){ alert('Pop-up blocked. Please allow pop-ups for this page and try again.'); return; }
  w.document.write('<!DOCTYPE html><html><head><title>Answer Sheet</title><style>@page{margin:0;size:letter portrait}body{margin:0}img{width:8.5in;height:11in;display:block}</style></head><body><img src="'+uri+'"><script>window.onload=function(){window.print();window.close()}<\/script></body></html>');
  w.document.close();
}

function dlSVG(){
  var a=document.createElement('a');
  a.href='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(makeSVG());
  a.download='answer-sheet.svg'; a.click();
}

// ── Scan: method ──
function setMethod(m){
  document.getElementById('mUpload').classList.toggle('on',m==='upload');
  document.getElementById('mCamera').classList.toggle('on',m==='camera');
  document.getElementById('uploadPanel').style.display=m==='upload'?'':'none';
  document.getElementById('cameraPanel').style.display=m==='camera'?'':'none';
}

// ── Scan: upload ──
function handleUpload(e){
  var file=e.target.files[0]; if(!file) return;
  exitCropMode(); exitPerspCropMode();
  document.getElementById('uploadName').textContent=file.name;
  var reader=new FileReader();
  reader.onload=function(ev){
    var img=new Image();
    img.onload=function(){
      var cc=document.getElementById('captCanvas');
      var scale=Math.min(1,1400/Math.max(img.width,img.height));
      cc.width=Math.round(img.width*scale);
      cc.height=Math.round(img.height*scale);
      cc.getContext('2d').drawImage(img,0,0,cc.width,cc.height);
      S.baseCanvas=applySessionRotation(cc);
      S.rawCanvas=S.baseCanvas;
      showPreScan();
    };
    img.src=ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Scan: camera ──
function startCam(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    setAlert('err','Camera API unavailable. This usually happens with file:// URLs. Use the Upload Photo method instead, or serve this file via a local web server.');
    return;
  }
  navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}})
  .then(function(stream){
    S.stream=stream;
    var v=document.getElementById('videoEl');
    v.srcObject=stream; v.style.display='none';
    startVideoPreview();
    document.getElementById('camHint').style.display='none';
    document.getElementById('btnStartCam').style.display='none';
    document.getElementById('btnCap').style.display='';
  })
  .catch(function(err){
    setAlert('err','Camera error: '+err.message+'. Try the Upload Photo method instead.');
  });
}

function captureFrame(){
  var v=document.getElementById('videoEl');
  if(!v.videoWidth){ setAlert('warn','Camera not ready yet. Wait a moment and try again.'); return; }
  var scale=Math.min(1,1400/Math.max(v.videoWidth,v.videoHeight));
  var cc=document.getElementById('captCanvas');
  cc.width=Math.round(v.videoWidth*scale);
  cc.height=Math.round(v.videoHeight*scale);
  cc.getContext('2d').drawImage(v,0,0,cc.width,cc.height);
  S.baseCanvas=applySessionRotation(cc);
  S.rawCanvas=S.baseCanvas;
  exitCropMode(); exitPerspCropMode();
  document.getElementById('videoEl').style.display='none';
  stopVideoPreview();
  document.getElementById('btnCap').style.display='none';
  showPreScan();
}

function retake(){
  S.detected=null; S.rawCanvas=null; S.baseCanvas=null;
  S.manualCorners=null; S.detectedCorners=null; S.lastRender=null; S.manualOri=0;
  adjDragging=-1;
  exitCropMode(); exitPerspCropMode();
  document.getElementById('adjControls').style.display='none';
  setAdjustButtonText('⊕ Adjust Corners');
  document.getElementById('preScanCard').style.display='none';
  var isCamera=document.getElementById('mCamera').classList.contains('on');
  document.getElementById('uploadPanel').style.display=isCamera?'none':'';
  document.getElementById('cameraPanel').style.display=isCamera?'':'none';
  if(S.stream){ startVideoPreview(); document.getElementById('btnCap').style.display=''; }
  else{ document.getElementById('imgFile').value=''; document.getElementById('uploadName').textContent=''; }
  updateSessionUI();
  document.getElementById('resultImgCard').style.display='none';
  document.getElementById('scanResult').style.display='none';
  document.getElementById('procOverlay').style.display='none';
  document.getElementById('scanAlert').innerHTML='';
}

function startVideoPreview(){
  var v=document.getElementById('videoEl'), pc=document.getElementById('livePreviewCanvas');
  if(!v||!pc) return;
  pc.style.display='';
  v.style.display='none';
  if(previewReq) cancelAnimationFrame(previewReq);
  function draw(){
    if(!S.stream||!v.videoWidth){ previewReq=requestAnimationFrame(draw); return; }
    var rot=S.sessionRotation%360, swap=rot===90||rot===270;
    var outW=swap?v.videoHeight:v.videoWidth, outH=swap?v.videoWidth:v.videoHeight;
    if(pc.width!==outW||pc.height!==outH){ pc.width=outW; pc.height=outH; }
    var ctx=pc.getContext('2d');
    ctx.save();
    ctx.clearRect(0,0,pc.width,pc.height);
    ctx.translate(pc.width/2,pc.height/2);
    ctx.rotate(rot*Math.PI/180);
    ctx.drawImage(v,-v.videoWidth/2,-v.videoHeight/2);
    ctx.restore();
    previewReq=requestAnimationFrame(draw);
  }
  draw();
}

function stopVideoPreview(){
  if(previewReq){ cancelAnimationFrame(previewReq); previewReq=0; }
  var pc=document.getElementById('livePreviewCanvas');
  if(pc) pc.style.display='none';
}

function setScanCanvasOrientationClass(canvas){
  if(!canvas) return;
  canvas.classList.toggle('portrait',canvas.height>canvas.width);
}

function setAdjustButtonText(text){
  document.querySelectorAll('.btnAdjust').forEach(function(b){ b.textContent=text; });
}

function setSaveButtons(disabled,text){
  document.querySelectorAll('.btnSave').forEach(function(b){
    b.disabled=disabled;
    b.textContent=text;
  });
}

// ── Pre-scan controls ──
function showPreScan(){
  document.getElementById('uploadPanel').style.display='none';
  document.getElementById('cameraPanel').style.display='none';
  var pc=document.getElementById('preScanCanvas');
  pc.width=S.rawCanvas.width;
  pc.height=S.rawCanvas.height;
  setScanCanvasOrientationClass(pc);
  pc.getContext('2d').drawImage(S.rawCanvas,0,0);
  document.getElementById('preScanCard').style.display='';
}

// Shared canvas rotation helper — used by rotatePending, rotateResult, and applySessionTransforms.
function rotCanv(src,deg){
  deg=((deg%360)+360)%360;
  var tmp=document.createElement('canvas');
  if(deg===90||deg===270){tmp.width=src.height;tmp.height=src.width;}
  else{tmp.width=src.width;tmp.height=src.height;}
  var ctx=tmp.getContext('2d');
  ctx.translate(tmp.width/2,tmp.height/2);
  ctx.rotate(deg*Math.PI/180);
  ctx.drawImage(src,-src.width/2,-src.height/2);
  return tmp;
}

// Apply session rotation to a source canvas → always returns a NEW canvas (the "base").
// Never returns the source reference — captCanvas is reused on every capture, so holding
// a reference to it would corrupt baseCanvas when the next frame is captured.
function applySessionRotation(src){
  if(S.sessionRotation) return rotCanv(src,S.sessionRotation);
  var tmp=document.createElement('canvas');
  tmp.width=src.width; tmp.height=src.height;
  tmp.getContext('2d').drawImage(src,0,0);
  return tmp;
}

function rotatePending(deg){
  cropState.dragging=false; cropState.w=0; cropState.h=0;
  perspState.dragging=-1;
  S.sessionRotation=((S.sessionRotation+deg)%360+360)%360;
  // Rotate the BASE (full image) so the new base is the correctly oriented full image.
  S.baseCanvas=rotCanv(S.baseCanvas||S.rawCanvas,deg);
  S.rawCanvas=S.baseCanvas;
  updateVideoRotation();
  updateSessionUI();
  showPreScan();
}

function flipPending(axis){
  cropState.dragging=false; cropState.w=0; cropState.h=0;
  perspState.dragging=-1;
  var src=S.baseCanvas||S.rawCanvas;
  var tmp=document.createElement('canvas');
  tmp.width=src.width;tmp.height=src.height;
  var ctx=tmp.getContext('2d');
  if(axis==='h'){ctx.transform(-1,0,0,1,src.width,0);}
  else{ctx.transform(1,0,0,-1,0,src.height);}
  ctx.drawImage(src,0,0);
  S.baseCanvas=tmp;
  S.rawCanvas=tmp;
  showPreScan();
}

function scanPending(){
  if(!S.rawCanvas) return;
  document.getElementById('preScanCard').style.display='none';
  var cc=S.rawCanvas;
  var id=cc.getContext('2d').getImageData(0,0,cc.width,cc.height);
  processImage(id,cc.width,cc.height,cc);
}

// ── Image processing ──
function gpx(d,i){ return 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; }

function findMarker(data,W,x0,y0,x1,y1){
  var mn=255,mx=0;
  for(var y=y0;y<y1;y++) for(var x=x0;x<x1;x++){
    var g=gpx(data,(y*W+x)*4); if(g<mn) mn=g; if(g>mx) mx=g;
  }
  // Require high contrast: the quadrant must contain both a very dark region (the marker)
  // and a very bright region (white paper). A uniformly dark background (wood table, shadow)
  // or uniformly bright region both fail this test and are immediately rejected.
  if(mx-mn<150) return null;
  var thr=Math.min(mn+35,110), sx=0,sy=0,n=0;
  var bx0=x1,bx1=x0,by0=y1,by1=y0; // bounding box of dark cluster
  for(var y=y0;y<y1;y++) for(var x=x0;x<x1;x++){
    if(gpx(data,(y*W+x)*4)<=thr){
      sx+=x;sy+=y;n++;
      if(x<bx0)bx0=x; if(x>bx1)bx1=x;
      if(y<by0)by0=y; if(y>by1)by1=y;
    }
  }
  if(n<20) return null;
  // Reject clusters whose bounding box exceeds 40% of the quadrant in either dimension.
  // A genuine 40×40 px corner marker maps to a small cluster; a dark table/shadow
  // background would span most of the quadrant and is correctly rejected here.
  if((bx1-bx0)>(x1-x0)*0.40||(by1-by0)>(y1-y0)*0.40) return null;
  return [sx/n,sy/n];
}

function findMarkerBlob(data,W,x0,y0,x1,y1){
  var mn=255,mx=0;
  for(var y=y0;y<y1;y++) for(var x=x0;x<x1;x++){
    var g=gpx(data,(y*W+x)*4); if(g<mn) mn=g; if(g>mx) mx=g;
  }
  // Connected components keep dark table edges and shadow bands from being
  // averaged together with the real square marker.
  if(mx-mn<90||mn>125) return null;
  var thr=Math.min(mn+45,120), w=x1-x0, h=y1-y0;
  var seen=new Uint8Array(w*h), best=null, dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  for(var yy=y0;yy<y1;yy++) for(var xx=x0;xx<x1;xx++){
    var si=(yy-y0)*w+(xx-x0);
    if(seen[si]||gpx(data,(yy*W+xx)*4)>thr) continue;
    var stack=[[xx,yy]], sx=0,sy=0,n=0,bx0=xx,bx1=xx,by0=yy,by1=yy;
    seen[si]=1;
    while(stack.length){
      var p=stack.pop(), px=p[0], py=p[1];
      sx+=px; sy+=py; n++;
      if(px<bx0)bx0=px; if(px>bx1)bx1=px;
      if(py<by0)by0=py; if(py>by1)by1=py;
      for(var di=0;di<dirs.length;di++){
        var nx=px+dirs[di][0], ny=py+dirs[di][1];
        if(nx<x0||nx>=x1||ny<y0||ny>=y1) continue;
        var ni=(ny-y0)*w+(nx-x0);
        if(seen[ni]||gpx(data,(ny*W+nx)*4)>thr) continue;
        seen[ni]=1; stack.push([nx,ny]);
      }
    }
    var bw=bx1-bx0+1,bh=by1-by0+1,area=bw*bh,fill=n/area,aspect=bw/bh;
    if(n<25||bw>w*0.22||bh>h*0.22||bw<w*0.025||bh<h*0.025) continue;
    if(aspect<0.55||aspect>1.8||fill<0.45) continue;
    var score=n*fill/(1+Math.abs(Math.log(aspect)));
    if(!best||score>best.score) best={score:score,x:sx/n,y:sy/n};
  }
  return best?[best.x,best.y]:null;
}

function detectCorners(data,W,H){
  var qx=Math.floor(W*0.32),qy=Math.floor(H*0.32);
  var TL=findMarkerBlob(data,W,0,0,qx,qy);
  var TR=findMarkerBlob(data,W,W-qx,0,W,qy);
  var BL=findMarkerBlob(data,W,0,H-qy,qx,H);
  var BR=findMarkerBlob(data,W,W-qx,H-qy,W,H);
  if(!TL||!TR||!BL||!BR) return null;
  if(TL[0]>=TR[0]||BL[0]>=BR[0]||TL[1]>=BL[1]||TR[1]>=BR[1]) return null;
  var cw=(TR[0]-TL[0]+BR[0]-BL[0])/2, ch=(BL[1]-TL[1]+BR[1]-TR[1])/2;
  if(cw/ch<0.3||cw/ch>2.0) return null;
  return [TL,TR,BL,BR];
}

function gauss(A,b){
  var n=A.length, M=[];
  for(var i=0;i<n;i++){ M[i]=A[i].slice(); M[i].push(b[i]); }
  for(var c=0;c<n;c++){
    var mx=c;
    for(var r=c+1;r<n;r++) if(Math.abs(M[r][c])>Math.abs(M[mx][c])) mx=r;
    var tmp=M[c]; M[c]=M[mx]; M[mx]=tmp;
    if(Math.abs(M[c][c])<1e-12) return null;
    for(var r=c+1;r<n;r++){
      var f=M[r][c]/M[c][c];
      for(var j=c;j<=n;j++) M[r][j]-=f*M[c][j];
    }
  }
  var x=new Array(n).fill(0);
  for(var i=n-1;i>=0;i--){
    x[i]=M[i][n];
    for(var j=i+1;j<n;j++) x[i]-=M[i][j]*x[j];
    x[i]/=M[i][i];
  }
  return x;
}

function calcH(src,dst){
  var A=[],b=[];
  for(var i=0;i<4;i++){
    var x=src[i][0],y=src[i][1],xp=dst[i][0],yp=dst[i][1];
    A.push([x,y,1,0,0,0,-x*xp,-y*xp]); b.push(xp);
    A.push([0,0,0,x,y,1,-x*yp,-y*yp]); b.push(yp);
  }
  var h=gauss(A,b);
  return h?[[h[0],h[1],h[2]],[h[3],h[4],h[5]],[h[6],h[7],1]]:null;
}

function mapPt(H,x,y){
  var w=H[2][0]*x+H[2][1]*y+H[2][2];
  return [(H[0][0]*x+H[0][1]*y+H[0][2])/w,(H[1][0]*x+H[1][1]*y+H[1][2])/w];
}

function darkAt(data,W,H,cx,cy,r){
  var dk=0,n=0,r2=r*r;
  for(var dy=-r;dy<=r;dy++) for(var dx=-r;dx<=r;dx++){
    if(dx*dx+dy*dy>r2) continue;
    var px=Math.round(cx+dx),py=Math.round(cy+dy);
    if(px<0||px>=W||py<0||py>=H) continue;
    dk+=(255-gpx(data,(py*W+px)*4))/255; n++;
  }
  return n?dk/n:0;
}

// Average darkness in the annular band between r0 and r1 (inclusive).
function darkAtAnnulus(data,W,H,cx,cy,r0,r1){
  var dk=0,n=0,r0s=r0*r0,r1s=r1*r1,rc=Math.ceil(r1);
  for(var dy=-rc;dy<=rc;dy++) for(var dx=-rc;dx<=rc;dx++){
    var d2=dx*dx+dy*dy;
    if(d2<r0s||d2>r1s) continue;
    var px=Math.round(cx+dx),py=Math.round(cy+dy);
    if(px<0||px>=W||py<0||py>=H) continue;
    dk+=(255-gpx(data,(py*W+px)*4))/255; n++;
  }
  return n?dk/n:0;
}

function fillAt(data,W,H,cx,cy,r){
  var core=darkAt(data,W,H,cx,cy,Math.max(2,r*0.52));
  var bg=darkAtAnnulus(data,W,H,cx,cy,r*1.45,r*2.15);
  return Math.max(0,core-bg);
}

// Search a small neighbourhood around (cx,cy) for the printed bubble ring centre.
// Score = ring darkness − 0.4 × interior darkness (peaks at the empty circle outline).
// Only reliable on unfilled bubbles; caller filters filled ones before calling.
function findRingCenter(data,W,H,cx,cy,r,searchR){
  var best=-1,bx=cx,by=cy;
  var step=Math.max(1,Math.round(r*0.3));
  for(var dy=-searchR;dy<=searchR;dy+=step) for(var dx=-searchR;dx<=searchR;dx+=step){
    var x=cx+dx,y=cy+dy;
    if(x<r||x>=W-r||y<r||y>=H-r) continue;
    var ring=darkAtAnnulus(data,W,H,x,y,r*0.65,r*1.3);
    var fill=darkAt(data,W,H,x,y,r*0.5);
    var sc=ring-fill*0.4;
    if(sc>best){best=sc;bx=x;by=y;}
  }
  return best>0.04?[bx,by]:null;
}

// Overdetermined DLT homography: least-squares fit of N≥4 point correspondences.
// Builds 8×8 normal equations (A^T A)h = A^T b from 2N rows, then solves via gauss().
function calcHOverdet(srcPts,dstPts){
  var N=srcPts.length;
  var AtA=[],Atb=new Array(8).fill(0);
  for(var i=0;i<8;i++) AtA.push(new Array(8).fill(0));
  for(var i=0;i<N;i++){
    var x=srcPts[i][0],y=srcPts[i][1],xp=dstPts[i][0],yp=dstPts[i][1];
    var rows=[[x,y,1,0,0,0,-x*xp,-y*xp],[0,0,0,x,y,1,-x*yp,-y*yp]];
    var bs=[xp,yp];
    for(var ri=0;ri<2;ri++){
      for(var j=0;j<8;j++){
        Atb[j]+=rows[ri][j]*bs[ri];
        for(var k=0;k<8;k++) AtA[j][k]+=rows[ri][j]*rows[ri][k];
      }
    }
  }
  var h=gauss(AtA,Atb);
  return h?[[h[0],h[1],h[2]],[h[3],h[4],h[5]],[h[6],h[7],1]]:null;
}

// Refine an initial homography by using the printed bubble ring outlines as fiducials.
// For each unfilled bubble, a local ring-centre search finds the true printed circle centre
// in camera space. These 150–230 point pairs yield a much more accurate overdetermined H.
function refineHmat(initH,data,W,H,sampR){
  var srcPts=[],dstPts=[],searchR=Math.round(sampR*1.5);
  for(var q=0;q<50;q++) for(var c=0;c<5;c++){
    var tmpl=bxy(q,c),est=mapPt(initH,tmpl[0],tmpl[1]);
    if(est[0]<sampR||est[0]>=W-sampR||est[1]<sampR||est[1]>=H-sampR) continue;
    if(darkAt(data,W,H,est[0],est[1],sampR)>0.35) continue; // skip filled bubbles
    var ref=findRingCenter(data,W,H,est[0],est[1],sampR,searchR);
    if(ref){srcPts.push(tmpl);dstPts.push(ref);}
  }
  if(srcPts.length<12) return initH; // too few clear rings — keep original
  return calcHOverdet(srcPts,dstPts)||initH;
}

function uprightRotationForOrientation(oi){
  return [0,180,270,90][oi]||0;
}

function processImage(imgData,W,imgH,srcCanvas,allowAutoUpright){
  if(allowAutoUpright===undefined) allowAutoUpright=true;
  var data=imgData.data;
  document.getElementById('procOverlay').style.display='none';
  // Reset manual adjustment state for each new scan
  S.manualCorners=null; S.manualOri=0;
  var corners=detectCorners(data,W,imgH);
  if(!corners){
    // Show image and enter manual corner adjustment rather than dead-end error
    var oc=document.getElementById('overlayCanvas');
    oc.width=W; oc.height=imgH;
    setScanCanvasOrientationClass(oc);
    oc.getContext('2d').drawImage(srcCanvas,0,0);
    document.getElementById('resultImgCard').style.display='';
    S.lastRender={srcCanvas:srcCanvas,W:W,H:imgH,corners:null,Hmat:null};
    S.detectedCorners=null;
    S.manualCorners=[[W*0.05,imgH*0.05],[W*0.95,imgH*0.05],[W*0.05,imgH*0.95],[W*0.95,imgH*0.95]];
    enterAdjustMode();
    setAlert('warn','Could not auto-detect corner markers. Drag the amber handles to the four black corner squares on the upright sheet, then click Re-grade.');
    return;
  }

  var camW=Math.sqrt(Math.pow(corners[1][0]-corners[0][0],2)+Math.pow(corners[1][1]-corners[0][1],2));
  var sampR=Math.max(5,Math.round(BubR*(camW/(TC.TR[0]-TC.TL[0]))*0.88));

  // Try 4 rotational orientations; pick whichever places the orientation mark on a dark region.
  // Orientation mark centre is at template (308, 145) — between header separator and column labels.
  var ORIENTS=[
    [TC.TL,TC.TR,TC.BL,TC.BR],  // 0°
    [TC.BR,TC.BL,TC.TR,TC.TL],  // 180°
    [TC.BL,TC.TL,TC.BR,TC.TR],  // 90° CW
    [TC.TR,TC.BR,TC.TL,TC.BL]   // 90° CCW
  ];
  var OM_X=308, OM_Y=145; // matches orientation mark moved to y=127–155 in makeSVG
  var Hmat=null, bestH=null, bestOmDark=-1, selectedOi=0, bestOi=0;
  for(var oi=0;oi<4;oi++){
    var tryH=calcH(ORIENTS[oi],corners);
    if(!tryH) continue;
    var omCam=mapPt(tryH,OM_X,OM_Y);
    if(omCam[0]<0||omCam[0]>=W||omCam[1]<0||omCam[1]>=imgH) continue;
    var omDark=darkAt(data,W,imgH,omCam[0],omCam[1],sampR);
    if(omDark>0.3){Hmat=tryH;selectedOi=oi;break;} // clear winner — orientation mark is dark
    if(omDark>bestOmDark){bestOmDark=omDark;bestH=tryH;bestOi=oi;} // track best candidate
  }
  // If no orientation scored >0.3, use the one whose mark was least dark rather than
  // blindly falling back to ORIENTS[0], which would be completely wrong for rotated sheets.
  if(!Hmat){ Hmat=bestH||calcH(ORIENTS[0],corners); selectedOi=bestH?bestOi:0; }
  if(!Hmat){ setAlert('err','Perspective correction failed. Try repositioning the sheet and scanning again.'); return; }
  var uprRot=uprightRotationForOrientation(selectedOi);
  if(allowAutoUpright&&uprRot){
    S.sessionRotation=((S.sessionRotation+uprRot)%360+360)%360;
    S.baseCanvas=rotCanv(srcCanvas,uprRot);
    S.rawCanvas=S.baseCanvas;
    updateSessionUI();
    var uprightData=S.rawCanvas.getContext('2d').getImageData(0,0,S.rawCanvas.width,S.rawCanvas.height);
    processImage(uprightData,S.rawCanvas.width,S.rawCanvas.height,S.rawCanvas,false);
    return;
  }
  // Two-pass refinement: first pass corrects gross corner errors; second pass converges
  // on the refined positions found in pass one, removing residual sub-pixel drift.
  Hmat=refineHmat(Hmat,data,W,imgH,sampR);
  Hmat=refineHmat(Hmat,data,W,imgH,sampR);

  var raw=[],detected=[];
  for(var q=0;q<50;q++){
    var vals=[];
    for(var c=0;c<5;c++){
      var pt=bxy(q,c),cam=mapPt(Hmat,pt[0],pt[1]);
      vals.push(fillAt(data,W,imgH,cam[0],cam[1],sampR));
    }
    raw.push(vals);
    var mx=vals[0],mxI=0,sorted=vals.slice().sort(function(a,b){return b-a;});
    for(var c=1;c<5;c++) if(vals[c]>mx){mx=vals[c];mxI=c;}
    var second=sorted[1];
    detected.push(mx<0.08?null:mx-second<0.04&&second>0.06?'?':CH[mxI]);
  }

  S.detected=detected;
  renderOverlay(srcCanvas,W,imgH,corners,Hmat,sampR,raw,detected);
  showScore(detected);
}

function renderOverlay(srcCanvas,W,H,corners,Hmat,sampR,raw,detected){
  S.lastRender={srcCanvas:srcCanvas,W:W,H:H,corners:corners,Hmat:Hmat,sampR:sampR,raw:raw,detected:detected};
  S.detectedCorners=corners;
  document.getElementById('videoEl').style.display='none';
  stopVideoPreview();
  var oc=document.getElementById('overlayCanvas');
  oc.width=W; oc.height=H;
  setScanCanvasOrientationClass(oc);
  var ctx=oc.getContext('2d');
  ctx.drawImage(srcCanvas,0,0);

  var camW=Math.sqrt(Math.pow(corners[1][0]-corners[0][0],2)+Math.pow(corners[1][1]-corners[0][1],2));
  var sc=camW/(TC.TR[0]-TC.TL[0]), lw=Math.max(1.5,sc*2);

  // Corner crosshairs
  ctx.strokeStyle='#22c55e'; ctx.lineWidth=lw;
  corners.forEach(function(pt){
    var x=pt[0],y=pt[1],r=14*sc;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x-r*1.5,y); ctx.lineTo(x+r*1.5,y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x,y-r*1.5); ctx.lineTo(x,y+r*1.5); ctx.stroke();
  });

  // Bubble circles
  for(var q=0;q<50;q++){
    for(var c=0;c<5;c++){
      var pt=bxy(q,c), cam=mapPt(Hmat,pt[0],pt[1]);
      var sel=detected[q]===CH[c], key=S.key[q];
      ctx.beginPath(); ctx.arc(cam[0],cam[1],sampR,0,Math.PI*2);
      if(sel){
        var col=!key?'#f59e0b':key===CH[c]?'#22c55e':'#ef4444';
        ctx.strokeStyle=col; ctx.lineWidth=Math.max(1.5,sc*2.5); ctx.stroke();
        ctx.globalAlpha=0.28; ctx.fillStyle=col; ctx.fill(); ctx.globalAlpha=1;
      } else {
        ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1; ctx.stroke();
      }
    }
  }
  document.getElementById('resultImgCard').style.display='';
}

// ── Scoring ──
function scoreOf(det){
  var keyed=0;
  for(var i=0;i<50;i++) if(S.key[i]) keyed++;
  if(!keyed) return{correct:0,total:50,pct:0,noKey:true};
  var correct=0,total=0;
  for(var q=0;q<50;q++){
    if(!S.key[q]) continue; total++;
    if(det[q]===S.key[q]) correct++;
  }
  return{correct:correct,total:total,pct:Math.round(correct/total*100),noKey:false};
}

function showScore(det){
  var r=scoreOf(det);
  var pass=parseInt(document.getElementById('passPct').value)||70;
  var passed=r.pct>=pass;
  var sb=document.getElementById('scoreBig');
  if(r.noKey){
    sb.innerHTML='<div class="scnum">—<sub>/50</sub></div><div class="scpct">No answer key set</div><span class="sctag tnone">SET KEY FIRST</span>';
  } else {
    sb.innerHTML='<div class="scnum">'+r.correct+'<sub>/'+r.total+'</sub></div><div class="scpct">'+r.pct+'%</div><span class="sctag '+(passed?'tpass':'tfail')+'">'+(passed?'✓ PASS':'✗ FAIL')+'</span>';
  }
  var ag=document.getElementById('ansGrid');
  ag.innerHTML='';
  for(var q=0;q<50;q++){
    var a=det[q],k=S.key[q];
    var cls=''; if(a===null) cls='blk'; else if(a==='?') cls='mul'; else if(k) cls=a===k?'cor':'wrg';
    var div=document.createElement('div'); div.className='ac '+cls;
    div.title='Q'+(q+1)+(k?' · Key:'+k:'');
    div.innerHTML='<div class="aq">'+(q+1)+'</div><div class="aa">'+(a===null?'—':a)+'</div>';
    ag.appendChild(div);
  }
  document.getElementById('scanResult').style.display='';
  setAlert('ok','Scan complete — review the answers, then save or rescan.');
  setSaveButtons(false,'✓ Save & Next Student');
}

function saveStudent(){
  if(!S.detected) return;
  var name=document.getElementById('stuName').value.trim()||'Student '+(S.students.length+1);
  var r=scoreOf(S.detected);
  S.students.push({name:name,answers:S.detected.slice(),correct:r.correct,total:r.total,pct:r.pct});
  saveData();
  updateHeader();
  document.getElementById('stuName').value='';
  document.getElementById('imgFile').value='';
  document.getElementById('uploadName').textContent='';
  S.detected=null;
  S.rawCanvas=null;
  // Restore input panels so the next photo can be loaded, while keeping result visible
  var isCamera=document.getElementById('mCamera').classList.contains('on');
  document.getElementById('uploadPanel').style.display=isCamera?'none':'';
  document.getElementById('cameraPanel').style.display=isCamera?'':'none';
  if(S.stream){ startVideoPreview(); document.getElementById('btnCap').style.display=''; }
  setSaveButtons(true,'✓ Saved!');
  setAlert('ok','Saved: '+name+' — '+r.correct+'/'+r.total+' ('+r.pct+'%). Load next student photo above.');
}

function updateHeader(){
  document.getElementById('hGraded').textContent=S.students.length;
  document.getElementById('hClass').textContent=document.getElementById('className').value||'—';
  if(S.students.length){
    var avg=Math.round(S.students.reduce(function(a,s){return a+s.pct;},0)/S.students.length);
    document.getElementById('hAvg').textContent=avg+'%';
  } else {
    document.getElementById('hAvg').textContent='—';
  }
}

// ── Corner adjustment ──
function toggleAdjustMode(){
  if(document.getElementById('adjControls').style.display==='none') enterAdjustMode();
  else exitAdjustMode(false);
}

function enterAdjustMode(){
  if(!S.lastRender) return;
  S.manualOri=0;
  if(!S.manualCorners){
    var lr=S.lastRender;
    S.manualCorners=S.detectedCorners
      ?S.detectedCorners.map(function(c){return[c[0],c[1]];})
      :[[lr.W*0.05,lr.H*0.05],[lr.W*0.95,lr.H*0.05],[lr.W*0.05,lr.H*0.95],[lr.W*0.95,lr.H*0.95]];
  }
  document.getElementById('adjControls').style.display='';
  setAdjustButtonText('✕ Cancel');
  document.getElementById('overlayCanvas').style.cursor='crosshair';
  redrawHandles();
}

function exitAdjustMode(skipRedraw){
  adjDragging=-1;
  document.getElementById('adjControls').style.display='none';
  setAdjustButtonText('⊕ Adjust Corners');
  document.getElementById('overlayCanvas').style.cursor='';
  if(!skipRedraw){
    var lr=S.lastRender;
    if(lr&&lr.Hmat) renderOverlay(lr.srcCanvas,lr.W,lr.H,lr.corners,lr.Hmat,lr.sampR,lr.raw,lr.detected);
    else if(lr&&lr.srcCanvas){
      var oc=document.getElementById('overlayCanvas');
      oc.width=lr.W; oc.height=lr.H;
      setScanCanvasOrientationClass(oc);
      oc.getContext('2d').drawImage(lr.srcCanvas,0,0);
    }
  }
}

// Sort 4 corner points into [photo-TL, photo-TR, photo-BL, photo-BR] by visual position.
// This lets the user place handles on any corner in any order without worrying about assignment.
function sortCornersVisually(corners){
  var s=corners.slice().sort(function(a,b){return a[1]-b[1];});
  var top=s.slice(0,2).sort(function(a,b){return a[0]-b[0];});
  var bot=s.slice(2,4).sort(function(a,b){return a[0]-b[0];});
  return[top[0],top[1],bot[0],bot[1]]; // [photoTL, photoTR, photoBL, photoBR]
}

// Maps photo-space corners [photoTL,photoTR,photoBL,photoBR] to template corners
// for each of the 4 possible sheet orientations.
// Index 0: sheet title faces TOP of photo
// Index 1: sheet title faces BOTTOM of photo
// Index 2: sheet title faces RIGHT of photo
// Index 3: sheet title faces LEFT of photo
var ADJ_ORIENTS=[
  [TC.TL,TC.TR,TC.BL,TC.BR],
  [TC.BR,TC.BL,TC.TR,TC.TL],
  [TC.BL,TC.TL,TC.BR,TC.TR],
  [TC.TR,TC.BR,TC.TL,TC.BL]
];

function redrawHandles(){
  if(!S.lastRender||!S.manualCorners) return;
  var lr=S.lastRender;
  var oc=document.getElementById('overlayCanvas');
  oc.width=lr.W; oc.height=lr.H;
  setScanCanvasOrientationClass(oc);
  var ctx=oc.getContext('2d');
  ctx.drawImage(lr.srcCanvas,0,0);

  // Live bubble grid preview — auto-sort corners then apply selected orientation
  var sc_=sortCornersVisually(S.manualCorners);
  var pH=calcH(ADJ_ORIENTS[S.manualOri],sc_);
  if(pH){
    var dx0=sc_[1][0]-sc_[0][0],dy0=sc_[1][1]-sc_[0][1];
    var camW0=Math.sqrt(dx0*dx0+dy0*dy0);
    var scl=camW0/(TC.TR[0]-TC.TL[0]);
    var pr=Math.max(4,scl*BubR*0.9);
    ctx.strokeStyle='rgba(59,130,246,0.85)';
    ctx.lineWidth=Math.max(1.5,scl*1.5);
    for(var q=0;q<50;q++){
      for(var c=0;c<5;c++){
        var bpt=bxy(q,c),bcam=mapPt(pH,bpt[0],bpt[1]);
        if(bcam[0]>0&&bcam[0]<lr.W&&bcam[1]>0&&bcam[1]<lr.H){
          ctx.beginPath(); ctx.arc(bcam[0],bcam[1],pr,0,Math.PI*2); ctx.stroke();
        }
      }
    }
    // Show orientation mark position as a small filled dot for reference
    var omcam=mapPt(pH,308,145);
    if(omcam[0]>0&&omcam[0]<lr.W&&omcam[1]>0&&omcam[1]<lr.H){
      ctx.fillStyle='rgba(255,200,0,0.7)';
      ctx.beginPath(); ctx.arc(omcam[0],omcam[1],pr*1.4,0,Math.PI*2); ctx.fill();
    }
  }

  // Draw corner handles — no TL/TR/BL/BR labels, user just places on 4 squares in any order
  var dx=S.manualCorners[1][0]-S.manualCorners[0][0],dy=S.manualCorners[1][1]-S.manualCorners[0][1];
  var camW=Math.sqrt(dx*dx+dy*dy);
  var sc=Math.max(0.5,camW/(TC.TR[0]-TC.TL[0]));
  var hr=Math.max(13,sc*13), lw=Math.max(1.5,sc*2);
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='bold '+Math.round(hr*0.65)+'px monospace';
  S.manualCorners.forEach(function(pt){
    ctx.strokeStyle='#f59e0b'; ctx.lineWidth=lw;
    ctx.beginPath(); ctx.arc(pt[0],pt[1],hr,0,Math.PI*2); ctx.stroke();
    ctx.globalAlpha=0.25; ctx.fillStyle='#f59e0b'; ctx.fill(); ctx.globalAlpha=1;
    ctx.beginPath(); ctx.moveTo(pt[0]-hr*1.5,pt[1]); ctx.lineTo(pt[0]+hr*1.5,pt[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pt[0],pt[1]-hr*1.5); ctx.lineTo(pt[0],pt[1]+hr*1.5); ctx.stroke();
  });
}

function setManualOri(idx){
  S.manualOri=0;
  redrawHandles(); // update live preview immediately
}

function reGradeManual(){
  if(!S.manualCorners||!S.lastRender) return;
  var lr=S.lastRender;
  // Auto-sort corners by visual photo position so user doesn't need to place them in order
  var corners=sortCornersVisually(S.manualCorners);
  S.manualOri=0;
  var Hmat=calcH(ADJ_ORIENTS[0],corners);
  if(!Hmat){setAlert('err','Perspective correction failed. Adjust the corner positions and try again.');return;}
  var dx=corners[1][0]-corners[0][0],dy=corners[1][1]-corners[0][1];
  var camW=Math.sqrt(dx*dx+dy*dy);
  var sampR=Math.max(5,Math.round(BubR*(camW/(TC.TR[0]-TC.TL[0]))*0.88));
  var imgData=lr.srcCanvas.getContext('2d').getImageData(0,0,lr.W,lr.H);
  var data=imgData.data;
  Hmat=refineHmat(Hmat,data,lr.W,lr.H,sampR);
  Hmat=refineHmat(Hmat,data,lr.W,lr.H,sampR);
  var raw=[],detected=[];
  for(var q=0;q<50;q++){
    var vals=[];
    for(var c=0;c<5;c++){
      var pt=bxy(q,c),cam=mapPt(Hmat,pt[0],pt[1]);
      vals.push(fillAt(data,lr.W,lr.H,cam[0],cam[1],sampR));
    }
    raw.push(vals);
    var mx=vals[0],mxI=0,sorted=vals.slice().sort(function(a,b){return b-a;});
    for(var c=1;c<5;c++) if(vals[c]>mx){mx=vals[c];mxI=c;}
    var second=sorted[1];
    detected.push(mx<0.08?null:mx-second<0.04&&second>0.06?'?':CH[mxI]);
  }
  S.detected=detected;
  S.detectedCorners=corners.map(function(c){return[c[0],c[1]];});
  S.manualCorners=null;
  exitAdjustMode(true);
  renderOverlay(lr.srcCanvas,lr.W,lr.H,corners,Hmat,sampR,raw,detected);
  showScore(detected);
}

// ── Removed crop tools: keep these as inert compatibility hooks for old inline handlers/bookmarks. ──
function exitCropMode(){
  cropState.active=false; cropState.dragging=false; cropState.w=0;
  var pc=document.getElementById('preScanCanvas');
  if(pc) pc.style.cursor='';
}

function toggleCropMode(){
  exitCropMode();
}

function drawCropUI(){
  if(S.rawCanvas) showPreScan();
}

function applyCrop(){
  exitCropMode();
}

function resetPreview(){
  if(!S.sessionRotation) return;
  cropState.dragging=false; cropState.w=0; cropState.h=0;
  S.sessionRotation=0;
  updateVideoRotation();
  updateSessionUI();
}

function clearSessionRotation(){ resetPreview(); }

function updateVideoRotation(){
  var v=document.getElementById('videoEl'); if(!v) return;
  v.style.transform='';
}

function updateSessionUI(){
  var hasRot=S.sessionRotation!==0;
  var div=document.getElementById('sessionInfo'); if(!div) return;
  div.style.display=hasRot?'':'none';
  var rb=document.getElementById('sessionRotBadge');
  var cr=document.getElementById('btnClearRot');
  if(rb){ rb.style.display=hasRot?'':'none'; if(hasRot) rb.textContent='Preview rotated '+S.sessionRotation+'°'; }
  if(cr) cr.style.display=hasRot?'':'none';
}

// ── Removed perspective crop tools ──
function exitPerspCropMode(){
  perspState.active=false; perspState.handles=null; perspState.dragging=-1;
  var pc=document.getElementById('preScanCanvas');
  if(pc) pc.style.cursor='';
}

function togglePerspCropMode(){
  exitPerspCropMode();
}

function drawPerspCrop(){
  var pc=document.getElementById('preScanCanvas');
  var ctx=pc.getContext('2d');
  ctx.drawImage(S.rawCanvas,0,0,pc.width,pc.height);
  var h=perspState.handles; if(!h||h.length!==4) return;
  var s=sortCornersVisually(h); // [TL,TR,BL,BR]
  // Darken area outside the quad
  ctx.fillStyle='rgba(0,0,0,0.52)';
  ctx.beginPath();
  ctx.rect(0,0,pc.width,pc.height);
  ctx.moveTo(s[0][0],s[0][1]);
  ctx.lineTo(s[1][0],s[1][1]);
  ctx.lineTo(s[3][0],s[3][1]);
  ctx.lineTo(s[2][0],s[2][1]);
  ctx.closePath();
  ctx.fill('evenodd');
  // Quad border
  var lw=Math.max(2,pc.width/350);
  ctx.strokeStyle='#f59e0b'; ctx.lineWidth=lw; ctx.setLineDash([8,4]);
  ctx.beginPath();
  ctx.moveTo(s[0][0],s[0][1]); ctx.lineTo(s[1][0],s[1][1]);
  ctx.lineTo(s[3][0],s[3][1]); ctx.lineTo(s[2][0],s[2][1]);
  ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  // Handles
  var hr=Math.max(14,pc.width/60);
  h.forEach(function(pt){
    ctx.beginPath(); ctx.arc(pt[0],pt[1],hr,0,Math.PI*2);
    ctx.fillStyle='rgba(245,158,11,0.3)'; ctx.fill();
    ctx.strokeStyle='#f59e0b'; ctx.lineWidth=lw; ctx.stroke();
  });
}

function applyPerspectiveCrop(){
  exitPerspCropMode();
}

// Rotate the result image and re-run auto-detection. Also saves as the new session
// rotation default so the next capture/upload arrives pre-rotated correctly.
function rotateResult(deg){
  if(!S.rawCanvas) return;
  S.sessionRotation=((S.sessionRotation+deg)%360+360)%360;
  S.baseCanvas=rotCanv(S.baseCanvas||S.rawCanvas,deg);
  S.rawCanvas=S.baseCanvas;
  updateVideoRotation();
  updateSessionUI();
  // Reset adjust UI before re-scanning so processImage starts clean
  adjDragging=-1;
  document.getElementById('adjControls').style.display='none';
  setAdjustButtonText('⊕ Adjust Corners');
  document.getElementById('overlayCanvas').style.cursor='';
  var id=S.rawCanvas.getContext('2d').getImageData(0,0,S.rawCanvas.width,S.rawCanvas.height);
  processImage(id,S.rawCanvas.width,S.rawCanvas.height,S.rawCanvas);
}

// ── Results ──
function buildResults(){
  var has=S.students.length>0;
  document.getElementById('noRes').style.display=has?'none':'';
  document.getElementById('resContent').style.display=has?'':'none';
  if(!has) return;
  var pass=parseInt(document.getElementById('passPct').value)||70;
  var pcts=S.students.map(function(s){return s.pct;});
  var avg=Math.round(pcts.reduce(function(a,b){return a+b;},0)/pcts.length);
  var hi=Math.max.apply(null,pcts), lo=Math.min.apply(null,pcts);
  var passing=pcts.filter(function(p){return p>=pass;}).length;
  document.getElementById('statsRow').innerHTML=
    sc('Average',avg+'%')+sc('Highest',hi+'%')+sc('Lowest',lo+'%')+sc('Pass Rate',Math.round(passing/S.students.length*100)+'%');
  var tbody=document.getElementById('resBody'); tbody.innerHTML='';
  S.students.forEach(function(s,i){
    var ok=s.pct>=pass;
    tbody.innerHTML+='<tr><td>'+(i+1)+'</td><td style="font-family:inherit">'+esc(s.name)+'</td><td>'+s.correct+'/'+s.total+'</td><td>'+s.pct+'%</td><td><span class="bdg '+(ok?'bp':'bf')+'">'+(ok?'PASS':'FAIL')+'</span></td><td><button class="btn sm" onclick="delStu('+i+')">✕</button></td></tr>';
  });
  buildAnalytics();
}
function sc(l,v){ return '<div class="scard"><div class="slbl">'+l+'</div><div class="sval">'+v+'</div></div>'; }
function delStu(i){ S.students.splice(i,1); saveData(); updateHeader(); buildResults(); }

function buildAnalytics(){
  var grid=document.getElementById('aqGrid'); grid.innerHTML='';
  var tot=S.students.length; if(!tot) return;
  for(var q=0;q<50;q++){
    var cnt={A:0,B:0,C:0,D:0,E:0}, blank=0;
    S.students.forEach(function(s){ var a=s.answers[q]; if(a&&cnt[a]!==undefined) cnt[a]++; else blank++; });
    var key=S.key[q], maxWrong='', maxN=0;
    CH.forEach(function(c){ if(c!==key&&cnt[c]>maxN){ maxN=cnt[c]; maxWrong=c; } });
    var bars='';
    CH.forEach(function(c){
      var n=cnt[c], pct=tot>0?n/tot*100:0;
      var cls=c===key?' c':c===maxWrong&&maxN>0?' h':'';
      bars+='<div class="brow"><span class="bc">'+c+'</span><div class="btr"><div class="bfill'+cls+'" style="width:'+pct.toFixed(1)+'%"></div></div><span class="bn">'+n+'</span></div>';
    });
    var pCor=key?Math.round((cnt[key]||0)/tot*100):null;
    grid.innerHTML+='<div class="aqi"><div class="aqh"><span class="aql">Q'+(q+1)+'</span>'+(key?'<span class="aqk">Key: '+key+' · '+pCor+'% correct</span>':'<span style="color:var(--muted);font-size:11px">No key</span>')+'</div>'+bars+'</div>';
  }
}

function exportCSV(){
  var csv='Student,'+Array.from({length:50},function(_,i){return 'Q'+(i+1);}).join(',')+',Score,Out of,Percentage\n';
  S.students.forEach(function(s){
    csv+='"'+s.name+'",'+s.answers.map(function(a){return a===null?'':a;}).join(',')+','+s.correct+','+s.total+','+s.pct+'%\n';
  });
  csv+='\nQuestion Analytics\nQuestion,A,B,C,D,E,Blank,Key,% Correct\n';
  var tot=S.students.length;
  for(var q=0;q<50;q++){
    var cnt={A:0,B:0,C:0,D:0,E:0}, bl=0;
    S.students.forEach(function(s){ var a=s.answers[q]; if(a&&cnt[a]!==undefined) cnt[a]++; else bl++; });
    var k=S.key[q]||'';
    csv+='Q'+(q+1)+','+cnt.A+','+cnt.B+','+cnt.C+','+cnt.D+','+cnt.E+','+bl+','+k+','+(k&&tot?Math.round((cnt[k]||0)/tot*100)+'%':'')+'\n';
  }
  var cn=document.getElementById('className').value||'class';
  var a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download=cn+'-results.csv'; a.click();
}

// ── Answer key CSV import / export ──
function exportKeyCSV(){
  var header=Array.from({length:50},function(_,i){return 'Q'+(i+1);}).join(',');
  var row=S.key.map(function(a){return a===null?'':a;}).join(',');
  var cn=document.getElementById('className').value||'answer-key';
  var a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(header+'\n'+row+'\n');
  a.download=cn+'-key.csv'; a.click();
}

function importKeyCSV(e){
  var file=e.target.files[0]; if(!file) return;
  var reader=new FileReader();
  reader.onload=function(ev){
    var lines=ev.target.result.trim().split(/\r?\n/).filter(function(l){return l.trim();});
    var answers=null;

    // Horizontal format: one row of 50 A-E values (possibly preceded by a header row)
    for(var i=0;i<lines.length;i++){
      var cells=lines[i].split(',').map(function(c){return c.trim().toUpperCase();});
      if(cells.length===50&&cells.every(function(c){return c===''||c==='A'||c==='B'||c==='C'||c==='D'||c==='E';})){
        answers=cells; break;
      }
    }

    // Vertical format: two columns — question number, answer (e.g. "1,A" or "Q1,B")
    if(!answers){
      var map={};
      lines.forEach(function(l){
        var p=l.split(',').map(function(c){return c.trim();});
        if(p.length<2) return;
        var m=p[0].match(/^[Qq]?(\d+)$/);
        if(!m) return;
        var qn=parseInt(m[1]), ans=p[1].toUpperCase();
        if(qn>=1&&qn<=50&&(ans===''||'ABCDE'.indexOf(ans)>=0)) map[qn]=ans||null;
      });
      if(Object.keys(map).length>0)
        answers=Array.from({length:50},function(_,i){return map[i+1]||null;});
    }

    if(!answers){
      alert('Could not parse the CSV.\n\nSupported formats:\n• One row of 50 comma-separated answers (A–E or blank)\n• Two columns: question number, answer (e.g. 1,A)');
      document.getElementById('keyFile').value=''; return;
    }

    S.key=answers.map(function(a){return a===''||!a?null:a;});
    refreshStudentScores();
    buildKeyGrid();
    saveData();
    updateHeader();
    buildResults();
    document.getElementById('keyFile').value='';
    var count=S.key.filter(function(a){return a!==null;}).length;
    alert('Loaded '+count+' of 50 answers from "'+file.name+'".');
  };
  reader.readAsText(file);
}

// ── Utils ──
function setAlert(type,msg){
  var el=document.getElementById('scanAlert'); if(!el) return;
  var cls=type==='ok'?'al-ok':type==='err'?'al-err':'al-warn';
  el.innerHTML=msg?'<div class="al '+cls+'">'+msg+'</div>':'';
}
function esc(s){ return (s+'').replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

// ── Init ──
loadSavedData();
buildKeyGrid();
updateHeader();
buildResults();
document.getElementById('className').addEventListener('input',function(){ updateHeader(); saveData(); });
document.getElementById('passPct').addEventListener('input',function(){ saveData(); buildResults(); });
document.getElementById('livePreviewCanvas').addEventListener('click',function(){
  if(S.stream&&document.getElementById('btnCap').style.display!=='none') captureFrame();
});
document.getElementById('preScanCanvas').addEventListener('click',function(){
  if(S.rawCanvas&&document.getElementById('preScanCard').style.display!=='none') scanPending();
});

// Pre-scan drag events — handles both rect crop and 4-corner persp crop
(function(){
  var pc=document.getElementById('preScanCanvas');
  function getPt(clientX,clientY){
    var r=pc.getBoundingClientRect();
    if(!r.width||!pc.width) return[0,0];
    var sx=pc.width/r.width, sy=pc.height/r.height;
    return[
      Math.max(0,Math.min(pc.width,(clientX-r.left)*sx)),
      Math.max(0,Math.min(pc.height,(clientY-r.top)*sy))
    ];
  }
  function nearestPersp(pt){
    if(!perspState.handles) return -1;
    var r=pc.getBoundingClientRect();
    var thr=50*(pc.width/(r.width||1));
    var best=-1,bd=thr;
    perspState.handles.forEach(function(h,i){
      var dx=h[0]-pt[0],dy=h[1]-pt[1],d=Math.sqrt(dx*dx+dy*dy);
      if(d<bd){bd=d;best=i;}
    });
    return best;
  }
  function startDrag(cx,cy){
    var p=getPt(cx,cy);
    if(perspState.active){
      var ni=nearestPersp(p);
      if(ni>=0){ perspState.dragging=ni; return; }
    }
    if(!cropState.active) return;
    cropState.startX=p[0]; cropState.startY=p[1];
    cropState.x=p[0]; cropState.y=p[1]; cropState.w=0; cropState.h=0;
    cropState.dragging=true;
  }
  function moveDrag(cx,cy){
    var p=getPt(cx,cy);
    if(perspState.active&&perspState.dragging>=0){
      perspState.handles[perspState.dragging]=p;
      drawPerspCrop(); return;
    }
    if(!cropState.dragging) return;
    cropState.x=Math.min(cropState.startX,p[0]);
    cropState.y=Math.min(cropState.startY,p[1]);
    cropState.w=Math.abs(p[0]-cropState.startX);
    cropState.h=Math.abs(p[1]-cropState.startY);
    drawCropUI();
  }
  function endDrag(){ cropState.dragging=false; perspState.dragging=-1; }
  pc.addEventListener('mousedown',function(e){startDrag(e.clientX,e.clientY);});
  pc.addEventListener('mousemove',function(e){moveDrag(e.clientX,e.clientY);});
  pc.addEventListener('mouseup',endDrag);
  pc.addEventListener('touchstart',function(e){
    e.preventDefault(); var t=e.touches[0]; startDrag(t.clientX,t.clientY);
  },{passive:false});
  pc.addEventListener('touchmove',function(e){
    e.preventDefault(); var t=e.touches[0]; moveDrag(t.clientX,t.clientY);
  },{passive:false});
  pc.addEventListener('touchend',endDrag);
})();

// Canvas corner-drag events
(function(){
  var oc=document.getElementById('overlayCanvas');
  function getCPt(clientX,clientY){
    var r=oc.getBoundingClientRect();
    if(!r.width||!oc.width) return[0,0];
    return[(clientX-r.left)*oc.width/r.width,(clientY-r.top)*oc.height/r.height];
  }
  function nearest(pt){
    if(!S.manualCorners) return -1;
    var r=oc.getBoundingClientRect();
    var thr=60*(oc.width/r.width||1);
    var best=-1,bd=thr;
    S.manualCorners.forEach(function(c,i){
      var dx=c[0]-pt[0],dy=c[1]-pt[1],d=Math.sqrt(dx*dx+dy*dy);
      if(d<bd){bd=d;best=i;}
    });
    return best;
  }
  function isAdj(){return document.getElementById('adjControls').style.display!=='none';}
  oc.addEventListener('mousedown',function(e){
    if(!isAdj()) return;
    adjDragging=nearest(getCPt(e.clientX,e.clientY));
  });
  oc.addEventListener('mousemove',function(e){
    if(adjDragging<0) return;
    S.manualCorners[adjDragging]=getCPt(e.clientX,e.clientY);
    redrawHandles();
  });
  oc.addEventListener('mouseup',function(){adjDragging=-1;});
  oc.addEventListener('mouseleave',function(){adjDragging=-1;});
  oc.addEventListener('touchstart',function(e){
    if(!isAdj()) return;
    e.preventDefault();
    var t=e.touches[0];
    adjDragging=nearest(getCPt(t.clientX,t.clientY));
  },{passive:false});
  oc.addEventListener('touchmove',function(e){
    if(adjDragging<0) return;
    e.preventDefault();
    var t=e.touches[0];
    S.manualCorners[adjDragging]=getCPt(t.clientX,t.clientY);
    redrawHandles();
  },{passive:false});
  oc.addEventListener('touchend',function(){adjDragging=-1;});
})();
