#target premierepro
app.enableQE();

/* Pan/Zoom FIRST V1 clip to each outer_box (from layout_export.json) 
   + Add "Basic 3D" via QE and set start Swivel = -11
   + Import a still image and place it on V2 above V1, set opacity = 95%
   + Animate Basic 3D Swivel from -11 (t0) to +11 at the final Position key time
*/

var JSON_PATH                 = "C:/Users/12038/CryptidCluesScripting/ConspBoardScripting/layout_export.json";
var OVERLAY_IMAGE_PATH        = "C:/Users/12038/CryptidCluesScripting/ConspBoardScripting/overlay_top.png";

// --- Timing (seconds) ---
var HOLD_BASE_SEC             = 8.0;
var HOLD_MULTIPLIER           = 0.15;
var HOLD_SEC                  = HOLD_BASE_SEC * HOLD_MULTIPLIER;

var TRAVEL_SEC                = 1.5;
var CENTER_TRAVEL_S           = 1.0;
var CENTER_HOLD_S             = 0.20;
var CENTER_FINAL_SCALE_FACTOR = 0.5;

// --- Easing ---
var EASE_SAMPLES              = 8;
var EASE_PROFILE              = "easeOutCubic";

// --- Fallback frame size ---
var DEFAULT_SEQ_W = 1920, DEFAULT_SEQ_H = 1080;

// ---------- helpers ----------
function log(s){ try{$.writeln(s);}catch(_e){} }
function readFileUTF8(p){
  var f=new File(p); if(!f.exists) throw new Error("File not found: "+p);
  f.encoding="UTF8"; if(!f.open("r")) throw new Error("Cannot open: "+p);
  var s=f.read(); f.close(); if(s && s.charCodeAt(0)===0xFEFF) s=s.substr(1); return s;
}
function parseJSON(s){ if (typeof JSON!=='undefined' && JSON.parse) return JSON.parse(s); return eval('('+s+')'); }

function getFirstClipOnV1(seq){
  var v=seq.videoTracks; if(!v || v.numTracks<1) throw new Error("No Video Track 1.");
  var t=v[0]; if(!t.clips || t.clips.numItems<1) throw new Error("V1 has no clips.");
  return t.clips[0];
}
function getMotionProps(trackItem){
  var motion=null;
  for (var i=0;i<trackItem.components.numItems;i++){
    var c=trackItem.components[i], dn=(c.displayName||"")+""; dn=dn.toLowerCase();
    if (dn==="motion"){ motion=c; break; }
  }
  if(!motion) motion=trackItem.components[0];
  if(!motion) throw new Error("Motion component not found.");
  var pos=null, scl=null;
  for (var j=0;j<motion.properties.numItems;j++){
    var p=motion.properties[j], n=(p.displayName||"")+""; n=n.toLowerCase();
    if (n==="position") pos=p; else if (n==="scale") scl=p;
  }
  if(!pos) throw new Error("Motion.Position not found.");
  if(!scl) throw new Error("Motion.Scale not found.");
  return { position:pos, scale:scl };
}
function get3DComponent(clip) {
  if (!clip || !clip.components) return null;
  for (var i = 0; i < clip.components.numItems; i++) {
    var c = clip.components[i];
    if (c && c.displayName === "Basic 3D") return c;
  }
  return null;
}
function getOpacityComponent(clip){
  if (!clip || !clip.components) return null;
  for (var i=0;i<clip.components.numItems;i++){
    var c = clip.components[i];
    if (c && c.displayName === "Opacity") return c;
  }
  return null;
}
function resetTimeVarying(prop){
  try{ if(prop.isTimeVarying && prop.isTimeVarying()) prop.setTimeVarying(false); }catch(_e){}
  try{ prop.setTimeVarying(true); }catch(_e){}
}

function centerOfRect(r){ return [ Number(r.x)+Number(r.w)/2.0, Number(r.y)+Number(r.h)/2.0 ]; }
function computeZoomPercent(ob, W, H){
  var fw=Number(ob.w), fh=Number(ob.h); if(fw<=0||fh<=0) return 100.0;
  var s=Math.max(W/fw, H/fh)*100.0; return (isFinite(s)&&s>0)?s:100.0;
}
function posNormFromCenterScale(cx, cy, W, H, scalePercent){
  var s = Number(scalePercent) / 100.0;
  var frameCx = W/2.0, frameCy = H/2.0;
  var posPxX = frameCx - s * (cx - frameCx);
  var posPxY = frameCy - s * (cy - frameCy);
  return [ posPxX / W, posPxY / H ];
}

