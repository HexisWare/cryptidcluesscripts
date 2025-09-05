#target photoshop
app.bringToFront();

/*
  Layout-from-JSON builder for Photoshop

  TXT format per item (blocks detected by next filename; blank lines in body are preserved):
    Line 1: <filename.ext>
    Line 2: <Title>
    Line 3..until next filename (or EOF): Body text (multi-line; keeps ALL blank lines)

  Stacking strategy to satisfy "titles never covered by other groups’ boxes":
    • All TitleCard_* groups are collected into a root group: "TitleCards (Global)".
    • After ALL placement, we move TitleCards (Global) to the very top,
      then move Pins and Links back to top (so Pins/Links remain above titles).
    • Result: Titles are always above every item/center layer, below pins/links.

  Rotations:
    • Item group gets outer slight rotation.
    • Sub-groups (TextGroup, ImageGroup, TitleCard) get tiny independent rotation.
    • TitleCard gets the same outer rotation as its item group (applied separately),
      so it stays visually aligned after being moved to the global stack.

  Title fitting:
    • After best-fit, shrink by N steps to avoid kissing edges.
*/

// ===== CONFIG =====
var JSON_PATH = "C:/Users/12038/CryptidCluesScripting/ConspBoardScripting/layout_export.json";

// Underlay (lower card)
var UNDER_FILL_RGB = [240, 240, 240];
var UNDER_OPACITY  = 100;

// Text box (stroke-only guide; stays hidden)
var TEXT_STROKE_RGB = [0, 0, 0];
var TEXT_STROKE_PX  = 2;

// Body text styling / fit (for text_box)
var TEXT_COLOR_RGB      = [0, 0, 0];
var TEXT_ALIGN          = Justification.LEFT;
var TEXT_MIN_PT         = 6;
var TEXT_MAX_PT         = 72;
var TEXT_STEP_PT        = 1;
var TEXT_LEADING_MULT   = 1.15;
var TEXT_TRACKING_START = 0;
var TEXT_TRACKING_MIN   = -100;
var TEXT_TRACKING_STEP  = 10;
var FIT_TOL_PX          = 1;

// Title background + text styling / fit (for title_box)
var TITLE_BG_RGB         = [255, 255, 255];
var TITLE_BG_OPACITY     = 100;
var TITLE_COLOR_RGB      = [220, 30, 30];
var TITLE_ALIGN          = Justification.CENTER;
var TITLE_MIN_PT         = 8;
var TITLE_MAX_PT         = 96;
var TITLE_STEP_PT        = 1;
var TITLE_LEADING_MULT   = 1.10;
var TITLE_TRACKING_START = 0;
var TITLE_TRACKING_MIN   = -100;
var TITLE_TRACKING_STEP  = 10;

// Nudge title smaller after fit
var TITLE_SHRINK_STEPS_AFTER_FIT = 2; // 1–2 recommended

// Preferred fonts
var TEXT_FONT_PREFS  = [
  "SecretServiceTypewriterRR-Regular",
  "SecretServiceTypewriter-Regular",
  "SecretServiceTypewriterRegular",
  "SecretServiceTypewriter",
  "ArialMT"
];
var TITLE_FONT_PREFS = TEXT_FONT_PREFS;

// Grouping
var GROUP_PER_ITEM = true;
var GLOBAL_TITLE_GROUP_NAME = "TitleCards (Global)";

// Center image (fallback)
var CENTER_IMAGE_PATH = "D:/Youtube/CryptidClues/Channel Art/CenterCard.png";
var CENTER_W = 320, CENTER_H = 180;
var CENTER_GROUP_NAME = "Center";

// Pins (tack images)
var TACKS_DIR = "C:/Users/12038/CryptidCluesScripting/ConspBoardScripting/tacks/";
var TACK_ALLOWED_EXTS = ['.png', '.jpg', '.jpeg', '.PNG', '.JPG', '.JPEG'];
var TACK_SIZE_PX = 28;
var TACKS_GROUP_NAME = "Pins";

// Links (between pins)
var LINKS_GROUP_NAME = "Links";
var LINK_RGB = [255, 16, 16];
var LINK_OPACITY = 90;
var LINK_WIDTH_PX = 2;

// Drop Shadow
var DS_ANGLE = 150;         // deg
var DS_DISTANCE = 3;        // px
var DS_SIZE = 5;            // px
var DS_OPACITY = 75;        // %
var DS_COLOR = [0, 0, 0];   // black

