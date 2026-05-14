// ── Constants ──
const SW=816,SH=1056,MK_LG=28,MK_SM=15,MKMG=10,BubR=9,MAXQ=100;
const CH=['A','B','C','D','E'];
// Fiducial markers placed like ZipGrade: four large corner squares seed the
// homography; mid-row and bottom markers (including left/right side pairs)
// refine it once the sheet is roughly aligned.
const TC={TL:[88,84],TR:[660,84],BL:[88,942],BR:[660,942]};
const FID_MARKERS=[
  {name:'TL',pt:TC.TL,size:MK_LG},{name:'TR',pt:TC.TR,size:MK_LG},{name:'BL',pt:TC.BL,size:MK_LG},{name:'BR',pt:TC.BR,size:MK_LG},
  {name:'ML',pt:[88,486],size:MK_SM},{name:'M1',pt:[360,486],size:MK_SM},{name:'M2',pt:[456,486],size:MK_SM},{name:'MR',pt:[660,486],size:MK_SM},
  {name:'B1',pt:[360,942],size:MK_SM},{name:'B2',pt:[456,942],size:MK_SM},
  {name:'L_ORI',pt:[88,750],size:MK_SM}
];
const BUB_X_100=[
  [143,165,186,208,230],
  [278,300,322,344,366],
  [414,436,457,479,501],
  [549,571,593,615,637]
];
const STARTY=112, LOWER_STARTY=514, ROWH=28.75, ROW_BREAK=13, MID_Y=486;
const ID_DIGITS=8, ID_X0=545, ID_DX=23, ID_Y0=648, ID_DY=19.5, ID_R=6.4;
const ORI_MARK=[88,750];
function rowY(r){ return r<ROW_BREAK?STARTY+r*ROWH:LOWER_STARTY+(r-ROW_BREAK)*ROWH; }
function sheetLayout(){
  var qc=activeQCount(), colMax=[28,28,28,16];
  var cols=[],rows=[],starts=[],done=0;
  for(var i=0;i<colMax.length;i++){
    if(done>=qc) break;
    var n=Math.min(colMax[i],qc-done);
    cols.push(BUB_X_100[i]); rows.push(n); starts.push(done);
    done+=n;
  }
  return{cols:cols,rows:rows,starts:starts};
}
function bxy(q,c){
  var layout=sheetLayout();
  for(var col=0;col<layout.starts.length;col++){
    var start=layout.starts[col], end=start+layout.rows[col];
    if(q>=start&&q<end) return [layout.cols[col][c], rowY(q-start)];
  }
  return [layout.cols[layout.cols.length-1][c], rowY(0)];
}
function idxy(d,n){ return [ID_X0+d*ID_DX,ID_Y0+n*ID_DY]; }

// ── State ──
const S={ key:new Array(MAXQ).fill(null), qCount:50, students:[], roster:{}, stream:null, detected:null, detectedId:null, rawCanvas:null,
          baseCanvas:null,    // current full working image after any orientation rotation
          manualCorners:null, manualOri:0, detectedCorners:null, lastRender:null,
          detectedMidPts:null, manualMidPts:null,
          sessionRotation:0, pendingScan:null,
          rosterMatchIdx:0 };
const STORE_KEY='bubbleGrader.v1';
var adjDragging=-1;
var cropState={active:false,dragging:false,startX:0,startY:0,x:0,y:0,w:0,h:0};
var perspState={active:false,handles:null,dragging:-1};
var previewReq=0;

function validAnswer(a){ return a===null||CH.indexOf(a)>=0||a==='?'; }
function activeQCount(){ return Math.max(1,Math.min(100,parseInt(S.qCount)||50)); }
function blankAnswers(){ return new Array(activeQCount()).fill(null); }
function normalizeAnswers(arr,len){
  return Array.from({length:len},function(_,i){ return arr&&validAnswer(arr[i])?arr[i]:null; });
}
function hasKeyPastFirstPage(){
  return false;
}

function loadSavedData(){
  try{
    var raw=localStorage.getItem(STORE_KEY);
    if(!raw) return;
    var saved=JSON.parse(raw);
    if(saved&&typeof saved.qCount==='number') S.qCount=Math.max(1,Math.min(100,Math.round(saved.qCount)));
    if(saved&&Array.isArray(saved.key)){
      S.key=normalizeAnswers(saved.key,MAXQ);
    }
    if(saved&&Array.isArray(saved.students)){
      S.students=saved.students.filter(function(s){
        return s&&typeof s.name==='string'&&Array.isArray(s.answers);
      }).map(function(s){
        var answers=normalizeAnswers(s.answers,activeQCount());
        var scored=scoreOf(answers);
        return {name:s.name,studentId:s.studentId||'',className:s.className||'',period:s.period||'',answers:answers,correct:scored.correct,total:scored.total,pct:scored.pct};
      });
    }
    if(saved&&saved.roster&&typeof saved.roster==='object'){
      var raw=saved.roster;
      Object.keys(raw).forEach(function(k){ if(!Array.isArray(raw[k])) raw[k]=[raw[k]]; });
      S.roster=raw;
    }
    if(saved&&typeof saved.className==='string') document.getElementById('className').value=saved.className;
    if(saved&&saved.passPct!==undefined) document.getElementById('passPct').value=saved.passPct;
    if(saved&&typeof saved.scanClassName==='string') document.getElementById('scanClassName').value=saved.scanClassName;
    if(saved&&typeof saved.scanPeriod==='string') document.getElementById('scanPeriod').value=saved.scanPeriod;
  }catch(e){
    console.warn('Could not load saved Bubble Grader data',e);
  }
}

function saveData(){
  try{
    localStorage.setItem(STORE_KEY,JSON.stringify({
      key:S.key,
      qCount:S.qCount,
      students:S.students,
      roster:S.roster,
      className:document.getElementById('className').value||'',
      passPct:document.getElementById('passPct').value||70,
      scanClassName:document.getElementById('scanClassName').value||'',
      scanPeriod:document.getElementById('scanPeriod').value||''
    }));
  }catch(e){
    console.warn('Could not save Bubble Grader data',e);
  }
}

function refreshStudentScores(){
  S.students=S.students.map(function(s){
    var answers=normalizeAnswers(s.answers,activeQCount());
    var scored=scoreOf(answers);
    return {name:s.name,studentId:s.studentId||'',className:s.className||'',period:s.period||'',answers:answers,correct:scored.correct,total:scored.total,pct:scored.pct};
  });
}

function clearResultsOnly(){
  var msg='Clear all saved student results and class name from this browser? The answer key will be kept.';
  if(!confirm(msg)) return;
  S.students=[];
  S.pendingScan=null;
  document.getElementById('className').value='';
  document.getElementById('scanClassName').value='';
  document.getElementById('scanPeriod').value='';
  saveData();
  updateHeader();
  buildResults();
  setAlert('ok','Saved results cleared. The answer key was kept.');
}