// seconds-based key writers
function addPosKeyNormalized(prop, timeSec, posNormArr){
  prop.addKey(timeSec);
  prop.setValueAtKey(timeSec, [ Number(posNormArr[0]), Number(posNormArr[1]) ], true);
}
function addScaleKey(prop, timeSec, percent){
  prop.addKey(timeSec);
  prop.setValueAtKey(timeSec, Number(percent), true);
}

// easing functions
function easeOutCubic(u){ u = Math.max(0, Math.min(1, u)); return 1 - Math.pow(1 - u, 3); }
function easeOutQuad(u){  u = Math.max(0, Math.min(1, u)); return 1 - (1 - u)*(1 - u); }
function smoothstep(u){   u = Math.max(0, Math.min(1, u)); return u*u*(3 - 2*u); }
function applyEase(u, profile){
  switch(profile){
    case "easeOutQuad":   return easeOutQuad(u);
    case "smoothstep":    return smoothstep(u);
    case "easeOutCubic":
    default:              return easeOutCubic(u);
  }
}

// add eased travel keys
function addEasedTravelKeys(props, W, H, cxA, cyA, scaleA, cxB, cyB, scaleB, tStartSec, durSec){
  var N = Math.max(2, Math.floor(EASE_SAMPLES));
  for (var k=0; k<=N; k++){
    var u   = k / N;
    var ue  = applyEase(u, EASE_PROFILE);
    var cx  = cxA + (cxB - cxA) * ue;
    var cy  = cyA + (cyB - cyA) * ue;
    var sc  = scaleA + (scaleB - scaleA) * ue;

    var t   = tStartSec + durSec * u;
    var pn  = posNormFromCenterScale(cx, cy, W, H, sc);

    addPosKeyNormalized(props.position, t, pn);
    addScaleKey        (props.scale,    t, sc);
  }
}

// ------- Basic 3D via QE (ensure present) -------
function ensureBasic3DWithSwivel_QE(trackItem, swivelValue){
  app.enableQE();
  var qeSeq   = qe.project.getActiveSequence();
  var qeVTrack= qeSeq.getVideoTrackAt(0);          // V1
  var qeItem  = qeVTrack.getItemAt(0);             // first clip on V1
  var fx3D    = qe.project.getVideoEffectByName("Basic 3D");
  if (fx3D){ qeItem.addVideoEffect(fx3D); }
  // set an initial static value; we'll keyframe properly later
  var basic3D = get3DComponent(trackItem);
  if (basic3D && basic3D.properties && basic3D.properties.numItems>0){
    try{ basic3D.properties[0].setValue(swivelValue); }catch(e){}
  }
}

// ------- Animate Basic 3D Swivel from v0@tStart to v1@tEnd -------
function setBasic3DSwivelKeys(trackItem, tStart, tEnd, vStart, vEnd){
  var comp = get3DComponent(trackItem);
  if (!comp){
    // If effect didn't attach for some reason, try once to add again via QE:
    ensureBasic3DWithSwivel_QE(trackItem, vStart);
    comp = get3DComponent(trackItem);
  }
  if (!comp || !comp.properties || comp.properties.numItems < 1){
    throw new Error("Basic 3D component or Swivel property not found.");
  }

  // Find Swivel property (usually index 0), but be robust.
  var swivel = comp.properties[0];
  try {
    // Try to match by name if available
    for (var i=0;i<comp.properties.numItems;i++){
      var p = comp.properties[i];
      if (p && (p.displayName === "Swivel" || (""+p.displayName).toLowerCase().indexOf("swivel")>=0)){
        swivel = p; break;
      }
    }
  }catch(_e){}

  // Make it time-varying and write two keys
  resetTimeVarying(swivel);
  swivel.addKey(tStart);
  swivel.setValueAtKey(tStart, Number(vStart), true);
  swivel.addKey(tEnd);
  swivel.setValueAtKey(tEnd,   Number(vEnd),   true);
}