// Rotations
var ROTATE_ITEMS    = true;
var ROTATE_MIN_ABS  = 1.5;  // deg
var ROTATE_MAX_ABS  = 6.0;  // deg
var SUBROTATE_ITEMS   = true;
var SUBROTATE_MIN_ABS = 0.5; // deg
var SUBROTATE_MAX_ABS = 2.0; // deg
// =================

// Enum fallbacks
if (typeof StrokeLocation   === 'undefined') var StrokeLocation   = { INSIDE:'Inside', CENTER:'Center', OUTSIDE:'Outside' };
if (typeof ColorBlendMode   === 'undefined') var ColorBlendMode   = { NORMAL:'Normal' };
if (typeof AnchorPosition   === 'undefined') var AnchorPosition   = { MIDDLECENTER:'MdCm' };
if (typeof TextType         === 'undefined') var TextType         = { PARAGRAPHTEXT:'box', POINTTEXT:'point' };
if (typeof Justification    === 'undefined') var Justification    = { LEFT:'Left', CENTER:'Cntr', RIGHT:'Rght', FULLYJUSTIFIED:'Jstf' };

// Units
var savedRuler = app.preferences.rulerUnits; app.preferences.rulerUnits = Units.PIXELS;

// ---------- helpers ----------
function trimStr(s){ if (s===undefined || s===null) return ""; return (""+s).replace(/^\s+|\s+$/g,""); }
function readFileAsString(path){ var f=new File(path); if(!f.exists) throw new Error("JSON not found: "+path); f.encoding="UTF8"; if(!f.open("r")) throw new Error("Cannot open JSON: "+path); var s=f.read(); f.close(); if(s && s.charCodeAt(0)===0xFEFF) s=s.substr(1); return s; }
function parseJSON(str){ if (typeof JSON!=='undefined' && JSON.parse) return JSON.parse(str); return eval('('+str+')'); }
function makeSolidColor(r,g,b){ var c=new SolidColor(); c.rgb.red=r; c.rgb.green=g; c.rgb.blue=b; return c; }
function psNewlines(s){ return (s || "").replace(/\r\n|\n|\r/g, "\r"); }

function selectRect(doc,x,y,w,h){ var r=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]; doc.selection.select(r); }
function fillSelectionOnNewLayer(doc,name,colorRGB,opacityPct){ var layer=doc.artLayers.add(); layer.name=name; layer.kind=LayerKind.NORMAL; layer.opacity=(typeof opacityPct==="number")?opacityPct:100; var col=makeSolidColor(colorRGB[0],colorRGB[1],colorRGB[2]); doc.selection.fill(col,ColorBlendMode.NORMAL,100,false); doc.selection.deselect(); return layer; }
function strokeSelectionOnNewLayer(doc,name,colorRGB,strokePx){ var layer=doc.artLayers.add(); layer.name=name; layer.kind=LayerKind.NORMAL; var col=makeSolidColor(colorRGB[0],colorRGB[1],colorRGB[2]); doc.selection.stroke(col,strokePx,StrokeLocation.INSIDE,ColorBlendMode.NORMAL,100,false); doc.selection.deselect(); return layer; }

function boundsToWH(b){ return { x:b[0].as("px"), y:b[1].as("px"), w:(b[2].as("px")-b[0].as("px")), h:(b[3].as("px")-b[1].as("px")) }; }

function placeImageAsLayerFitRect(targetDoc, imgPath, rect, layerName){
  var srcFile=new File(imgPath); if(!srcFile.exists) throw new Error("Image file missing: "+imgPath);
  var srcDoc=app.open(srcFile);
  var baseLayer=srcDoc.layers[0]; baseLayer.name=layerName||srcFile.name;
  baseLayer.duplicate(targetDoc, ElementPlacement.PLACEATBEGINNING);
  var placed=targetDoc.activeLayer;
  srcDoc.close(SaveOptions.DONOTSAVECHANGES);

  var b=boundsToWH(placed.bounds); if(b.w<=0||b.h<=0) throw new Error("Invalid layer bounds after duplicate: "+imgPath);
  var scale=Math.min((rect.w/b.w)*100.0,(rect.h/b.h)*100.0);
  placed.resize(scale,scale,AnchorPosition.MIDDLECENTER);
  b=boundsToWH(placed.bounds);
  var layerCx=b.x+b.w/2.0, layerCy=b.y+b.h/2.0, rectCx=rect.x+rect.w/2.0, rectCy=rect.y+rect.h/2.0;
  placed.translate(rectCx-layerCx, rectCy-layerCy);
  placed.name=layerName||srcFile.name;
  return placed;
}

