#target premierepro
app.enableQE();

/* Pan/Zoom FIRST V1 clip to each outer_box (from layout_export.json)
   - Scale keys (percent) + Position keys (NORMALIZED [x/W, y/H])
   - Eased travel (fast start, slow end) via multiple keys per move (ease-out)
   - Hold time configurable (now very short)
   - Final move to center box at half zoom, also eased
*/

var JSON_PATH                 = "C:/Users/12038/CryptidCluesScripting/ConspBoardScripting/layout_export.json";

// --- Timing (seconds) ---
var HOLD_BASE_SEC             = 1.0;   // base hold per view
var HOLD_MULTIPLIER           = 0.15;  // << very short holds → 0.15s
var HOLD_SEC                  = HOLD_BASE_SEC * HOLD_MULTIPLIER;

var TRAVEL_SEC                = 1.0;   // time to move between boxes
var CENTER_TRAVEL_S           = 1.0;   // time to move to center at end
var CENTER_HOLD_S             = 0.20;  // << very short final hold

var CENTER_FINAL_SCALE_FACTOR = 0.5;   // half the computed center zoom

// --- Easing resolution & profile ---
var EASE_SAMPLES              = 8;     // number of sub-keys per travel (>=2)
var EASE_PROFILE              = "easeOutCubic"; // "easeOutCubic" | "easeOutQuad" | "smoothstep"

// --- Fallback frame size (if JSON meta.bin missing) ---
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
    var c=trackItem.components[i], dn=c.displayName?(""+c.displayName).toLowerCase():"";
    if (dn==="motion"){ motion=c; break; }
  }
  if(!motion) motion=trackItem.components[0];
  if(!motion) throw new Error("Motion component not found.");
  var pos=null, scl=null;
  for (var j=0;j<motion.properties.numItems;j++){
    var p=motion.properties[j], n=p.displayName?(""+p.displayName).toLowerCase():"";
    if (n==="position") pos=p; else if (n==="scale") scl=p;
  }
  if(!pos) throw new Error("Motion.Position not found.");
  if(!scl) throw new Error("Motion.Scale not found.");
  return { position:pos, scale:scl };
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

// normalized Position helper using scale-aware anchor math
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

// add an eased travel from (cxA, sA) -> (cxB, sB) over [tStart, tStart+dur], producing EASE_SAMPLES keys
function addEasedTravelKeys(props, W, H, cxA, cyA, scaleA, cxB, cyB, scaleB, tStartSec, durSec){
  var N = Math.max(2, Math.floor(EASE_SAMPLES));
  for (var k=0; k<=N; k++){
    var u   = k / N;                          // 0..1
    var ue  = applyEase(u, EASE_PROFILE);     // eased fraction (fast -> slow)
    var cx  = cxA + (cxB - cxA) * ue;
    var cy  = cyA + (cyB - cyA) * ue;
    var sc  = scaleA + (scaleB - scaleA) * ue;

    var t   = tStartSec + durSec * u;
    var pn  = posNormFromCenterScale(cx, cy, W, H, sc);

    addPosKeyNormalized(props.position, t, pn);
    addScaleKey        (props.scale,    t, sc);
  }
}