function clearKeyAndResults(){
  var msg='Clear the saved answer key, student results, and class name from this browser? This cannot be undone.';
  if(!confirm(msg)) return;
  S.key=new Array(MAXQ).fill(null);
  S.students=[];
  S.pendingScan=null;
  document.getElementById('className').value='';
  document.getElementById('scanClassName').value='';
  document.getElementById('scanPeriod').value='';
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
  var qc=activeQCount();
  var title=document.getElementById('keyTitle');
  if(title) title.textContent='Answer Key — '+qc+' Questions (A–E)';
  var sel=document.getElementById('qCount'); if(sel) sel.value=qc;
  var tplSel=document.getElementById('tplQCount'); if(tplSel) tplSel.value=qc;
  for(var q=0;q<qc;q++){
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
function setQuestionCount(n){
  n=Math.max(1,Math.min(100,parseInt(n)||50));
  S.qCount=n;
  S.pendingScan=null;
  refreshStudentScores();
  buildKeyGrid();
  buildTemplate();
  saveData();
  updateHeader();
  buildResults();
}
function randomKey(){ var qc=activeQCount(); S.key=new Array(MAXQ).fill(null); for(var i=0;i<qc;i++)S.key[i]=CH[Math.floor(Math.random()*5)]; refreshStudentScores(); buildKeyGrid(); saveData(); updateHeader(); buildResults(); }
function clearKey(){ S.key=new Array(MAXQ).fill(null); S.pendingScan=null; refreshStudentScores(); buildKeyGrid(); saveData(); updateHeader(); buildResults(); }

// ── Template ──
function makeSVG(pageOffset){
  return makeSheetSVG();
  pageOffset=pageOffset||0;
  var W=SW,H=SH,LY=STARTY-22;
  var s='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">';
  s+='<rect width="'+W+'" height="'+H+'" fill="white"/>';
  for(var r=0;r<25;r++) if(r%2===0){
    var y=STARTY+r*ROWH-14;
    s+='<rect x="232" y="'+y+'" width="205" height="'+ROWH+'" fill="#f5f5f3"/>';
    s+='<rect x="530" y="'+y+'" width="205" height="'+ROWH+'" fill="#f5f5f3"/>';
  }
  FID_MARKERS.forEach(function(m){
    s+='<rect x="'+(m.pt[0]-MKSZ/2)+'" y="'+(m.pt[1]-MKSZ/2)+'" width="'+MKSZ+'" height="'+MKSZ+'" fill="black"/>';
  });
  // Asymmetric orientation mark in the header band. Scanner samples (474, 122).
  s+='<rect x="464" y="112" width="20" height="20" fill="black"/>';
  s+='<polygon points="474,104 467,112 481,112" fill="black"/>';
  s+='<text x="'+W/2+'" y="58" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" font-weight="bold" fill="#111">BUBBLE ANSWER SHEET — Questions '+(pageOffset+1)+'–'+(pageOffset+50)+'</text>';
  s+='<text x="64" y="92" font-family="Arial,sans-serif" font-size="10.5" fill="#444">NAME:</text>';
  s+='<line x1="96" y1="94" x2="420" y2="94" stroke="#bbb" stroke-width=".8"/>';
  s+='<text x="430" y="92" font-family="Arial,sans-serif" font-size="10.5" fill="#444">DATE:</text>';
  s+='<line x1="458" y1="94" x2="576" y2="94" stroke="#bbb" stroke-width=".8"/>';
  s+='<text x="586" y="92" font-family="Arial,sans-serif" font-size="10.5" fill="#444">CLASS:</text>';
  s+='<line x1="618" y1="94" x2="750" y2="94" stroke="#bbb" stroke-width=".8"/>';
  s+='<line x1="60" y1="148" x2="'+(W-60)+'" y2="148" stroke="#d0d0d0" stroke-width="1"/>';
  s+='<line x1="226" y1="160" x2="226" y2="'+(H-78)+'" stroke="#d8d8d8" stroke-width=".8"/>';
  s+='<line x1="508" y1="160" x2="508" y2="'+(H-78)+'" stroke="#e0e0e0" stroke-width=".7"/>';
  s+='<text x="132" y="184" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="bold" fill="#555">STUDENT ID</text>';
  for(var d=0;d<ID_DIGITS;d++){
    var dx=ID_X0+d*ID_DX;
    s+='<text x="'+dx+'" y="210" text-anchor="middle" font-family="Arial,sans-serif" font-size="8.5" fill="#666">'+(d+1)+'</text>';
  }
  for(var n=0;n<10;n++){
    s+='<text x="60" y="'+(ID_Y0+n*ID_DY+3)+'" text-anchor="middle" font-family="Arial,sans-serif" font-size="8.5" fill="#666">'+n+'</text>';
    for(var d=0;d<ID_DIGITS;d++){
      var idp=idxy(d,n);
      s+='<circle cx="'+idp[0]+'" cy="'+idp[1]+'" r="'+ID_R+'" fill="none" stroke="#444" stroke-width="1"/>';
    }
  }
  CH.forEach(function(ch,i){
    s+='<text x="'+LX[i]+'" y="'+LY+'" text-anchor="middle" font-family="Arial,sans-serif" font-size="10.5" font-weight="bold" fill="#666">'+ch+'</text>';
    s+='<text x="'+RX[i]+'" y="'+LY+'" text-anchor="middle" font-family="Arial,sans-serif" font-size="10.5" font-weight="bold" fill="#666">'+ch+'</text>';
  });
  for(var q=0;q<PAGEQ;q++){
    var col=q<25?0:1, row=q%25, y=STARTY+row*ROWH;
    var nx=col?536:238, xs=col?RX:LX;
    s+='<text x="'+nx+'" y="'+(y+4)+'" text-anchor="end" font-family="Arial,sans-serif" font-size="10.5" fill="#555">'+(pageOffset+q+1)+'.</text>';
    xs.forEach(function(bx){ s+='<circle cx="'+bx+'" cy="'+y+'" r="'+BubR+'" fill="none" stroke="#444" stroke-width="1.1"/>'; });
  }
  s+='<text x="'+W/2+'" y="'+(H-22)+'" text-anchor="middle" font-family="Arial,sans-serif" font-size="9.5" fill="#bbb">Fill each bubble completely with a dark pen or pencil · Do not mark outside the circles</text>';
  s+='</svg>';
  return s;
}

function makeSheetSVG(){
  var W=SW,H=SH,qc=activeQCount(),layout=sheetLayout();
  var s='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">';
  s+='<rect width="'+W+'" height="'+H+'" fill="white"/>';

  // Alternating row bands — spans rows used by the tallest column
  var bandMax=Math.min(qc,28);
  for(var r=0;r<bandMax;r++){
    if(r%2===0) continue;
    var bY=rowY(r);
    s+='<rect x="56" y="'+(bY-ROWH*0.5).toFixed(2)+'" width="704" height="'+ROWH+'" fill="#f5f5f4"/>';
  }

  // Fiducial markers
  FID_MARKERS.forEach(function(m){
    s+='<rect x="'+(m.pt[0]-m.size/2)+'" y="'+(m.pt[1]-m.size/2)+'" width="'+m.size+'" height="'+m.size+'" fill="black"/>';
  });

  // Mid-row horizontal divider
  s+='<line x1="56" y1="486" x2="760" y2="486" stroke="#ccc" stroke-width="0.8"/>';

  // Header — Name box + Period box
  s+='<text x="72" y="55" font-family="Arial,sans-serif" font-size="13" fill="#111">Name</text>';
  s+='<rect x="116" y="35" width="350" height="30" fill="none" stroke="#111" stroke-width="1.2"/>';
  s+='<text x="478" y="55" font-family="Arial,sans-serif" font-size="13" fill="#111">Period</text>';
  s+='<rect x="528" y="35" width="145" height="30" fill="none" stroke="#111" stroke-width="1.2"/>';

  // Question bubbles — letters A–E inside each circle, number label to left
  for(var q=0;q<qc;q++){
    var pt0=bxy(q,0),y=pt0[1],xs=null,numX=0;
    for(var ci=0;ci<layout.starts.length;ci++){
      if(q>=layout.starts[ci]&&q<layout.starts[ci]+layout.rows[ci]){xs=layout.cols[ci];numX=xs[0]-18;break;}
    }
    s+='<text x="'+numX+'" y="'+(y+5)+'" text-anchor="end" font-family="Arial,sans-serif" font-size="12" fill="#111">'+(q+1)+'</text>';
    xs.forEach(function(bx,bi){
      s+='<circle cx="'+bx+'" cy="'+y+'" r="'+BubR+'" fill="none" stroke="#888" stroke-width="1.1"/>';
      s+='<text x="'+bx+'" y="'+(y+3)+'" text-anchor="middle" font-family="Arial,sans-serif" font-size="7.5" fill="#bbb">'+CH[bi]+'</text>';
    });
  }

  // Student ID — handwriting box above, digit labels to left, digit inside each bubble
  var idCx=ID_X0+(ID_DIGITS-1)*ID_DX/2;
  var wbX1=ID_X0-ID_DX/2, wbX2=ID_X0+(ID_DIGITS-0.5)*ID_DX;
  var wbY1=ID_Y0-ID_R-42, wbY2=ID_Y0-ID_R-18;
  s+='<text x="'+idCx+'" y="'+(wbY1-6)+'" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" fill="#111">Student ID</text>';
  s+='<rect x="'+wbX1+'" y="'+wbY1+'" width="'+(wbX2-wbX1)+'" height="'+(wbY2-wbY1)+'" fill="none" stroke="#777" stroke-width="0.8"/>';
  for(var dv=1;dv<ID_DIGITS;dv++){
    var dvX=ID_X0+(dv-0.5)*ID_DX;
    s+='<line x1="'+dvX+'" y1="'+wbY1+'" x2="'+dvX+'" y2="'+wbY2+'" stroke="#777" stroke-width="0.5"/>';
  }
  var idBx=ID_X0-ID_R-4, idBy=ID_Y0-ID_R-4;
  var idBw=(ID_DIGITS-1)*ID_DX+ID_R*2+8, idBh=9*ID_DY+ID_R*2+8;
  s+='<rect x="'+idBx+'" y="'+idBy+'" width="'+idBw+'" height="'+idBh+'" fill="none" stroke="#bbb" stroke-width="0.7"/>';
  for(var n=0;n<10;n++){
    s+='<text x="'+(idBx-4)+'" y="'+(ID_Y0+n*ID_DY+4)+'" text-anchor="end" font-family="Arial,sans-serif" font-size="9" fill="#777">'+n+'</text>';
    for(var db=0;db<ID_DIGITS;db++){
      var ip=idxy(db,n);
      s+='<circle cx="'+ip[0]+'" cy="'+ip[1]+'" r="'+ID_R+'" fill="none" stroke="#888" stroke-width="1"/>';
      s+='<text x="'+ip[0]+'" y="'+(ip[1]+2)+'" text-anchor="middle" font-family="Arial,sans-serif" font-size="6" fill="#bbb">'+n+'</text>';
    }
  }

  s+='</svg>';
  return s;
}

function buildTemplate(){
  var p=document.getElementById('tplPrev');
  p.innerHTML='';
  var img=new Image();
  img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(makeSheetSVG());
  img.style.cssText='max-width:380px;width:100%;margin:0 8px 12px';
  p.appendChild(img);
}

function printTpl(){
  var uri='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(makeSheetSVG())));
  var w=window.open('','_blank');
  if(!w){ alert('Pop-up blocked. Please allow pop-ups for this page and try again.'); return; }
  w.document.write('<!DOCTYPE html><html><head><title>Answer Sheet</title><style>@page{margin:0;size:letter portrait}body{margin:0}img{width:8.5in;height:11in;display:block}</style></head><body><img src="'+uri+'"><script>window.onload=function(){window.print();window.close()}<\/script></body></html>');
  w.document.close();
}

function dlSVG(){
  var svg=makeSheetSVG();
  var a=document.createElement('a');
  a.href='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
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
  S.detected=null; S.detectedId=null; S.rawCanvas=null; S.baseCanvas=null;
  S.manualCorners=null; S.detectedCorners=null; S.lastRender=null; S.manualOri=0;
  S.detectedMidPts=null; S.manualMidPts=null;
  adjDragging=-1;
  exitCropMode(); exitPerspCropMode();
  document.getElementById('adjControls').style.display='none';
  setAdjustButtonText('⊕ Adjust Corners');
  var _rl=document.getElementById('stuLast'); if(_rl) _rl.value='';
  var _rf=document.getElementById('stuFirst'); if(_rf) _rf.value='';
  var _ri=document.getElementById('stuIdField'); if(_ri){_ri.value=''; var _rs=document.getElementById('stuIdStatus'); if(_rs) _rs.textContent='';}
  S.rosterMatchIdx=0;
  var _nm=document.getElementById('btnNextMatch'); if(_nm) _nm.style.display='none';
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
    if(n<25||bw>w*0.28||bh>h*0.28||bw<w*0.025||bh<h*0.025) continue;
    if(aspect<0.55||aspect>1.8||fill<0.45) continue;
    var score=n*fill/(1+Math.abs(Math.log(aspect)));
    if(!best||score>best.score) best={score:score,x:sx/n,y:sy/n};
  }
  return best?[best.x,best.y]:null;
}

function findPageBounds(data,W,H){
  var xMin=W,xMax=0,yMin=H,yMax=0;
  for(var y=0;y<H;y+=3) for(var x=0;x<W;x+=3){
    if(gpx(data,(y*W+x)*4)>190){
      if(x<xMin)xMin=x; if(x>xMax)xMax=x;
      if(y<yMin)yMin=y; if(y>yMax)yMax=y;
    }
  }
  if(xMin>=xMax||yMin>=yMax) return{x0:0,y0:0,x1:W,y1:H};
  var mx=Math.round((xMax-xMin)*0.02),my=Math.round((yMax-yMin)*0.02);
  return{x0:Math.max(0,xMin-mx),y0:Math.max(0,yMin-my),
         x1:Math.min(W,xMax+mx),y1:Math.min(H,yMax+my)};
}

function detectCorners(data,W,H){
  var pg=findPageBounds(data,W,H);
  var pw=pg.x1-pg.x0, ph=pg.y1-pg.y0;
  var qx=Math.floor(pw*0.32),qy=Math.floor(ph*0.32);
  var TL=findMarkerBlob(data,W,pg.x0,pg.y0,pg.x0+qx,pg.y0+qy);
  var TR=findMarkerBlob(data,W,pg.x1-qx,pg.y0,pg.x1,pg.y0+qy);
  var BL=findMarkerBlob(data,W,pg.x0,pg.y1-qy,pg.x0+qx,pg.y1);
  var BR=findMarkerBlob(data,W,pg.x1-qx,pg.y1-qy,pg.x1,pg.y1);
  if(!TL||!TR||!BL||!BR) return null;
  if(TL[0]>=TR[0]||BL[0]>=BR[0]||TL[1]>=BL[1]||TR[1]>=BR[1]) return null;
  var cw=(TR[0]-TL[0]+BR[0]-BL[0])/2, ch=(BL[1]-TL[1]+BR[1]-TR[1])/2;
  if(cw/ch<0.3||cw/ch>2.0) return null;
  return [TL,TR,BL,BR];
}

function findMarkerNear(data,W,H,cx,cy,r){
  var x0=Math.max(0,Math.floor(cx-r)), y0=Math.max(0,Math.floor(cy-r));
  var x1=Math.min(W,Math.ceil(cx+r)), y1=Math.min(H,Math.ceil(cy+r));
  return findMarkerBlob(data,W,x0,y0,x1,y1);
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

// Build a split (piecewise) homography from 4 corners + 2 mid-row points.
// H_top covers template y ≤ MID_Y; H_bot covers y > MID_Y.
// At y=MID_Y both halves agree (continuity at the seam).
function buildSplitH(corners,midPts){
  var ML=[88,MID_Y],MR=[660,MID_Y];
  var Ht=calcH([TC.TL,TC.TR,ML,MR],[corners[0],corners[1],midPts[0],midPts[1]]);
  var Hb=calcH([ML,MR,TC.BL,TC.BR],[midPts[0],midPts[1],corners[2],corners[3]]);
  return (Ht&&Hb)?{top:Ht,bot:Hb,midY:MID_Y}:null;
}

// Map a template point through a plain H or a split-H object.
function mapPtS(H,x,y){
  return (H&&H.top)?(y<=H.midY?mapPt(H.top,x,y):mapPt(H.bot,x,y)):mapPt(H,x,y);
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

// Pixel-luma variance inside a circle — high for pencil graphite, near-zero for blank paper.
function varianceAt(data,W,H,cx,cy,r){
  var r2=r*r,sum=0,sum2=0,n=0,rc=Math.ceil(r);
  for(var dy=-rc;dy<=rc;dy++) for(var dx=-rc;dx<=rc;dx++){
    if(dx*dx+dy*dy>r2) continue;
    var px=Math.round(cx+dx),py=Math.round(cy+dy);
    if(px<0||px>=W||py<0||py>=H) continue;
    var v=gpx(data,(py*W+px)*4)/255; sum+=v; sum2+=v*v; n++;
  }
  if(n<2) return 0;
  var mean=sum/n; return Math.max(0,sum2/n-mean*mean);
}

// Local contrast normalisation using a downsampled box-blur for local means.
// Each pixel is mapped to 128 + (luma - localMean) * boost, clamped 0-255.
// Returns a new Uint8ClampedArray (grayscale RGBA) the same size as data.
function normalizeContrast(data,W,H,windowR,boost){
  var N=W*H;
  var gray=new Uint8Array(N);
  for(var i=0;i<N;i++) gray[i]=gpx(data,i*4)|0;
  // Downsample 4× to compute local means cheaply via separable box blur
  var D=4, sw=Math.ceil(W/D), sh=Math.ceil(H/D);
  var small=new Float32Array(sw*sh);
  for(var y=0;y<sh;y++) for(var x=0;x<sw;x++){
    var sum=0,n=0;
    for(var dy=0;dy<D;dy++) for(var dx=0;dx<D;dx++){
      var fy=y*D+dy,fx=x*D+dx;
      if(fy<H&&fx<W){sum+=gray[fy*W+fx];n++;}
    }
    small[y*sw+x]=n?sum/n:128;
  }
  // Separable box blur on downsampled image
  var kr=Math.max(1,Math.round(windowR/D));
  var maxPsz=Math.max(sw,sh)+1, psum=new Float32Array(maxPsz);
  var tmp=new Float32Array(sw*sh), blur=new Float32Array(sw*sh);
  for(var y=0;y<sh;y++){
    psum[0]=0; for(var x=0;x<sw;x++) psum[x+1]=psum[x]+small[y*sw+x];
    for(var x=0;x<sw;x++){var x0=Math.max(0,x-kr),x1=Math.min(sw,x+kr+1);tmp[y*sw+x]=(psum[x1]-psum[x0])/(x1-x0);}
  }
  for(var x=0;x<sw;x++){
    psum[0]=0; for(var y=0;y<sh;y++) psum[y+1]=psum[y]+tmp[y*sw+x];
    for(var y=0;y<sh;y++){var y0=Math.max(0,y-kr),y1=Math.min(sh,y+kr+1);blur[y*sw+x]=(psum[y1]-psum[y0])/(y1-y0);}
  }
  // Apply normalisation with bilinear-interpolated local mean
  var out=new Uint8ClampedArray(data.length);
  for(var y=0;y<H;y++) for(var x=0;x<W;x++){
    var bx=x/D,by=y/D;
    var bx0=Math.floor(bx)|0,by0=Math.floor(by)|0;
    var bx1=bx0+1<sw?bx0+1:bx0, by1=by0+1<sh?by0+1:by0;
    var fx=bx-bx0,fy=by-by0;
    var lm=(1-fy)*((1-fx)*blur[by0*sw+bx0]+fx*blur[by0*sw+bx1])
          +fy*((1-fx)*blur[by1*sw+bx0]+fx*blur[by1*sw+bx1]);
    var v=128+(gray[y*W+x]-lm)*boost;
    v=v<0?0:v>255?255:v;
    var idx=(y*W+x)*4;
    out[idx]=v|0; out[idx+1]=v|0; out[idx+2]=v|0; out[idx+3]=255;
  }
  return out;
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
  for(var q=0;q<activeQCount();q++) for(var c=0;c<5;c++){
    var tmpl=bxy(q,c),est=mapPt(initH,tmpl[0],tmpl[1]);
    if(est[0]<sampR||est[0]>=W-sampR||est[1]<sampR||est[1]>=H-sampR) continue;
    if(darkAt(data,W,H,est[0],est[1],sampR)>0.35) continue; // skip filled bubbles
    var ref=findRingCenter(data,W,H,est[0],est[1],sampR,searchR);
    if(ref){srcPts.push(tmpl);dstPts.push(ref);}
  }
  if(srcPts.length<12) return initH; // too few clear rings — keep original
  return calcHOverdet(srcPts,dstPts)||initH;
}

// Refine each half of a split H independently using bubble ring centres.
// camCorners=[TL,TR,BL,BR] and camMidPts=[ML,MR] are the actual detected camera
// positions used as hard anchors so ring-centre noise cannot drift the corners.
function refineSplitH(splitH,data,W,H,sampR,camCorners,camMidPts){
  var searchR=Math.round(sampR*1.5);
  var mL=[88,MID_Y],mR=[660,MID_Y];
  // Use actual detected positions as anchors; fall back to H-predicted if unavailable
  var dTL=camCorners?camCorners[0]:mapPt(splitH.top,88,84);
  var dTR=camCorners?camCorners[1]:mapPt(splitH.top,660,84);
  var dBL=camCorners?camCorners[2]:mapPt(splitH.bot,88,942);
  var dBR=camCorners?camCorners[3]:mapPt(splitH.bot,660,942);
  var dML=camMidPts?camMidPts[0]:mapPt(splitH.top,mL[0],mL[1]);
  var dMR=camMidPts?camMidPts[1]:mapPt(splitH.top,mR[0],mR[1]);
  var topSrc=[[88,84],[660,84],mL,mR];
  var topDst=[dTL,dTR,dML,dMR];
  var botSrc=[mL,mR,[88,942],[660,942]];
  var botDst=[dML,dMR,dBL,dBR];
  for(var q=0;q<activeQCount();q++) for(var c=0;c<5;c++){
    var tmpl=bxy(q,c);
    var isTop=tmpl[1]<=splitH.midY;
    var halfH=isTop?splitH.top:splitH.bot;
    var est=mapPt(halfH,tmpl[0],tmpl[1]);
    if(est[0]<sampR||est[0]>=W-sampR||est[1]<sampR||est[1]>=H-sampR) continue;
    if(darkAt(data,W,H,est[0],est[1],sampR)>0.35) continue;
    var ref=findRingCenter(data,W,H,est[0],est[1],sampR,searchR);
    if(!ref) continue;
    if(isTop){topSrc.push(tmpl);topDst.push(ref);}
    else{botSrc.push(tmpl);botDst.push(ref);}
  }
  // Require at least 20 ring correspondences (beyond the 4 anchors) per half
  var newTop=topSrc.length>=24?(calcHOverdet(topSrc,topDst)||splitH.top):splitH.top;
  var newBot=botSrc.length>=24?(calcHOverdet(botSrc,botDst)||splitH.bot):splitH.bot;
  return{top:newTop,bot:newBot,midY:splitH.midY};
}

function refineHmatWithMarkers(initH,data,W,H,sampR,baseDst){
  var srcPts=[TC.TL,TC.TR,TC.BL,TC.BR], dstPts=[];
  for(var i=0;i<srcPts.length;i++) dstPts.push(baseDst&&baseDst[i]?baseDst[i]:mapPt(initH,srcPts[i][0],srcPts[i][1]));
  var searchR=Math.max(24,Math.round(sampR*5.0));
  // Only search for small markers — large corner markers are already seeded above and
  // their blob footprint exceeds the size threshold in findMarkerBlob.
  FID_MARKERS.forEach(function(m){
    if(m.size===MK_LG) return;
    var est=mapPt(initH,m.pt[0],m.pt[1]);
    var found=findMarkerNear(data,W,H,est[0],est[1],searchR);
    if(found){ srcPts.push(m.pt); dstPts.push(found); }
  });
  return srcPts.length>=5?(calcHOverdet(srcPts,dstPts)||initH):initH;
}

function detectStudentId(data,W,H,Hmat,sampR){
  var chars=[], raw=[];
  var idr=Math.max(3,sampR*0.72), ir=Math.max(2,idr*0.7);
  for(var d=0;d<ID_DIGITS;d++){
    var vals=[], cams10=[];
    for(var n=0;n<10;n++){var pt=idxy(d,n);cams10.push(mapPtS(Hmat,pt[0],pt[1]));}
    for(var n=0;n<10;n++) vals.push(fillAt(data,W,H,cams10[n][0],cams10[n][1],idr));
    raw.push(vals);
    // Same variance + per-digit baseline approach as answer bubble detection
    var scores=[];
    for(var n=0;n<10;n++){var vr=varianceAt(data,W,H,cams10[n][0],cams10[n][1],ir);scores.push(vals[n]+vr*2.0);}
    var dBase=Math.min.apply(null,scores);
    var mx=0,mxI=0,adjArr=[];
    for(var n=0;n<10;n++){var av=Math.max(0,scores[n]-dBase);adjArr.push(av);if(av>mx){mx=av;mxI=n;}}
    adjArr.sort(function(a,b){return b-a;});
    var second=adjArr[1];
    chars.push(mx<0.04||mx-second<0.04&&second>0.04?'':String(mxI));
  }
  return {id:chars.every(function(ch){return ch!=='';})?chars.join(''):'',raw:raw};
}

function uprightRotationForOrientation(oi){
  return [0,180,270,90][oi]||0;
}

function processImage(imgData,W,imgH,srcCanvas,allowAutoUpright){
  if(allowAutoUpright===undefined) allowAutoUpright=true;
  var data=imgData.data; // raw — used for all marker/corner/orientation/refinement steps
  document.getElementById('procOverlay').style.display='none';
  // Reset manual adjustment state for each new scan
  S.manualCorners=null; S.manualOri=0; S.manualMidPts=null; S.detectedMidPts=null;
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

  // Try 4 rotational orientations; pick whichever places the asymmetric left
  // marker on a dark region.
  var ORIENTS=[
    [TC.TL,TC.TR,TC.BL,TC.BR],  // 0°
    [TC.BR,TC.BL,TC.TR,TC.TL],  // 180°
    [TC.BL,TC.TL,TC.BR,TC.TR],  // 90° CW
    [TC.TR,TC.BR,TC.TL,TC.BL]   // 90° CCW
  ];
  var Hmat=null, bestH=null, bestOmDark=-1, selectedOi=0, bestOi=0;
  var oriSearchR=Math.max(30,Math.round(sampR*6));
  for(var oi=0;oi<4;oi++){
    var tryH=calcH(ORIENTS[oi],corners);
    if(!tryH) continue;
    var omCam=mapPt(tryH,ORI_MARK[0],ORI_MARK[1]);
    if(omCam[0]<0||omCam[0]>=W||omCam[1]<0||omCam[1]>=imgH) continue;
    // Primary: look for an actual dark square blob near the predicted position
    var oriBlob=findMarkerNear(data,W,imgH,omCam[0],omCam[1],oriSearchR);
    if(oriBlob){Hmat=tryH;selectedOi=oi;break;}
    // Secondary: fall back to average darkness for tie-breaking when blob detection fails
    var omDark=darkAt(data,W,imgH,omCam[0],omCam[1],sampR);
    if(omDark>bestOmDark){bestOmDark=omDark;bestH=tryH;bestOi=oi;}
  }
  // If no orientation found a blob, use the one whose mark was darkest rather than
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
  Hmat=refineHmatWithMarkers(Hmat,data,W,imgH,sampR,corners);
  // Two-pass ring-centre refinement for sub-pixel accuracy, followed by a final
  // marker re-anchor. The re-anchor is critical for 50Q sheets where the bottom
  // half has no bubbles in cols 3-4: without it, the ring-centre fit drifts
  // rightward and corrupts mid-row marker search and student ID detection.
  Hmat=refineHmat(Hmat,data,W,imgH,sampR);
  Hmat=refineHmat(Hmat,data,W,imgH,sampR);
  Hmat=refineHmatWithMarkers(Hmat,data,W,imgH,sampR,corners);

  // Build split homography using mid-row markers (ML/MR at y=MID_Y).
  // Two independent 4-point transforms — one for each half — correct non-linear
  // page curl / keystoning that a single homography cannot fix.
  var searchR2=Math.max(24,Math.round(sampR*5.0));
  var mlEst=mapPt(Hmat,88,MID_Y),mrEst=mapPt(Hmat,660,MID_Y);
  var mlCam=findMarkerNear(data,W,imgH,mlEst[0],mlEst[1],searchR2);
  var mrCam=findMarkerNear(data,W,imgH,mrEst[0],mrEst[1],searchR2);
  // Fallback: use center mid-row markers M1/M2 to extrapolate ML/MR positions
  if(!mlCam||!mrCam){
    var m1Cam=findMarkerNear(data,W,imgH,mapPt(Hmat,360,MID_Y)[0],mapPt(Hmat,360,MID_Y)[1],searchR2);
    var m2Cam=findMarkerNear(data,W,imgH,mapPt(Hmat,456,MID_Y)[0],mapPt(Hmat,456,MID_Y)[1],searchR2);
    if(m1Cam&&m2Cam){
      // Linear extrapolation: camera pixels per template unit along the seam
      var sdx=(m2Cam[0]-m1Cam[0])/(456-360), sdy=(m2Cam[1]-m1Cam[1])/(456-360);
      if(!mlCam) mlCam=[m1Cam[0]+sdx*(88-360), m1Cam[1]+sdy*(88-360)];
      if(!mrCam) mrCam=[m1Cam[0]+sdx*(660-360), m1Cam[1]+sdy*(660-360)];
    }
  }
  S.detectedMidPts=(mlCam&&mrCam)?[mlCam,mrCam]:null;
  var splitH=S.detectedMidPts?buildSplitH(corners,S.detectedMidPts):null;
  if(splitH) splitH=refineSplitH(splitH,data,W,imgH,sampR,corners,S.detectedMidPts);
  var activeH=splitH||Hmat;

  // Normalize contrast only for scoring — marker/orientation detection uses raw data above
  var normData=normalizeContrast(data,W,imgH,60,3.0);
  var idResult=detectStudentId(normData,W,imgH,activeH,sampR);
  var raw=[],detected=[];
  for(var q=0;q<activeQCount();q++){
    var vals=[];
    var cams5=[];
    for(var c=0;c<5;c++){var pt=bxy(q,c);cams5.push(mapPtS(activeH,pt[0],pt[1]));}
    for(var c=0;c<5;c++) vals.push(fillAt(normData,W,imgH,cams5[c][0],cams5[c][1],sampR));
    raw.push(vals);
    // Combine fill-darkness with texture variance (catches specular pencil reflection).
    // Then subtract per-question baseline so relative contrast is preserved even when
    // all 5 bubbles are uniformly washed out by glare.
    var ir=Math.max(2,sampR*0.6);
    var scores=[];
    for(var c=0;c<5;c++){var vr=varianceAt(normData,W,imgH,cams5[c][0],cams5[c][1],ir);scores.push(vals[c]+vr*2.0);}
    var qBase=Math.min.apply(null,scores);
    var mx=0,mxI=0,adjArr=[];
    for(var c=0;c<5;c++){var av=Math.max(0,scores[c]-qBase);adjArr.push(av);if(av>mx){mx=av;mxI=c;}}
    adjArr.sort(function(a,b){return b-a;});
    var second=adjArr[1];
    detected.push(mx<0.04?null:mx-second<0.04&&second>0.04?'?':CH[mxI]);
  }

  S.detected=detected;
  S.detectedId=idResult.id;
  renderOverlay(srcCanvas,W,imgH,corners,activeH,sampR,raw,detected);
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
  for(var q=0;q<activeQCount();q++){
    for(var c=0;c<5;c++){
      var pt=bxy(q,c), cam=mapPtS(Hmat,pt[0],pt[1]);
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
  for(var d=0;d<ID_DIGITS;d++){
    var chosen=S.detectedId&&S.detectedId.length===ID_DIGITS?parseInt(S.detectedId[d],10):NaN;
    for(var n=0;n<10;n++){
      var ip=idxy(d,n), icam=mapPtS(Hmat,ip[0],ip[1]);
      ctx.beginPath(); ctx.arc(icam[0],icam[1],Math.max(3,sampR*0.72),0,Math.PI*2);
      if(n===chosen){
        ctx.strokeStyle='#38bdf8'; ctx.lineWidth=Math.max(1.5,sc*2.2); ctx.stroke();
        ctx.globalAlpha=0.22; ctx.fillStyle='#38bdf8'; ctx.fill(); ctx.globalAlpha=1;
      } else {
        ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1; ctx.stroke();
      }
    }
  }
  document.getElementById('resultImgCard').style.display='';
}

// ── Scoring ──
function scoreOf(det,count){
  var keyed=0;
  var qc=count||activeQCount();
  for(var i=0;i<qc;i++) if(S.key[i]) keyed++;
  if(!keyed) return{correct:0,total:qc,pct:0,noKey:true};
  var correct=0,total=0;
  for(var q=0;q<qc;q++){
    if(!S.key[q]) continue; total++;
    if(det[q]===S.key[q]) correct++;
  }
  return{correct:correct,total:total,pct:Math.round(correct/total*100),noKey:false};
}

function showScore(det){
  var displayAnswers=normalizeAnswers(det,activeQCount());
  var scannedId=S.detectedId||'';
  var displayCount=activeQCount();
  var r=scoreOf(displayAnswers,displayCount);
  var pass=parseInt(document.getElementById('passPct').value)||70;
  var passed=r.pct>=pass;
  var sb=document.getElementById('scoreBig');
  if(r.noKey){
    sb.innerHTML='<div class="scnum">—<sub>/'+activeQCount()+'</sub></div><div class="scpct">No answer key set</div><span class="sctag tnone">SET KEY FIRST</span>';
  } else {
    sb.innerHTML='<div class="scnum">'+r.correct+'<sub>/'+r.total+'</sub></div><div class="scpct">'+r.pct+'%</div><span class="sctag '+(passed?'tpass':'tfail')+'">'+(passed?'✓ PASS':'✗ FAIL')+'</span>';
  }
  var idField=document.getElementById('stuIdField');
  var idStatus=document.getElementById('stuIdStatus');
  if(idField){
    idField.value=scannedId;
    if(idStatus) idStatus.textContent=scannedId?'(detected)':'(not detected)';
  }
  S.rosterMatchIdx=0;
  var allMatches=rosterGetAll(scannedId);
  var rEntry=allMatches[0]||null;
  var lastEl=document.getElementById('stuLast');
  var firstEl=document.getElementById('stuFirst');
  if(lastEl) lastEl.value=rEntry?rEntry.last:'';
  if(firstEl) firstEl.value=rEntry?rEntry.first:'';
  var clsEl=document.getElementById('scanClassName');
  var perEl=document.getElementById('scanPeriod');
  if(rEntry){
    if(clsEl&&rEntry.cls) clsEl.value=rEntry.cls;
    if(perEl&&rEntry.period) perEl.value=rEntry.period;
  }
  var nmBtn=document.getElementById('btnNextMatch');
  if(nmBtn) nmBtn.style.display=allMatches.length>1?'':'none';
  var ag=document.getElementById('ansGrid');
  ag.innerHTML='';
  for(var q=0;q<displayCount;q++){
    var a=displayAnswers[q],k=S.key[q];
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

function nextRosterMatch(){
  var id=(document.getElementById('stuIdField')||{}).value||'';
  id=(id.trim())||S.detectedId||'';
  var all=rosterGetAll(id);
  if(all.length<2) return;
  S.rosterMatchIdx=(S.rosterMatchIdx+1)%all.length;
  var r=all[S.rosterMatchIdx];
  var lastEl=document.getElementById('stuLast');
  var firstEl=document.getElementById('stuFirst');
  if(lastEl) lastEl.value=r.last||'';
  if(firstEl) firstEl.value=r.first||'';
  var clsEl=document.getElementById('scanClassName');
  var perEl=document.getElementById('scanPeriod');
  if(clsEl) clsEl.value=r.cls||'';
  if(perEl) perEl.value=r.period||'';
}

function saveStudent(){
  if(!S.detected) return;
  var typedLast=(document.getElementById('stuLast')||{}).value||''; typedLast=typedLast.trim();
  var typedFirst=(document.getElementById('stuFirst')||{}).value||''; typedFirst=typedFirst.trim();
  var idFieldEl=document.getElementById('stuIdField');
  var studentId=(idFieldEl?idFieldEl.value.trim():'')||S.detectedId||'';
  var rEntry=rosterGet(studentId);
  var name;
  if(typedLast||typedFirst){
    name=typedLast+(typedFirst?(typedLast?', ':'')+typedFirst:'');
  } else {
    name=rEntry?rEntry.last+', '+rEntry.first:(studentId?'ID '+studentId:'Student '+(S.students.length+1));
  }
  var scanClassName=document.getElementById('scanClassName').value.trim();
  var scanPeriod=document.getElementById('scanPeriod').value.trim();
  var answers=blankAnswers();
  for(var i=0;i<activeQCount();i++) answers[i]=S.detected[i]||null;
  var r=scoreOf(answers);
  S.students.push({name:name,studentId:studentId,className:scanClassName,period:scanPeriod,answers:answers,correct:r.correct,total:r.total,pct:r.pct});
  S.pendingScan=null;
  saveData();
  updateHeader();
  var _sl=document.getElementById('stuLast'); if(_sl) _sl.value='';
  var _sf=document.getElementById('stuFirst'); if(_sf) _sf.value='';
  var _idf=document.getElementById('stuIdField'); if(_idf){_idf.value=''; var _ids=document.getElementById('stuIdStatus'); if(_ids) _ids.textContent='';}
  S.rosterMatchIdx=0;
  var _nm=document.getElementById('btnNextMatch'); if(_nm) _nm.style.display='none';
  document.getElementById('imgFile').value='';
  document.getElementById('uploadName').textContent='';
  S.detected=null;
  S.detectedId=null;
  S.rawCanvas=null;
  // Restore input panels so the next photo can be loaded, while keeping result visible
  var isCamera=document.getElementById('mCamera').classList.contains('on');
  document.getElementById('uploadPanel').style.display=isCamera?'none':'';
  document.getElementById('cameraPanel').style.display=isCamera?'':'none';
  if(S.stream){ startVideoPreview(); document.getElementById('btnCap').style.display=''; }
  setSaveButtons(true,'✓ Saved!');
  setAlert('ok','Saved: '+name+(studentId?' (ID '+studentId+')':'')+' — '+r.correct+'/'+r.total+' ('+r.pct+'%). Load next student photo above.');
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
  if(!S.manualMidPts){
    if(S.detectedMidPts){
      S.manualMidPts=S.detectedMidPts.map(function(p){return[p[0],p[1]];});
    } else {
      // Use the homography to predict where ML/MR land in camera space.
      // This respects perspective distortion; linear corner interpolation does not.
      var flr=S.lastRender;
      if(flr&&flr.Hmat){
        S.manualMidPts=[mapPtS(flr.Hmat,88,MID_Y),mapPtS(flr.Hmat,660,MID_Y)];
      } else {
        var t=(MID_Y-TC.TL[1])/(TC.BL[1]-TC.TL[1]);
        var mc=S.manualCorners;
        S.manualMidPts=[
          [mc[0][0]+t*(mc[2][0]-mc[0][0]),mc[0][1]+t*(mc[2][1]-mc[0][1])],
          [mc[1][0]+t*(mc[3][0]-mc[1][0]),mc[1][1]+t*(mc[3][1]-mc[1][1])]
        ];
      }
    }
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

  // Live bubble grid preview — build split H when mid handles are present, else single H
  var sc_=sortCornersVisually(S.manualCorners);
  var pH=null;
  if(S.manualMidPts){
    var sm=S.manualMidPts.slice().sort(function(a,b){return a[0]-b[0];});
    pH=buildSplitH(sc_,sm);
  }
  if(!pH) pH=calcH(ADJ_ORIENTS[S.manualOri],sc_);
  if(pH){
    var dx0=sc_[1][0]-sc_[0][0],dy0=sc_[1][1]-sc_[0][1];
    var camW0=Math.sqrt(dx0*dx0+dy0*dy0);
    var scl=camW0/(TC.TR[0]-TC.TL[0]);
    var pr=Math.max(4,scl*BubR*0.9);
    ctx.strokeStyle='rgba(59,130,246,0.85)';
    ctx.lineWidth=Math.max(1.5,scl*1.5);
    for(var q=0;q<activeQCount();q++){
      for(var c=0;c<5;c++){
        var bpt=bxy(q,c),bcam=mapPtS(pH,bpt[0],bpt[1]);
        if(bcam[0]>0&&bcam[0]<lr.W&&bcam[1]>0&&bcam[1]<lr.H){
          ctx.beginPath(); ctx.arc(bcam[0],bcam[1],pr,0,Math.PI*2); ctx.stroke();
        }
      }
    }
    ctx.strokeStyle='rgba(56,189,248,0.65)';
    ctx.lineWidth=Math.max(1,scl*1.2);
    for(var d=0;d<ID_DIGITS;d++) for(var n=0;n<10;n++){
      var ip=idxy(d,n),icam=mapPtS(pH,ip[0],ip[1]);
      if(icam[0]>0&&icam[0]<lr.W&&icam[1]>0&&icam[1]<lr.H){
        ctx.beginPath(); ctx.arc(icam[0],icam[1],Math.max(3,pr*0.72),0,Math.PI*2); ctx.stroke();
      }
    }
    var omcam=mapPtS(pH,ORI_MARK[0],ORI_MARK[1]);
    if(omcam[0]>0&&omcam[0]<lr.W&&omcam[1]>0&&omcam[1]<lr.H){
      ctx.fillStyle='rgba(255,200,0,0.7)';
      ctx.beginPath(); ctx.arc(omcam[0],omcam[1],pr*1.4,0,Math.PI*2); ctx.fill();
    }
  }

  var dx=S.manualCorners[1][0]-S.manualCorners[0][0],dy=S.manualCorners[1][1]-S.manualCorners[0][1];
  var camW=Math.sqrt(dx*dx+dy*dy);
  var sc=Math.max(0.5,camW/(TC.TR[0]-TC.TL[0]));
  var hr=Math.max(13,sc*13), lw=Math.max(1.5,sc*2);
  // Corner handles — amber
  S.manualCorners.forEach(function(pt){
    ctx.strokeStyle='#f59e0b'; ctx.lineWidth=lw;
    ctx.beginPath(); ctx.arc(pt[0],pt[1],hr,0,Math.PI*2); ctx.stroke();
    ctx.globalAlpha=0.25; ctx.fillStyle='#f59e0b'; ctx.fill(); ctx.globalAlpha=1;
    ctx.beginPath(); ctx.moveTo(pt[0]-hr*1.5,pt[1]); ctx.lineTo(pt[0]+hr*1.5,pt[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pt[0],pt[1]-hr*1.5); ctx.lineTo(pt[0],pt[1]+hr*1.5); ctx.stroke();
  });
  // Mid-row handles — teal, slightly smaller
  if(S.manualMidPts){
    var mhr=hr*0.8, mlw=lw*0.85;
    S.manualMidPts.forEach(function(pt){
      ctx.strokeStyle='#f59e0b'; ctx.lineWidth=mlw;
      ctx.beginPath(); ctx.arc(pt[0],pt[1],mhr,0,Math.PI*2); ctx.stroke();
      ctx.globalAlpha=0.22; ctx.fillStyle='#f59e0b'; ctx.fill(); ctx.globalAlpha=1;
      ctx.beginPath(); ctx.moveTo(pt[0]-mhr*1.5,pt[1]); ctx.lineTo(pt[0]+mhr*1.5,pt[1]); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pt[0],pt[1]-mhr*1.5); ctx.lineTo(pt[0],pt[1]+mhr*1.5); ctx.stroke();
    });
  }
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
  var data=imgData.data; // raw — used for refineHmat / refineHmatWithMarkers
  Hmat=refineHmat(Hmat,data,lr.W,lr.H,sampR);
  Hmat=refineHmatWithMarkers(Hmat,data,lr.W,lr.H,sampR,corners);
  Hmat=refineHmat(Hmat,data,lr.W,lr.H,sampR);
  // Build split H from manual mid-row handles if present
  var splitH=null;
  if(S.manualMidPts&&S.manualMidPts.length===2){
    var sm=S.manualMidPts.slice().sort(function(a,b){return a[0]-b[0];});
    splitH=buildSplitH(corners,sm);
  }
  var activeH=splitH||Hmat;
  var normData=normalizeContrast(data,lr.W,lr.H,60,3.0);
  var idResult=detectStudentId(normData,lr.W,lr.H,activeH,sampR);
  var raw=[],detected=[];
  for(var q=0;q<activeQCount();q++){
    var vals=[];
    var cams5=[];
    for(var c=0;c<5;c++){var pt=bxy(q,c);cams5.push(mapPtS(activeH,pt[0],pt[1]));}
    for(var c=0;c<5;c++) vals.push(fillAt(normData,lr.W,lr.H,cams5[c][0],cams5[c][1],sampR));
    raw.push(vals);
    var ir=Math.max(2,sampR*0.6);
    var scores=[];
    for(var c=0;c<5;c++){var vr=varianceAt(normData,lr.W,lr.H,cams5[c][0],cams5[c][1],ir);scores.push(vals[c]+vr*2.0);}
    var qBase=Math.min.apply(null,scores);
    var mx=0,mxI=0,adjArr=[];
    for(var c=0;c<5;c++){var av=Math.max(0,scores[c]-qBase);adjArr.push(av);if(av>mx){mx=av;mxI=c;}}
    adjArr.sort(function(a,b){return b-a;});
    var second=adjArr[1];
    detected.push(mx<0.04?null:mx-second<0.04&&second>0.04?'?':CH[mxI]);
  }
  S.detected=detected;
  S.detectedId=idResult.id;
  S.detectedCorners=corners.map(function(c){return[c[0],c[1]];});
  S.manualCorners=null;
  S.manualMidPts=null;
  exitAdjustMode(true);
  renderOverlay(lr.srcCanvas,lr.W,lr.H,corners,activeH,sampR,raw,detected);
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

// ── Roster ──
function rosterGet(id){
  var arr=id?S.roster[String(id).trim()]:null;
  if(!arr) return null;
  return Array.isArray(arr)?arr[0]||null:arr;
}

function rosterGetAll(id){
  var arr=id?S.roster[String(id).trim()]:null;
  if(!arr) return [];
  return Array.isArray(arr)?arr:[arr];
}

function rosterHasData(){
  return Object.keys(S.roster).length>0;
}

function rosterOptCols(){
  var cls=false,sec=false,per=false;
  var keys=Object.keys(S.roster);
  outer:for(var i=0;i<keys.length;i++){
    var entries=rosterGetAll(keys[i]);
    for(var j=0;j<entries.length;j++){
      var r=entries[j];
      if(r.cls) cls=true;
      if(r.section) sec=true;
      if(r.period) per=true;
      if(cls&&sec&&per) break outer;
    }
  }
  return{cls:cls,section:sec,period:per};
}

function parseCSVLine(line){
  var cols=[],cur='',inQ=false;
  for(var i=0;i<line.length;i++){
    var ch=line[i];
    if(ch==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}
    else if(ch===','&&!inQ){cols.push(cur);cur='';}
    else cur+=ch;
  }
  cols.push(cur);
  return cols;
}

function importRosterCSV(e){
  var file=e.target.files[0]; if(!file) return;
  var reader=new FileReader();
  reader.onload=function(ev){
    var lines=ev.target.result.trim().split(/\r?\n/).filter(function(l){return l.trim();});
    if(!lines.length){alert('Roster CSV is empty.');return;}
    var headers=parseCSVLine(lines[0]).map(function(h){return h.trim().toLowerCase();});
    var idIdx=headers.indexOf('studentid');
    var lastIdx=headers.indexOf('last');
    var firstIdx=headers.indexOf('first');
    if(idIdx<0||lastIdx<0||firstIdx<0){
      alert('Roster CSV must have StudentID, Last, and First column headers.');
      e.target.value=''; return;
    }
    var clsIdx=headers.indexOf('class');
    var secIdx=headers.indexOf('section');
    var perIdx=headers.indexOf('period');
    var roster={},count=0;
    for(var i=1;i<lines.length;i++){
      var cols=parseCSVLine(lines[i]);
      var id=cols[idIdx]?cols[idIdx].trim():''; if(!id) continue;
      var entry={
        last:  lastIdx>=0&&cols[lastIdx]  ?cols[lastIdx].trim():'',
        first: firstIdx>=0&&cols[firstIdx]?cols[firstIdx].trim():'',
        cls:   clsIdx>=0&&cols[clsIdx]    ?cols[clsIdx].trim():'',
        section:secIdx>=0&&cols[secIdx]   ?cols[secIdx].trim():'',
        period: perIdx>=0&&cols[perIdx]   ?cols[perIdx].trim():''
      };
      if(!roster[id]) roster[id]=[];
      roster[id].push(entry);
      count++;
    }
    S.roster=roster;
    saveData();
    updateRosterUI();
    buildResults();
    e.target.value='';
  };
  reader.readAsText(file);
}

function clearRoster(){
  S.roster={};
  saveData();
  updateRosterUI();
  buildResults();
}

function updateRosterUI(){
  var count=Object.keys(S.roster).length;
  var statusEl=document.getElementById('rosterStatus');
  var clearBtn=document.getElementById('rosterClearBtn');
  if(statusEl) statusEl.textContent=count>0?count+' students loaded':'No roster loaded — upload a CSV with StudentID, Last, First (and optionally Class, Section, Period) to map bubble IDs to student names.';
  if(clearBtn) clearBtn.style.display=count>0?'':'none';
}

// ── Results ──
function buildResults(){
  var has=S.students.length>0;
  document.getElementById('noRes').style.display=has?'none':'';
  document.getElementById('resContent').style.display=has?'':'none';
  if(!has){ var _la=document.getElementById('lastAdded'); if(_la) _la.innerHTML=''; return; }
  var pass=parseInt(document.getElementById('passPct').value)||70;
  var pcts=S.students.map(function(s){return s.pct;});
  var avg=Math.round(pcts.reduce(function(a,b){return a+b;},0)/pcts.length);
  var hi=Math.max.apply(null,pcts), lo=Math.min.apply(null,pcts);
  var passing=pcts.filter(function(p){return p>=pass;}).length;
  document.getElementById('statsRow').innerHTML=
    sc('Average',avg+'%')+sc('Highest',hi+'%')+sc('Lowest',lo+'%')+sc('Pass Rate',Math.round(passing/S.students.length*100)+'%');
  var useRoster=rosterHasData();
  var opt=useRoster?rosterOptCols():{cls:false,section:false,period:false};
  var hasScanClass=S.students.some(function(s){return s.className;});
  var hasScanPeriod=S.students.some(function(s){return s.period;});
  var showClass=hasScanClass||(useRoster&&opt.cls);
  var showSection=useRoster&&opt.section;
  var showPeriod=hasScanPeriod||(useRoster&&opt.period);
  var thead=document.getElementById('resHead');
  if(thead){
    var hcols='<tr><th>#</th>';
    if(useRoster){ hcols+='<th>Last</th><th>First</th>'; }
    else { hcols+='<th>Student</th>'; }
    if(showClass)   hcols+='<th>Class</th>';
    if(showSection) hcols+='<th>Section</th>';
    if(showPeriod)  hcols+='<th>Period</th>';
    hcols+='<th>ID</th><th>Score</th><th>%</th><th>Status</th><th></th></tr>';
    thead.innerHTML=hcols;
  }
  // Last added
  var lastStu=S.students[S.students.length-1];
  var laEl=document.getElementById('lastAdded');
  if(laEl&&lastStu){
    var laR=useRoster?rosterGet(lastStu.studentId):null;
    var laName=laR?(laR.last+', '+laR.first):lastStu.name;
    laEl.innerHTML='Last added: <b>'+esc(laName)+'</b> &nbsp;'+lastStu.correct+'/'+lastStu.total+' ('+lastStu.pct+'%)';
  }
  // Sort display: period → last name → first name (original indices preserved for delete)
  var sorted=S.students.map(function(s,i){
    var r=useRoster?rosterGet(s.studentId):null;
    var per=String(s.period||(r?r.period:'')||'').trim();
    var parts=s.name.indexOf(', ')>=0?s.name.split(', '):['',''];
    var last=(r?r.last:parts[0]).trim().toLowerCase();
    var first=(r?r.first:parts.slice(1).join(', ')).trim().toLowerCase();
    return{s:s,origIdx:i,r:r,per:per,perN:parseFloat(per),last:last,first:first};
  });
  sorted.sort(function(a,b){
    var pna=a.perN,pnb=b.perN;
    if(!isNaN(pna)&&!isNaN(pnb)&&pna!==pnb) return pna-pnb;
    if(a.per!==b.per) return a.per<b.per?-1:1;
    if(a.last!==b.last) return a.last<b.last?-1:1;
    return a.first<b.first?-1:a.first>b.first?1:0;
  });
  var tbody=document.getElementById('resBody'); tbody.innerHTML='';
  sorted.forEach(function(item,di){
    var s=item.s,r=item.r,origIdx=item.origIdx;
    var ok=s.pct>=pass;
    var tr='<tr><td>'+(di+1)+'</td>';
    if(useRoster){
      tr+='<td>'+esc(r?r.last:s.name)+'</td><td>'+esc(r?r.first:'')+'</td>';
    } else {
      tr+='<td style="font-family:inherit">'+esc(s.name)+'</td>';
    }
    if(showClass)   tr+='<td>'+esc(s.className||(r?r.cls:'')||'')+'</td>';
    if(showSection) tr+='<td>'+esc(r?r.section:'')+'</td>';
    if(showPeriod)  tr+='<td>'+esc(s.period||(r?r.period:'')||'')+'</td>';
    tr+='<td>'+(s.studentId?esc(s.studentId):'—')+'</td>';
    tr+='<td>'+s.correct+'/'+s.total+'</td><td>'+s.pct+'%</td>';
    tr+='<td><span class="bdg '+(ok?'bp':'bf')+'">'+(ok?'PASS':'FAIL')+'</span></td>';
    tr+='<td><button class="btn sm" onclick="delStu('+origIdx+')">✕</button></td></tr>';
    tbody.innerHTML+=tr;
  });
  buildAnalytics();
}
function sc(l,v){ return '<div class="scard"><div class="slbl">'+l+'</div><div class="sval">'+v+'</div></div>'; }
function delStu(i){ S.students.splice(i,1); saveData(); updateHeader(); buildResults(); }

function buildAnalytics(){
  var grid=document.getElementById('aqGrid'); grid.innerHTML='';
  var tot=S.students.length; if(!tot) return;
  for(var q=0;q<activeQCount();q++){
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
  var qc=activeQCount();
  var useRoster=rosterHasData();
  var opt=useRoster?rosterOptCols():{cls:false,section:false,period:false};
  var hasScanClass=S.students.some(function(s){return s.className;});
  var hasScanPeriod=S.students.some(function(s){return s.period;});
  var showClass=hasScanClass||(useRoster&&opt.cls);
  var showSection=useRoster&&opt.section;
  var showPeriod=hasScanPeriod||(useRoster&&opt.period);
  var rosterCols='';
  if(useRoster){rosterCols+=',Last,First';}
  if(showClass)   rosterCols+=',Class';
  if(showSection) rosterCols+=',Section';
  if(showPeriod)  rosterCols+=',Period';
  var csv='Student,Student ID'+rosterCols+','+Array.from({length:qc},function(_,i){return 'Q'+(i+1);}).join(',')+',Score,Out of,Percentage\n';
  function qe(v){return '"'+String(v||'').replace(/"/g,'""')+'"';}
  S.students.forEach(function(s){
    var r=useRoster?rosterGet(s.studentId):null;
    var row=qe(s.name)+','+qe(s.studentId||'');
    if(useRoster){row+=','+qe(r?r.last:'')+','+qe(r?r.first:'');}
    if(showClass)   row+=','+qe(s.className||(r?r.cls:'')||'');
    if(showSection) row+=','+qe(r?r.section:'');
    if(showPeriod)  row+=','+qe(s.period||(r?r.period:'')||'');
    row+=','+normalizeAnswers(s.answers,qc).map(function(a){return a===null?'':a;}).join(',')+','+s.correct+','+s.total+','+s.pct+'%';
    csv+=row+'\n';
  });
  csv+='\nQuestion Analytics\nQuestion,A,B,C,D,E,Blank,Key,% Correct\n';
  var tot=S.students.length;
  for(var q=0;q<qc;q++){
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
  var qc=activeQCount();
  var header=Array.from({length:qc},function(_,i){return 'Q'+(i+1);}).join(',');
  var row=S.key.slice(0,qc).map(function(a){return a===null?'':a;}).join(',');
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

    // Horizontal format: one row of 50 or 100 A-E values (possibly preceded by a header row)
    for(var i=0;i<lines.length;i++){
      var cells=lines[i].split(',').map(function(c){return c.trim().toUpperCase();});
      if((cells.length===50||cells.length===100)&&cells.every(function(c){return c===''||c==='A'||c==='B'||c==='C'||c==='D'||c==='E';})){
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
        if(qn>=1&&qn<=100&&(ans===''||'ABCDE'.indexOf(ans)>=0)) map[qn]=ans||null;
      });
      if(Object.keys(map).length>0){
        var maxQ=Math.max.apply(null,Object.keys(map).map(function(k){return parseInt(k);}));
        answers=Array.from({length:maxQ>50?100:50},function(_,i){return map[i+1]||null;});
      }
    }

    if(!answers){
      alert('Could not parse the CSV.\n\nSupported formats:\n• One row of 50 or 100 comma-separated answers (A–E or blank)\n• Two columns: question number, answer (e.g. 1,A)');
      document.getElementById('keyFile').value=''; return;
    }

    S.qCount=answers.length>50?100:50;
    S.key=normalizeAnswers(answers,MAXQ);
    refreshStudentScores();
    buildKeyGrid();
    saveData();
    updateHeader();
    buildResults();
    document.getElementById('keyFile').value='';
    var count=S.key.slice(0,activeQCount()).filter(function(a){return a!==null;}).length;
    alert('Loaded '+count+' of '+activeQCount()+' answers from "'+file.name+'".');
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
updateRosterUI();
buildResults();
document.getElementById('className').addEventListener('input',function(){ updateHeader(); saveData(); });
document.getElementById('passPct').addEventListener('input',function(){ saveData(); buildResults(); });
document.getElementById('scanClassName').addEventListener('input',function(){ saveData(); });
document.getElementById('scanPeriod').addEventListener('input',function(){ saveData(); });
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
    if(S.manualMidPts){
      S.manualMidPts.forEach(function(c,i){
        var dx=c[0]-pt[0],dy=c[1]-pt[1],d=Math.sqrt(dx*dx+dy*dy);
        if(d<bd){bd=d;best=4+i;}
      });
    }
    return best;
  }
  function applyDrag(idx,pt){
    if(idx>=4){
      if(S.manualMidPts) S.manualMidPts[idx-4]=pt;
    } else {
      S.manualCorners[idx]=pt;
    }
  }
  function isAdj(){return document.getElementById('adjControls').style.display!=='none';}
  oc.addEventListener('mousedown',function(e){
    if(!isAdj()) return;
    adjDragging=nearest(getCPt(e.clientX,e.clientY));
  });
  oc.addEventListener('mousemove',function(e){
    if(adjDragging<0) return;
    applyDrag(adjDragging,getCPt(e.clientX,e.clientY));
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
    applyDrag(adjDragging,getCPt(t.clientX,t.clientY));
    redrawHandles();
  },{passive:false});
  oc.addEventListener('touchend',function(){adjDragging=-1;});
})();