function ensureActiveDocMatchesBin(doc,binW,binH){ var w=doc.width.as("px"), h=doc.height.as("px"); if (Math.round(w)!==Math.round(binW)||Math.round(h)!==Math.round(binH)) alert("Warning: Active document is "+w+"×"+h+" but JSON bin is "+binW+"×"+binH+". Proceeding with JSON coordinates."); }
function fileExists(p){ return (new File(p)).exists; }
function listImageFiles(folderPath, allowed){ var folder=new Folder(folderPath); if(!folder.exists) return []; var all=folder.getFiles(), out=[]; for(var i=0;i<all.length;i++){ var f=all[i]; if(!(f instanceof File)) continue; var dot=f.name.lastIndexOf('.'); var ext=(dot>=0?f.name.slice(dot):''); for(var k=0;k<allowed.length;k++){ if(ext.toLowerCase()===allowed[k].toLowerCase()){ out.push(f); break; } } } return out; }

// ---- Drop Shadow on active layer (group or layer) ----
function applyDropShadowToActive(angleDeg, distancePx, sizePx, opacityPct, colorRGB){
  var c2t=charIDToTypeID, s2t=stringIDToTypeID;
  var desc=new ActionDescriptor(), ref=new ActionReference();
  ref.putEnumerated(c2t('Lyr '), c2t('Ordn'), c2t('Trgt')); desc.putReference(c2t('null'), ref);
  var fx=new ActionDescriptor(), ds=new ActionDescriptor();

  ds.putBoolean(s2t('enabled'), true);
  ds.putBoolean(s2t('present'), true);
  ds.putBoolean(s2t('showInDialog'), true);
  ds.putEnumerated(s2t('mode'), s2t('blendMode'), s2t('multiply'));

  var col=new ActionDescriptor();
  col.putDouble(c2t('Rd  '), colorRGB[0]); col.putDouble(c2t('Grn '), colorRGB[1]); col.putDouble(c2t('Bl  '), colorRGB[2]);
  ds.putObject(s2t('color'), s2t('RGBColor'), col);

  ds.putUnitDouble(s2t('opacity'), c2t('#Prc'), opacityPct);
  ds.putBoolean(s2t('useGlobalAngle'), false);
  ds.putUnitDouble(s2t('localLightingAngle'), c2t('#Ang'), angleDeg);
  ds.putUnitDouble(s2t('distance'), c2t('#Pxl'), distancePx);
  ds.putUnitDouble(s2t('chokeMatte'), c2t('#Pxl'), 0);
  ds.putUnitDouble(s2t('blur'), c2t('#Pxl'), sizePx);
  ds.putBoolean(s2t('antiAlias'), false);

  fx.putObject(s2t('dropShadow'), s2t('dropShadow'), ds);
  desc.putObject(c2t('T   '), s2t('layerEffects'), fx);
  executeAction(c2t('setd'), desc, DialogModes.NO);
}
function applyDropShadowToGroup(group){ var prev=app.activeDocument.activeLayer; app.activeDocument.activeLayer=group; applyDropShadowToActive(DS_ANGLE,DS_DISTANCE,DS_SIZE,DS_OPACITY,DS_COLOR); app.activeDocument.activeLayer=prev; }

// ---------- center image ----------
function placeCenterImage(doc, data, binW, binH){
  var cx,cy,cw,ch,cpath, useJson=false;
  if (data.meta && data.meta.central_box){
    var cb=data.meta.central_box;
    if (cb && typeof cb.x==="number" && typeof cb.y==="number" && typeof cb.w==="number" && typeof cb.h==="number"){
      cx=cb.x; cy=cb.y; cw=cb.w; ch=cb.h; cpath=cb.image_path || CENTER_IMAGE_PATH; useJson=true;
    }
  }
  if (!useJson){ cw=CENTER_W; ch=CENTER_H; cx=Math.round((binW-cw)/2); cy=Math.round((binH-ch)/2); cpath=CENTER_IMAGE_PATH; }
  if (!fileExists(cpath)){ $.writeln("Center image missing: "+cpath+" — skipping center placement."); return null; }

  var group=doc.layerSets.add(); group.name=CENTER_GROUP_NAME;
  var layer=placeImageAsLayerFitRect(doc, cpath, {x:cx,y:cy,w:cw,h:ch}, "CenterImage");
  layer.move(group, ElementPlacement.INSIDE);
  try{ layer.move(group, ElementPlacement.PLACEATBEGINNING); }catch(e){}
  applyDropShadowToGroup(group);
  return group;
}