(function(){
  try{
    if(!app.project) throw new Error("No open project.");
    if(!app.project.activeSequence) throw new Error("No active sequence.");
    var seq = app.project.activeSequence;

    // Load layout
    var data = parseJSON(readFileUTF8(JSON_PATH));
    var bin  = (data.meta && data.meta.bin) ? data.meta.bin : {};
    var W = Math.round(bin.width  || DEFAULT_SEQ_W);
    var H = Math.round(bin.height || DEFAULT_SEQ_H);

    // V1 first clip
    var clip = getFirstClipOnV1(seq);
    var t0   = clip.inPoint.seconds;

    var props = getMotionProps(clip);
    resetTimeVarying(props.position);
    resetTimeVarying(props.scale);

    // Seed sane defaults (prevents 32767 sentinel)
    try { props.position.setValue([0.5, 0.5]); } catch(_e){}
    try { props.scale.setValue(100.0); } catch(_e){}

    var items = data.items || [];
    if(!items.length) throw new Error("No items with outer_box in JSON.");

    var t = 0.0; // timeline seconds from clip inPoint

    // We "start" already on the first view (no intro move): very short hold there
    var firstOB  = items[0].outer_box;
    var firstC   = centerOfRect(firstOB);
    var firstScl = (typeof items[0].zoom_percent==="number") ? Number(items[0].zoom_percent)
                                                             : computeZoomPercent(firstOB, W, H);
    var firstPN  = posNormFromCenterScale(firstC[0], firstC[1], W, H, firstScl);

    // Arrive & tiny hold (two keys so value is explicit)
    addPosKeyNormalized(props.position, t0 + t,             firstPN);
    addScaleKey        (props.scale,    t0 + t,             firstScl);
    addPosKeyNormalized(props.position, t0 + t + HOLD_SEC,  firstPN);
    addScaleKey        (props.scale,    t0 + t + HOLD_SEC,  firstScl);
    t += HOLD_SEC;

    // Track current camera state
    var curCx = firstC[0], curCy = firstC[1], curS = firstScl;

    // For each subsequent item: eased travel then a tiny hold
    for (var i=1; i<items.length; i++){
      var it = items[i], ob = it.outer_box;
      if(!ob || typeof ob.x!=="number"){ log("[SKIP] item "+(i+1)+" no outer_box"); continue; }

      var nextC = centerOfRect(ob);
      var nextS = (typeof it.zoom_percent==="number") ? Number(it.zoom_percent)
                                                      : computeZoomPercent(ob, W, H);

      // EASED TRAVEL
      addEasedTravelKeys(props, W, H, curCx, curCy, curS, nextC[0], nextC[1], nextS, t0 + t, TRAVEL_SEC);
      t += TRAVEL_SEC;

      // TINY HOLD on target
      var pn = posNormFromCenterScale(nextC[0], nextC[1], W, H, nextS);
      addPosKeyNormalized(props.position, t0 + t + HOLD_SEC, pn);
      addScaleKey        (props.scale,    t0 + t + HOLD_SEC, nextS);
      t += HOLD_SEC;

      curCx = nextC[0]; curCy = nextC[1]; curS = nextS;
    }

    // ---- Final move to CENTER BOX (half zoom), eased ----
    var cb = (data.meta && data.meta.central_box) ? data.meta.central_box : null;
    var centerRect = cb && typeof cb.x==="number" ? cb : { x:0, y:0, w:W, h:H };

    var centerC = centerOfRect(centerRect);
    var centerS = computeZoomPercent(centerRect, W, H) * CENTER_FINAL_SCALE_FACTOR;

    addEasedTravelKeys(props, W, H, curCx, curCy, curS, centerC[0], centerC[1], centerS, t0 + t, CENTER_TRAVEL_S);
    t += CENTER_TRAVEL_S;

    // Very short final hold
    var pnC = posNormFromCenterScale(centerC[0], centerC[1], W, H, centerS);
    addPosKeyNormalized(props.position, t0 + t + CENTER_HOLD_S, pnC);
    addScaleKey        (props.scale,    t0 + t + CENTER_HOLD_S, centerS);
    t += CENTER_HOLD_S;

    // Park playhead at end
    try { seq.setPlayerPosition((t0 + t) * 254016000); } catch(_e){}

    alert("Animated "+items.length+" views with VERY SHORT holds.\n" +
          "Hold: "+HOLD_SEC.toFixed(2)+"s • Travel: "+TRAVEL_SEC.toFixed(2)+"s • Easing keys/move: "+EASE_SAMPLES);
  }catch(err){
    alert("Error: " + err.message);
  }
})();