// ------- Import/find & place overlay on V2 -------
function normalizeFsPath(p){ return (""+p).replace(/\\/g,"/").toLowerCase(); }
function findProjectItemByPath(fsPath){
  var target = normalizeFsPath(fsPath);
  function walk(bin){
    if (!bin || !bin.children) return null;
    for (var i=0;i<bin.children.numItems;i++){
      var it = bin.children[i];
      try{
        if (it && it.getMediaPath){
          var mp = normalizeFsPath(it.getMediaPath());
          if (mp === target) return it;
        }
      }catch(_e){}
      try{ if (it && it.children && it.children.numItems>0){ var sub = walk(it); if (sub) return sub; } }catch(_e2){}
    }
    return null;
  }
  return walk(app.project.rootItem);
}
function importIfNeeded(fsPath){
  var it = findProjectItemByPath(fsPath);
  if (it) return it;
  var ok = app.project.importFiles([fsPath], false, app.project.rootItem, false);
  if (!ok) throw new Error("Import failed: "+fsPath);
  it = findProjectItemByPath(fsPath);
  if (!it) throw new Error("Imported item not found in Project panel: "+fsPath);
  return it;
}
function placeOverlayOnV2AboveV1(seq, overlayPath, v1Clip){
  if (seq.videoTracks.numTracks < 2){
    try{
      if (seq.addTracks) seq.addTracks(1, 0);
      else {
        var qeSeq = qe.project.getActiveSequence();
        if (qeSeq && qeSeq.addTracks) qeSeq.addTracks(1, 0);
      }
    }catch(e){}
  }
  if (seq.videoTracks.numTracks < 2) throw new Error("Unable to create/access V2.");
  var v2 = seq.videoTracks[1];

  var overlayItem = importIfNeeded(overlayPath);
  var tStartSec = (v1Clip && v1Clip.start && typeof v1Clip.start.seconds==="number") ? v1Clip.start.seconds : 0.0;
  var tObj = new Time(); tObj.seconds = tStartSec;

  var insertedOK = v2.insertClip(overlayItem, tObj);
  if (!insertedOK){ throw new Error("Could not insert overlay on V2 at "+tStartSec.toFixed(3)+"s."); }

  var overlayTrackItem = null;
  var wantPath = normalizeFsPath(overlayPath);
  for (var i=0;i<v2.clips.numItems;i++){
    var c = v2.clips[i];
    try{
      var mp = c.projectItem ? normalizeFsPath(c.projectItem.getMediaPath()) : "";
      var st = (c.start && typeof c.start.seconds==="number") ? c.start.seconds : -1;
      if (mp === wantPath && Math.abs(st - tStartSec) < 1e-3){
        overlayTrackItem = c; break;
      }
    }catch(_e){}
  }
  if (!overlayTrackItem){
    overlayTrackItem = v2.clips[v2.clips.numItems-1];
  }

  try{
    var v1DurSec = v1Clip.duration.seconds;
    var desiredOut = (overlayTrackItem.inPoint ? overlayTrackItem.inPoint.seconds : 0) + v1DurSec;
    if (overlayTrackItem.setOutPoint) overlayTrackItem.setOutPoint(desiredOut, 1);
  }catch(_eTrim){}

  return overlayTrackItem;
}
function setClipStaticOpacity(trackItem, percent){
  var comp = getOpacityComponent(trackItem);
  if (!comp || !comp.properties || comp.properties.numItems < 1){
    throw new Error("Opacity component not found on overlay clip.");
  }
  var prop = comp.properties[0];
  try{ if (prop.isTimeVarying && prop.isTimeVarying()) prop.setTimeVarying(false); }catch(_e){}
  try{ prop.setValue(Number(percent), 1); }catch(e){ try{ prop.setValue(Number(percent)); }catch(e2){ throw e2; } }
}