// ---------- links (raster quads) ----------
function drawConnectorLine(doc,x1,y1,x2,y2,widthPx,colorRGB,opacityPct,name){
  var dx=x2-x1, dy=y2-y1, len=Math.sqrt(dx*dx+dy*dy); if(len<0.001) return null;
  var nx=-dy/len, ny=dx/len, hw=widthPx/2.0;
  var poly=[[Math.round(x1+nx*hw),Math.round(y1+ny*hw)],[Math.round(x2+nx*hw),Math.round(y2+ny*hw)],[Math.round(x2-nx*hw),Math.round(y2-ny*hw)],[Math.round(x1-nx*hw),Math.round(y1-ny*hw)]];
  var layer=doc.artLayers.add(); layer.name=name||"Link"; layer.kind=LayerKind.NORMAL; layer.opacity=(typeof opacityPct==="number")?opacityPct:100;
  var col=makeSolidColor(LINK_RGB[0],LINK_RGB[1],LINK_RGB[2]); doc.selection.select(poly); doc.selection.fill(col,ColorBlendMode.NORMAL,100,false); doc.selection.deselect();
  return layer;
}
function drawLinksBetweenPins(doc,data){
  var pins = (data.pins && data.pins.length) ? data.pins : (data.tack_points || []);
  var links=data.links||[]; if(!pins.length||!links.length){ $.writeln("No pins or links in JSON — skipping link drawing."); return null; }
  var g=doc.layerSets.add(); g.name=LINKS_GROUP_NAME;
  for (var i=0;i<links.length;i++){
    var pair=links[i]; if(!pair||pair.length<2) continue;
    var a=parseInt(pair[0],10), b=parseInt(pair[1],10);
    if(isNaN(a)||isNaN(b)||a<0||a>=pins.length||b<0||b>=pins.length) continue;
    var pA=pins[a], pB=pins[b];
    var x1=parseFloat(pA.x), y1=parseFloat(pA.y), x2=parseFloat(pB.x), y2=parseFloat(pB.y);
    if(isNaN(x1)||isNaN(y1)||isNaN(x2)||isNaN(y2)) continue;
    try{ var line=drawConnectorLine(doc,x1,y1,x2,y2,LINK_WIDTH_PX,LINK_RGB,LINK_OPACITY,"Link_"+(a+1)+"_"+(b+1)); if(line) line.move(g,ElementPlacement.INSIDE); }catch(e){ $.writeln("Link fail: "+e.message); }
  }
  applyDropShadowToGroup(g);
  try{ g.move(doc, ElementPlacement.PLACEATBEGINNING); }catch(eTop){}
  return g;
}

// ---------- pins ----------
function placeTacksAtPins(doc,data){
  var pins = (data.pins && data.pins.length) ? data.pins : (data.tack_points || []);
  if(!pins.length){ $.writeln("No pins in JSON — skipping tack placement."); return null; }

  var tackFiles=listImageFiles(TACKS_DIR, TACK_ALLOWED_EXTS);
  $.writeln("Pins: "+pins.length+" | Tack files found: "+tackFiles.length+" in "+TACKS_DIR);
  var g=doc.layerSets.add(); g.name=TACKS_GROUP_NAME;
  try{ g.move(doc, ElementPlacement.PLACEATBEGINNING); }catch(e){}

  if (!tackFiles.length){
    for (var i=0;i<pins.length;i++){
      var p=pins[i], cx=parseFloat(p.x), cy=parseFloat(p.y);
      if(isNaN(cx)||isNaN(cy)) continue;
      var r=Math.max(5, Math.min(12, Math.round(TACK_SIZE_PX/2)));
      var pts=[]; for (var k=0;k<12;k++){ var t=(Math.PI*2*k)/12; pts.push([Math.round(cx+r*Math.cos(t)), Math.round(cy+r*Math.sin(t))]); }
      var lyr=doc.artLayers.add(); lyr.name="Pin_"+(i+1); var col=makeSolidColor(255,16,16);
      doc.selection.select(pts); doc.selection.fill(col, ColorBlendMode.NORMAL, 100, false); doc.selection.deselect();
      lyr.move(g, ElementPlacement.INSIDE);
    }
    applyDropShadowToGroup(g);
    try{ g.move(doc, ElementPlacement.PLACEATBEGINNING); }catch(eTop2){}
    return g;
  }

  for (var j=0;j<pins.length;j++){
    var q=pins[j], x=parseFloat(q.x), y=parseFloat(q.y);
    if(isNaN(x)||isNaN(y)) continue;
    var f=tackFiles[Math.floor(Math.random()*tackFiles.length)];
    var rect={ x:Math.round(x-TACK_SIZE_PX/2), y:Math.round(y-TACK_SIZE_PX/2), w:TACK_SIZE_PX, h:TACK_SIZE_PX };
    try{
      var tack=placeImageAsLayerFitRect(doc, f.fsName, rect, "Pin_"+(j+1));
      tack.move(g, ElementPlacement.INSIDE);
      try{ tack.move(g, ElementPlacement.PLACEATBEGINNING); }catch(eMove){}
    }catch(ePlace){ $.writeln("Pin "+(j+1)+" failed: "+ePlace.message); }
  }
  applyDropShadowToGroup(g);
  try{ g.move(doc, ElementPlacement.PLACEATBEGINNING); }catch(eTop3){}
  return g;
}

// ---------- NAMES TXT ----------
function deriveNamesTxtPath(jsonPath){
  var jf = new File(jsonPath);
  var p = jf.fsName;
  if (/\.json$/i.test(p)) return p.replace(/\.json$/i, "_names.txt");
  return p + "_names.txt";
}
function baseName(pathStr){
  if (!pathStr) return "";
  var a = pathStr.toString().split(/[\\\/]/);
  return a[a.length-1];
}
function buildKnownNameSet(items){
  var set = {};
  for (var i=0;i<items.length;i++){
    var p = items[i].image_path || "";
    var b = baseName(p).toLowerCase();
    if (b) set[b] = true;
  }
  return set;
}
function looksLikeImageFilename(s){
  return /\.(png|jpe?g|gif|tiff?|bmp|webp)$/i.test(s||"");
}
function readNamesMapTitleBody(namesPath, knownSet){
  var f = new File(namesPath);
  var map = {}; var count = 0;
  if (!f.exists){ $.writeln("[names] Not found: " + namesPath); return map; }
  f.encoding = "UTF8";
  if (!f.open("r")){ $.writeln("[names] Cannot open: " + namesPath); return map; }
  var raw = f.read(); f.close();
  var lines = (raw || "").replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n");

  function isFilenameLine(line){
    var t = trimStr(line).toLowerCase();
    if (!t) return false;
    if (knownSet && knownSet[t]) return true;
    return looksLikeImageFilename(t);
  }

  var i = 0, L = lines.length;
  while (i < L){
    while (i < L && !isFilenameLine(lines[i])) i++;
    if (i >= L) break;

    var name = trimStr(lines[i]); i++;

    var title = "";
    if (i < L && !isFilenameLine(lines[i])){
      title = trimStr(lines[i]);
      i++;
    }

    var startBody = i;
    while (i < L && !isFilenameLine(lines[i])) i++;
    var bodyLines = lines.slice(startBody, i);
    var body = bodyLines.join("\n"); // preserve blank lines

    map[name.toLowerCase()] = { title: title, desc: body };
    count++;
  }

  $.writeln("[names] Loaded " + count + " (title+body blocks) from " + namesPath);
  return map;
}

// ---------- measure & fit ----------
function measureLayerPx(layer){
  var b = layer.bounds;
  return { w:(b[2].as("px") - b[0].as("px")), h:(b[3].as("px") - b[1].as("px")) };
}
function layerFitsRect(layer, rectW, rectH){
  app.refresh(); $.sleep(10);
  var m = measureLayerPx(layer);
  return (m.w <= rectW + FIT_TOL_PX) && (m.h <= rectH + FIT_TOL_PX);
}

// ---------- font helpers ----------
function trySetFontFromList(textItem, names){
  if (!names || !names.length) return null;
  for (var i=0;i<names.length;i++){
    var nm = names[i];
    try {
      textItem.font = nm;
      if (textItem.font === nm) {
        $.writeln("[font] Using: " + nm);
        return nm;
      }
    } catch(e) { }
  }
  $.writeln("[font] None of the preferred names worked; using default.");
  return null;
}