// ------------------------------- MAIN --------------------------------
(function(){
  try{
    if(!app.project) throw new Error("No open project.");
    if(!app.project.activeSequence) throw new Error("No active sequence.");
    var seq = app.project.activeSequence;

    var data = parseJSON(readFileUTF8(JSON_PATH));
    var bin  = (data.meta && data.meta.bin) ? data.meta.bin : {};
    var W = Math.round(bin.width  || DEFAULT_SEQ_W);
    var H = Math.round(bin.height || DEFAULT_SEQ_H);

    var clip = getFirstClipOnV1(seq);
    var t0   = clip.inPoint.seconds;

    // Ensure Basic 3D present and set initial swivel
    ensureBasic3DWithSwivel_QE(clip, -11);

    // Overlay on V2 at 95% opacity
    var overlayClip = placeOverlayOnV2AboveV1(seq, OVERLAY_IMAGE_PATH, clip);
    setClipStaticOpacity(overlayClip, 95);

    // Motion props for V1
    var props = getMotionProps(clip);
    resetTimeVarying(props.position);
    resetTimeVarying(props.scale);
    try { props.position.setValue([0.5, 0.5]); } catch(_e){}
    try { props.scale.setValue(100.0); } catch(_e){}

    var items = data.items || [];
    if(!items.length) throw new Error("No items with outer_box in JSON.");

    var t = 0.0;

    // First view
    var firstOB  = items[0].outer_box;
    var firstC   = centerOfRect(firstOB);
    var firstScl = (typeof items[0].zoom_percent==="number") ? Number(items[0].zoom_percent)
                                                             : computeZoomPercent(firstOB, W, H);
    var firstPN  = posNormFromCenterScale(firstC[0], firstC[1], W, H, firstScl);

    addPosKeyNormalized(props.position, t0 + t,             firstPN);
    addScaleKey        (props.scale,    t0 + t,             firstScl);
    addPosKeyNormalized(props.position, t0 + t + HOLD_SEC,  firstPN);
    addScaleKey        (props.scale,    t0 + t + HOLD_SEC,  firstScl);
    t += HOLD_SEC;

    var curCx = firstC[0], curCy = firstC[1], curS = firstScl;

    // Subsequent moves
    for (var i=1; i<items.length; i++){
      var it = items[i], ob = it.outer_box;
      if(!ob || typeof ob.x!=="number"){ log("[SKIP] item "+(i+1)+" no outer_box"); continue; }

      var nextC = centerOfRect(ob);
      var nextS = (typeof it.zoom_percent==="number") ? Number(it.zoom_percent)
                                                      : computeZoomPercent(ob, W, H);

      addEasedTravelKeys(props, W, H, curCx, curCy, curS, nextC[0], nextC[1], nextS, t0 + t, TRAVEL_SEC);
      t += TRAVEL_SEC;

      var pn = posNormFromCenterScale(nextC[0], nextC[1], W, H, nextS);
      addPosKeyNormalized(props.position, t0 + t + HOLD_SEC, pn);
      addScaleKey        (props.scale,    t0 + t + HOLD_SEC, nextS);
      t += HOLD_SEC;

      curCx = nextC[0]; curCy = nextC[1]; curS = nextS;
    }

    // Final move to center (half zoom)
    var cb = (data.meta && data.meta.central_box) ? data.meta.central_box : null;
    var centerRect = cb && typeof cb.x==="number" ? cb : { x:0, y:0, w:W, h:H };

    var centerC = centerOfRect(centerRect);
    var centerS = computeZoomPercent(centerRect, W, H) * CENTER_FINAL_SCALE_FACTOR;

    addEasedTravelKeys(props, W, H, curCx, curCy, curS, centerC[0], centerC[1], centerS, t0 + t, CENTER_TRAVEL_S);
    t += CENTER_TRAVEL_S;

    var pnC = posNormFromCenterScale(centerC[0], centerC[1], W, H, centerS);
    // NOTE: this is the "final position keyframe" moment we want for the 3D swivel end key:
    var finalPosKeyTimeSec = t0 + t + CENTER_HOLD_S;

    addPosKeyNormalized(props.position, finalPosKeyTimeSec, pnC);
    addScaleKey        (props.scale,    finalPosKeyTimeSec, centerS);
    t += CENTER_HOLD_S;

    // Now animate Basic 3D Swivel from -11 at start to +11 at the final position key time
    setBasic3DSwivelKeys(clip, t0, finalPosKeyTimeSec, -11, +11);

    try { seq.setPlayerPosition((t0 + t) * 254016000); } catch(_e){}

    alert("Animated "+items.length+" views + overlay on V2 (95% opacity) + Basic 3D Swivel keys: -11 @ start → +11 @ final position time.");
  }catch(err){
    alert("Error: " + err.message);
  }
})();