// ---------- create paragraph text that GROWS until overflow, then step back ----------
function createGrowThenFitTextLayer(doc, rect, text, layerName, options){
  options = options || {};
  var colorRGB      = options.colorRGB      || TEXT_COLOR_RGB;
  var fontPrefs     = options.fontPrefs     || null;  // apply BEFORE sizing
  var align         = options.align         || TEXT_ALIGN;
  var minPt         = (typeof options.minPt === "number") ? options.minPt : TEXT_MIN_PT;
  var maxPt         = (typeof options.maxPt === "number") ? options.maxPt : TEXT_MAX_PT;
  var stepPt        = (typeof options.stepPt=== "number") ? options.stepPt: TEXT_STEP_PT;
  var leadingMult   = (typeof options.leadingMult === "number") ? options.leadingMult : TEXT_LEADING_MULT;
  var trackStart    = (typeof options.trackStart  === "number") ? options.trackStart  : TEXT_TRACKING_START;
  var trackMin      = (typeof options.trackMin    === "number") ? options.trackMin    : TEXT_TRACKING_MIN;
  var trackStep     = (typeof options.trackStep   === "number") ? options.trackStep   : TEXT_TRACKING_STEP;
  var shrinkSteps   = (typeof options.shrinkStepsAfterFit === "number") ? Math.max(0, options.shrinkStepsAfterFit) : 0;

  var layer = doc.artLayers.add();
  layer.name = layerName || "Text";
  layer.kind = LayerKind.TEXT;

  var ti = layer.textItem;
  ti.kind = TextType.PARAGRAPHTEXT;
  ti.position = [rect.x, rect.y];
  ti.width    = rect.w;
  ti.height   = rect.h;

  trySetFontFromList(ti, fontPrefs);

  ti.contents = psNewlines(text || "");
  ti.color    = makeSolidColor(colorRGB[0], colorRGB[1], colorRGB[2]);
  ti.justification = align;
  ti.tracking = trackStart;

  var best = minPt;
  var s = minPt;
  function applySize(sz){ ti.size = sz; ti.leading = sz * leadingMult; }

  applySize(s);
  while (s <= maxPt){
    applySize(s);
    if (layerFitsRect(layer, rect.w, rect.h)){ best = s; s += stepPt; }
    else break;
  }

  best = Math.max(minPt, best - (stepPt * shrinkSteps));
  applySize(best);

  if (!layerFitsRect(layer, rect.w, rect.h)){
    var t = trackStart;
    while (!layerFitsRect(layer, rect.w, rect.h) && t > trackMin){
      t -= trackStep;
      ti.tracking = t;
      if (best > minPt){ best -= 1; applySize(best); }
    }
  }

  if (!layerFitsRect(layer, rect.w, rect.h)){
    var m = measureLayerPx(layer);
    if (m.w > 0 && m.h > 0){
      var scale = Math.min((rect.w / m.w) * 100.0, (rect.h / m.h) * 100.0);
      layer.resize(scale, scale, AnchorPosition.MIDDLECENTER);
      var b = layer.bounds;
      var bx = b[0].as("px"), by = b[1].as("px");
      layer.translate(rect.x - bx, rect.y - by);
    }
  }

  var bb = layer.bounds;
  var bxl = bb[0].as("px"), byt = bb[1].as("px");
  layer.translate(rect.x - bxl, rect.y - byt);

  return layer;
}

// ---------- rotation helpers ----------
function randomSignedBetween(minAbs, maxAbs){
  var a = minAbs + Math.random() * (maxAbs - minAbs);
  if (Math.random() < 0.5) a = -a;
  return a;
}
function randomItemAngleDeg(){ return randomSignedBetween(ROTATE_MIN_ABS, ROTATE_MAX_ABS); }
function randomSubAngleDeg(){ return randomSignedBetween(SUBROTATE_MIN_ABS, SUBROTATE_MAX_ABS); }

function rotateGroupAroundCenter(group, degrees){
  var doc = app.activeDocument;
  var prev = doc.activeLayer;
  try {
    doc.activeLayer = group;
    group.rotate(degrees, AnchorPosition.MIDDLECENTER);
  } catch (e) {
    $.writeln("Rotate failed for "+group.name+": "+e.message);
  } finally {
    try { doc.activeLayer = prev; } catch(_e){}
  }
}

// ---------- FINAL Z-ORDER: make titles top-layer (except pins/links) ----------
function elevateTitlesButKeepPinsLinksOnTop(doc, globalTitles){
  // Bring TitleCards to absolute top…
  try { globalTitles.move(doc, ElementPlacement.PLACEATBEGINNING); } catch(_e){}

  // …then put Pins and Links back on top (so they remain above titles)
  var pins=null, links=null;
  try { pins  = doc.layerSets.getByName(TACKS_GROUP_NAME); } catch(_e1){}
  try { links = doc.layerSets.getByName(LINKS_GROUP_NAME); } catch(_e2){}

  // Order preference: Pins topmost, Links just under Pins (tweak as you like)
  if (links){ try { links.move(doc, ElementPlacement.PLACEATBEGINNING); } catch(_e3){} }
  if (pins ){ try { pins.move (doc, ElementPlacement.PLACEATBEGINNING); } catch(_e4){} }
}

// ---------- MAIN ----------
try{
  var doc = app.activeDocument;
}catch(eNoDoc){
  alert("Open or create a Photoshop document first (same size as BIN_W × BIN_H).");
  app.preferences.rulerUnits = savedRuler; throw eNoDoc;
}

try{
  var data = parseJSON(readFileAsString(JSON_PATH));
  var binW = (data.meta && (data.meta.bin && (data.meta.bin.width || data.meta.bin.w))) || doc.width.as("px");
  var binH = (data.meta && (data.meta.bin && (data.meta.bin.height || data.meta.bin.h))) || doc.height.as("px");
  ensureActiveDocMatchesBin(doc, binW, binH);

  var items=data.items||[];
  if(!items.length) alert("No items found in JSON: "+JSON_PATH);

  // Prepare text map
  var NAMES_TXT = deriveNamesTxtPath(JSON_PATH);
  var knownSet = buildKnownNameSet(items);
  var nameMap  = readNamesMapTitleBody(NAMES_TXT, knownSet);

  // Global TitleCards container
  var globalTitles = null;
  try { globalTitles = doc.layerSets.getByName(GLOBAL_TITLE_GROUP_NAME); } catch(_eNF){}
  if (!globalTitles){
    globalTitles = doc.layerSets.add();
    globalTitles.name = GLOBAL_TITLE_GROUP_NAME;
  }

  for (var i=0;i<items.length;i++){
    var it=items[i];
    if(!it.image_box||!it.under_box||!it.text_box){ $.writeln("Skip item "+(i+1)+" — missing boxes"); continue; }
    var imgPath=it.image_path; if(!imgPath||!fileExists(imgPath)){ $.writeln("Skip item "+(i+1)+" — missing image: "+imgPath); continue; }

    var ib=it.image_box, ub=it.under_box, tb=it.text_box;
    var ttl = it.title_box || null;

    var itemGroup=null; if(GROUP_PER_ITEM){ itemGroup=doc.layerSets.add(); itemGroup.name="Item_"+(i+1); }

    // Underlay
    selectRect(doc, ub.x, ub.y, ub.w, ub.h);
    var under = fillSelectionOnNewLayer(doc, "Underlay_"+(i+1), UNDER_FILL_RGB, UNDER_OPACITY);
    if(itemGroup) under.move(itemGroup, ElementPlacement.INSIDE);

    // TextGroup
    var textGroup = itemGroup.layerSets.add(); textGroup.name = "TextGroup_"+(i+1);
    selectRect(doc, tb.x, tb.y, tb.w, tb.h);
    var tGuide = strokeSelectionOnNewLayer(doc, "TextBox_"+(i+1), TEXT_STROKE_RGB, TEXT_STROKE_PX);
    tGuide.visible=false;
    tGuide.move(textGroup, ElementPlacement.INSIDE);

    var base = baseName(imgPath).toLowerCase();
    var rec  = nameMap[base] || { desc:"", title:"" };

    var textLayer = createGrowThenFitTextLayer(
      doc, {x:tb.x,y:tb.y,w:tb.w,h:tb.h}, rec.desc || "", "Text_"+(i+1),
      {
        colorRGB: TEXT_COLOR_RGB,
        fontPrefs: TEXT_FONT_PREFS,
        align: TEXT_ALIGN,
        minPt: TEXT_MIN_PT,
        maxPt: TEXT_MAX_PT,
        stepPt: TEXT_STEP_PT,
        leadingMult: TEXT_LEADING_MULT,
        trackStart: TEXT_TRACKING_START,
        trackMin: TEXT_TRACKING_MIN,
        trackStep: TEXT_TRACKING_STEP
      }
    );
    textLayer.move(textGroup, ElementPlacement.INSIDE);

    // ImageGroup
    var imageGroup = itemGroup.layerSets.add(); imageGroup.name = "ImageGroup_"+(i+1);
    var imgLayer = placeImageAsLayerFitRect(doc, imgPath, {x:ib.x,y:ib.y,w:ib.w,h:ib.h}, "Image_"+(i+1));
    imgLayer.move(imageGroup, ElementPlacement.INSIDE);

    // TitleCard -> created at root, then moved into globalTitles
    var titleGroup = null;
    if (ttl && typeof ttl.x==="number" && typeof ttl.y==="number" && typeof ttl.w==="number" && typeof ttl.h==="number"){
      titleGroup = doc.layerSets.add(); // root-level
      titleGroup.name = "TitleCard_"+(i+1);

      selectRect(doc, ttl.x, ttl.y, ttl.w, ttl.h);
      var titleBG = fillSelectionOnNewLayer(doc, "TitleBG_"+(i+1), TITLE_BG_RGB, TITLE_BG_OPACITY);
      titleBG.move(titleGroup, ElementPlacement.INSIDE);

      var titleLayer = createGrowThenFitTextLayer(
        doc, {x:ttl.x,y:ttl.y,w:ttl.w,h:ttl.h}, (rec.title || ""), "Title_"+(i+1),
        {
          colorRGB: TITLE_COLOR_RGB,
          fontPrefs: TITLE_FONT_PREFS,
          align: TITLE_ALIGN,
          minPt: TITLE_MIN_PT,
          maxPt: TITLE_MAX_PT,
          stepPt: TITLE_STEP_PT,
          leadingMult: TITLE_LEADING_MULT,
          trackStart: TITLE_TRACKING_START,
          trackMin: TITLE_TRACKING_MIN,
          trackStep: TITLE_TRACKING_STEP,
          shrinkStepsAfterFit: TITLE_SHRINK_STEPS_AFTER_FIT
        }
      );
      titleLayer.move(titleGroup, ElementPlacement.INSIDE);

      applyDropShadowToGroup(titleGroup);

      // Move the entire title group into global container now
      try{ titleGroup.move(globalTitles, ElementPlacement.INSIDE); }catch(_eMv){}
    }

    // Order within item
    try{
      imageGroup.move(itemGroup, ElementPlacement.PLACEATBEGINNING);
      textGroup.move(itemGroup, ElementPlacement.INSIDE);
    }catch(_eOrder){}

    if(itemGroup) applyDropShadowToGroup(itemGroup);

    // Sub-rotations
    if (SUBROTATE_ITEMS){
      try { rotateGroupAroundCenter(textGroup,  randomSubAngleDeg()); } catch(e1){}
      try { rotateGroupAroundCenter(imageGroup, randomSubAngleDeg()); } catch(e2){}
      if (titleGroup) { try { rotateGroupAroundCenter(titleGroup, randomSubAngleDeg()); } catch(e3){} }
    }

    // Outer rotation (+ mirror on TitleCard so it stays aligned)
    if (ROTATE_ITEMS && itemGroup){
      var outerAngle = randomItemAngleDeg();
      rotateGroupAroundCenter(itemGroup, outerAngle);
      if (titleGroup){
        try { rotateGroupAroundCenter(titleGroup, outerAngle); } catch(eOut){}
      }
    }
  }

  // Center
  placeCenterImage(doc, data, binW, binH);

  // Links & Pins (they move themselves to top when created)
  drawLinksBetweenPins(doc, data);
  placeTacksAtPins(doc, data);

  // FINAL: elevate titles to top, then ensure pins/links remain above titles
  elevateTitlesButKeepPinsLinksOnTop(doc, globalTitles);

  alert("Layout placed. Title cards elevated above all items/center (below pins/links).\n" +
        "Title text nudged smaller by "+TITLE_SHRINK_STEPS_AFTER_FIT+" step(s).\n" +
        "Font: SecretServiceTypewriterRR-Regular (fallbacks if needed).");

}catch(err){
  alert("Error: "+err.message);
}finally{
  app.preferences.rulerUnits = savedRuler;
}
