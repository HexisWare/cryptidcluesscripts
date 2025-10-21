$.writeln("-------------------------------------------------------");

// ========= USER SET THIS =========
var imagesDirectoryPath = "C:/Users/12038/CryptidCluesScripting/test_images"; // e.g. "D:/assets/my_collage_images"
var LAYOUT_JSON = "C:/Users/12038/CryptidCluesScripting/output/layout_project.json"; //layout output from python script
// =================================
﻿$.writeln("-------------------------------------------------------");


(function () {
    if (!app.project || !app.project.activeSequence) {
        alert("Open a project and select an active sequence first.");
        return;
    }
    if (!imagesDirectoryPath || imagesDirectoryPath === "") {
        alert("Please set imagesDirectoryPath at the top of the script.");
        return;
    }

    var seq = app.project.activeSequence;

    // Try to enable QE (needed for adding tracks in many versions)
    app.enableQE(); // enables QE DOM if available
    var qeSeq = (typeof qe !== "undefined" && qe.project) ? qe.project.getActiveSequence() : null;

    // --- Helpers ---
    function getFolderForSegment(segIndex) {
        var segName = "seg"
        if (segIndex > 9) {
            $.writeln("segIndex larger than 9, regular append");
            segName = segName + segIndex;
            $.writeln("segName: " + segName);
        }
        else {
            segName = segName + "0" + segIndex;
        }
        var f = new Folder(imagesDirectoryPath + "/" + segName);
        return f.exists ? f : null;
    }

    // include videos alongside images
    function listMediaFiles(folderObj) {
        if (!folderObj) return [];
        return folderObj.getFiles(function (f) {
            if (f instanceof File) {
                var n = f.name.toLowerCase();
                if (n.match(/\.(png|jpg|jpeg|gif|tif|tiff|bmp)$/)) return true;  // images
                if (n.match(/\.(mp4|mov|m4v|mkv|avi|webm)$/)) return true;       // videos
            }
            return false;
        });
    }

    function isVideoName(n) { return /\.(mp4|mov|m4v|mkv|avi|webm)$/i.test(n || ""); }

    function removeLinkedAudioOverlapping(seq, clipName, startSec, endSec) {
        var EPS = 0.01;
        for (var at = 0; at < seq.audioTracks.numTracks; at++) {
            var atr = seq.audioTracks[at];
            for (var i = atr.clips.numItems - 1; i >= 0; i--) {
                var ac = atr.clips[i];
                if (!ac) continue;
                if (ac.name !== clipName) continue;
                var s = ac.start.seconds, e = ac.end.seconds;
                var overlaps = !(e <= (startSec + EPS) || s >= (endSec - EPS));
                if (overlaps) {
                    try { ac.remove(0, 0); } catch (e1) { try { ac.remove(); } catch(e2) {} }
                }
            }
        }
    }

    function clearOpacityTo100(clip) {
        var oc = getOpacityComponent(clip);
        if (!oc) return;
        var op = oc.properties[0];
        if (!op) return;
        op.setTimeVarying(false);
        op.setValue(100);
    }

    function applyFadeInOnly(clip, secondsDur) {
        var oc = getOpacityComponent(clip);
        if (!oc) return;
        var op = oc.properties[0]; if (!op) return;
        op.setTimeVarying(true);
        var inS = clip.inPoint.seconds;
        op.addKey(inS);             op.setValueAtKey(inS, 0);
        var endS = inS + Math.min(1.0, secondsDur);
        op.addKey(endS);            op.setValueAtKey(endS, 100);
    }

    function applyFadeOutOnly(clip, secondsDur) {
        var oc = getOpacityComponent(clip);
        if (!oc) return;
        var op = oc.properties[0]; if (!op) return;
        op.setTimeVarying(true);
        var inS  = clip.inPoint.seconds;
        var dur  = Math.min(1.0, secondsDur);
        var clipDur = clip.duration.seconds;
        var start = inS + Math.max(clipDur - dur, 0);
        var end   = inS + Math.max(clipDur - 0.001, 0.001);
        op.addKey(start);  op.setValueAtKey(start, 100);
        op.addKey(end);    op.setValueAtKey(end, 0);
    }

    // Robust QE lookup by NAME + TIME (tolerant to tiny timing diffs)
    function findQEItemByNameAndTime(qeSeq, trackIndex, name, startSec, endSec) {
        try {
            var EPS = 0.02;
            var qet = qeSeq.getVideoTrackAt(trackIndex);
            for (var i = 0; i < qet.numItems; i++) {
                var qei = qet.getItemAt(i);
                if (!qei || qei.name !== name) continue;
                var s = qei.start.seconds, e = qei.end.seconds;
                var overlaps = !(e <= (startSec + EPS) || s >= (endSec - EPS));
                if (overlaps) return qei;
            }
        } catch (e) {}
        return null;
    }

    // Force speed to -100 (reverse). Tries common QE signatures.
    function setQEItemSpeedNegative(qeItem) {
        if (!qeItem) return false;
        try { qeItem.setSpeed(-100.0, false, false, false); return true; } catch(e1) {}
        try { qeItem.setSpeed(-100.0); return true; } catch(e2) {}
        // last resort (older builds): reverse flag with +100
        try { qeItem.setSpeed(100.0, true, false, false); return true; } catch(e3) {}
        return false;
    }


    function findProjectItemByName(name) {
        function scanBin(bin) { 
            for (var i = 0; i < bin.children.numItems; i++) {
                var it = bin.children[i];
                if (it && it.name === name) return it;
                if (it && it.type === ProjectItemType.BIN) {
                    var found = scanBin(it);
                    if (found) return found;
                }
            }
            return null;
        }
        return scanBin(app.project.rootItem);
    }

    function importFilesReturnItems(fileArray) {
        if (!fileArray || !fileArray.length) return [];
        var paths = [];
        for (var i = 0; i < fileArray.length; i++) { paths.push(fileArray[i].fsName); }
        app.project.importFiles(paths, 1, app.project.getInsertionBin(), 0);

        var imported = [];
        for (var j = 0; j < fileArray.length; j++) {
            var fname = decodeURI(File(fileArray[j]).name);
            var item = findProjectItemByName(fname);
            if (item) imported.push(item);
        }
        return imported;
    }

    function timeFromTicks(ticks) { var t = new Time(); t.ticks = ticks; return t; }
    function secondsToTime(seconds) { var t = new Time(); t.seconds = seconds; return t; }

    // Robust QE lookup by NAME + TIME with epsilon (avoids exact tick-match issues)
    function findQEItemByNameAndTime(qeSeq, trackIndex, name, startSec, endSec) {
        try {
            var EPS = 0.02; // 20ms tolerance
            var qet = qeSeq.getVideoTrackAt(trackIndex);
            for (var i = 0; i < qet.numItems; i++) {
                var qei = qet.getItemAt(i);
                if (!qei) continue;
                // name match
                if (qei.name !== name) continue;
                // time overlap (loose)
                var s = qei.start.seconds, e = qei.end.seconds;
                var overlaps = !(e <= (startSec + EPS) || s >= (endSec - EPS));
                if (overlaps) return qei;
            }
        } catch (e) {}
        return null;
    }

    // Set clip to reversed playback; tries several common QE signatures
    function setQEItemReverse(qeItem) {
        if (!qeItem) return false;
        // Try "reverse flag" signature first (most common)
        try { qeItem.setSpeed(100.0, true, false, false); return true; } catch (e1) {}
        try { qeItem.setSpeed(100.0, true); return true; } catch (e2) {}
        // Fallback: negative speed (some builds)
        try { qeItem.setSpeed(-100.0, false, false, false); return true; } catch (e3) {}
        try { qeItem.setSpeed(-100.0); return true; } catch (e4) {}
        return false;
    }


    function ensureVideoTracks(minCount) {
        var current = seq.videoTracks.numTracks;
        if (current >= minCount) return current;

        var toAdd = minCount - current;
        try {
            for (var i = 0; i < toAdd; i++) { qeSeq.addTracks(1,1,0); }
        } catch (e1) { $.writeln("qeSeq.addTracks failed: " + e1); }

        return seq.videoTracks.numTracks;
    }

    //Helpers for input handling
    function readFileText(pathOrFile) {
        var f = (pathOrFile instanceof File) ? pathOrFile : new File(pathOrFile);
        if (!f.exists) return null;
        if (!f.open("r")) return null;
        var txt = f.read();
        f.close();
        return txt;
    }
    function parseJSONSafe(txt) {
        if (typeof JSON !== "undefined" && JSON.parse) {
            return JSON.parse(txt);
        } else {
            return eval('(' + txt + ')'); // fallback for very old hosts
        }
    }
    function getSequenceDimensions(seq) {
        try {
            var js = seq.getSettings();
            var o = JSON.parse(js);
            return { w: o.videoFrameWidth, h: o.videoFrameHeight };
        } catch (e) { return null; }
    }
    function getMotionComponent(clip) {
        if (!clip || !clip.components) return null;
        for (var i = 0; i < clip.components.numItems; i++) {
            var c = clip.components[i];
            if (c && c.displayName === "Motion") return c;
        }
        return null;
    }
    function getWaveWarpComponent(clip) {
        if (!clip || !clip.components) return null;
        for (var i = 0; i < clip.components.numItems; i++) {
            var c = clip.components[i];
            if (c && c.displayName === "Wave Warp") return c;
        }
        return null;
    }
    function getOpacityComponent(clip) {
        if (!clip || !clip.components) return null;
        for (var i = 0; i < clip.components.numItems; i++) {
            var c = clip.components[i];
            if (c && c.displayName === "Opacity") return c;
        }
        return null;
    }
    function getPropByName(comp, name) {
        if (!comp || !comp.properties) return null;
        for (var i = 0; i < comp.properties.numItems; i++) {
            var p = comp.properties[i];
            if (p && p.displayName === name) return p;
        }
        return null;
    }
    function selectedClipsInActiveSequence() {
        var seq = app.project.activeSequence;
        var out = [];
        if (!seq) return out;
        for (var vt = 0; vt < seq.videoTracks.numTracks; vt++) {
            var track = seq.videoTracks[vt];
            for (var i = 0; i < track.clips.numItems; i++) {
                var c = track.clips[i];
                if (c && c.isSelected()) out.push(c);
            }
        }
        return out;
    }
    function stripExt(name) {
        var idx = name.lastIndexOf(".");
        return (idx > 0) ? name.substring(0, idx) : name;
    }
    function buildPlacementMap(placements) {
        var m = {};
        for (var i = 0; i < placements.length; i++) {
            var p = placements[i];
            m[p.id] = p;
        }
        return m;
    }
    function motionParamsFromPlacement(place) {
        var cx = place.x + (place.w / 2);
        var cy = place.y + (place.h / 2);
        var pos = [cx, cy];
        var scale = 100.0; // fallback
        if (place.w0 && place.h0 && place.h0 > 0 && place.w0 > 0) {
            var sx = (place.w / place.w0) * 100.0;
            var sy = (place.h / place.h0) * 100.0;
            scale = Math.min(sx, sy);
        } else if (place.scale) {
            scale = place.scale * 100.0;
        }
        return { pos: pos, scale: scale };
    }

    // --- Get A1 track ---
    var a1 = seq.audioTracks && seq.audioTracks.numTracks > 0 ? seq.audioTracks[0] : null;
    if (!a1) { alert("No A1 track found in the active sequence."); return; }

    var numAudioClips = a1.clips ? a1.clips.numItems : 0;
    if (numAudioClips === 0) { alert("No audio clips found on A1."); return; }

    $.writeln("Found " + numAudioClips + " audio clip(s) on A1.");

    var existing = 1;

    // Pre-flight: ensure enough tracks for each segment's media count
    for (var c = 0; c < numAudioClips; c++) {
        var segFolder = getFolderForSegment(c + 1);
        if (!segFolder) { $.writeln("Skip: folder not found for segment " + (c + 1)); continue; }
        var files = listMediaFiles(segFolder);
        if (!files.length) { $.writeln("Skip: no media in " + segFolder.fsName); continue; }
        var items = importFilesReturnItems(files);
        if (!items.length) { $.writeln("Skip: could not import media from " + segFolder.fsName); continue; }
        var want = items.length + existing;
        ensureVideoTracks(want);
    }

    var clipsPerTrack = [];
    for (var i = 0; i < seq.videoTracks.numTracks - existing; i++) clipsPerTrack.push(0);
    $.writeln("Offset array clipsPerTrack: " + clipsPerTrack);

    // For each A1 audio clip, import media from segNN and align each to the clip span
    for (var c = 0; c < numAudioClips; c++) {

        // Run python per segment
        function q(s){ return '"' + String(s).replace(/"/g, '\\"') + '"'; }
        function runPythonPremiere(pythonPath, scriptPath, argsArray, waitForFile, timeoutMs){
            var py = File(pythonPath).fsName;
            var sc = File(scriptPath).fsName;
            var cmd = q(py) + " " + q(sc);
            for (var i=0; i<argsArray.length; i++){ cmd += " " + q(argsArray[i]); }
            var bat = new File(Folder.temp.fsName + "/run_py_" + (new Date().getTime()) + ".bat");
            bat.encoding = "UTF-8"; bat.open("w");
            bat.write('@echo off\r\nchcp 65001>nul\r\n' + cmd + ' 1> "%TEMP%\\run_py_stdout.txt" 2>&1\r\n');
            bat.close();
            if (!bat.execute()){ throw new Error("Failed to execute: " + bat.fsName); }
            if (!waitForFile) return true;
            var out = new File(waitForFile);
            var deadline = Date.now() + (timeoutMs || 120000);
            while (!out.exists && Date.now() < deadline){ $.sleep(250); }
            if (!out.exists) throw new Error("Timed out waiting for " + out.fsName);
            out.open("r"); var txt = out.read(); out.close();
            return txt;
        }

        $.writeln("Invoking python script");
        var segmentedPath = "C:/Users/12038/CryptidCluesScripting/test_images/seg" + ((c + 1) > 9 ? (c + 1) : ("0" + (c + 1)));
        $.writeln(" using media in this directory: " + segmentedPath);

        var outJson = "C:/Users/12038/CryptidCluesScripting/output/layout_project_seg" + (c + 1) + ".json";
        LAYOUT_JSON = outJson;
        var pngPath = "C:/Users/12038/CryptidCluesScripting/output/all_iterations_" + (c + 1) + ".png";

        runPythonPremiere(
            "C:/Users/12038/AppData/Local/Programs/Python/Python311/python.exe",
            "C:/Users/12038/CryptidCluesScripting/2DBinMaxReactPacking_withVideo.py",
            [
              "--images-dir", segmentedPath,
              "--bin", "1326x1080",
              "--padding", "6",
              "--iters", "3",
              "--max-scale", "4.0",
              "--seed", "42",
              "--out-json", outJson,
              "--frames-json", "C:/Users/12038/CryptidCluesScripting/output/frames_seg" + (c + 1) + ".json", 
              "--project", "1920x1080",
              "--project-scale-mode", "none",
              "--project-align", "right",
              "--project-out-json", "C:/Users/12038/CryptidCluesScripting/output/layout_project_seg" + (c + 1) + ".json",
              "--segment-number", String(c + 1),
              "--display-output"
            ],
            pngPath,
            300000
        );

        var clip = a1.clips[c];
        if (!clip) continue;

        var segFolder = getFolderForSegment(c + 1);
        if (!segFolder) { $.writeln("Skip: folder not found for segment " + (c + 1)); continue; }
        var files = listMediaFiles(segFolder);
        if (!files.length) { $.writeln("Skip: no media in " + segFolder.fsName); continue; }

        var items = importFilesReturnItems(files);
        if (!items.length) { $.writeln("Skip: could not import media from " + segFolder.fsName); continue; }

        var existing = 1;
        var want = items.length + existing;
        var have = ensureVideoTracks(want);
        var placeable = Math.min(want, have);
        if (placeable < want) {
            $.writeln("Only " + placeable + " video track(s) available; placing first " + placeable + " media item(s), skipping " + (want - placeable) + ".");
        }

        // Load layout JSON
        var jsonFile = new File(LAYOUT_JSON);
        if (!jsonFile) { alert("No layout_project.json selected or found."); return; }
        var txt = readFileText(jsonFile);
        if (!txt) { alert("Could not read: " + jsonFile.fsName); return; }
        var layout = parseJSONSafe(txt);
        if (!layout || !layout.placements || !layout.from.bin) {
            alert("layout.json missing required fields (from.bin, placements).");
            return;
        }
        var map = buildPlacementMap(layout.placements);

        // Place each media item for this segment
        for (var k = 0; k < placeable; k++) {
            var projItem = items[k];
            if (!projItem) continue;

            var vt = seq.videoTracks[k + existing]; // V1..Vn
            var segStart = a1.clips[c].start.seconds;
            var segEnd   = a1.clips[c].end.seconds;

            var place = map[projItem.name];
            if (!place) { $.writeln("No layout entry for " + projItem.name + " — skipping."); continue; }

            function applyMotionFromPlacement(clipDom, layoutDom, placeObj) {
                var motion = getMotionComponent(clipDom);
                if (!motion) return;
                var params = motionParamsFromPlacement(placeObj);
                motion.properties[0].setTimeVarying(false);
                motion.properties[1].setTimeVarying(false);
                var left = Number(placeObj.x), top = Number(placeObj.y);
                var fw = Number(placeObj.w), fh = Number(placeObj.h);
                var cx = left + fw/2, cy = top + fh/2;
                motion.properties[0].setValue([cx / layoutDom.project.w, cy / layoutDom.project.h]); // pos (normalized)
                motion.properties[1].setValue(params.scale);                                         // scale
            }

            var startTime = new Time(); startTime.seconds = segStart;

            if (!isVideoName(projItem.name)) {
                // IMAGE: single span over segment
                var newTI = vt.overwriteClip(projItem, startTime);
                clipsPerTrack[k] = clipsPerTrack[k] + 1;
                if (!newTI) { $.writeln("Failed to place image on V" + (k + 1)); continue; }
                var placedClip = vt.clips[vt.clips.numItems - 1];
                placedClip.end = segEnd; // full segment
                applyMotionFromPlacement(placedClip, layout, place);
                continue;
            }

            // VIDEO: loop to fill segment, trim last; remove audio each instance
            var newTIv = vt.overwriteClip(projItem, startTime);
            clipsPerTrack[k] = clipsPerTrack[k] + 1;
            if (!newTIv) { $.writeln("Failed to place video on V" + (k + 1)); continue; }
            var firstClip = vt.clips[vt.clips.numItems - 1];

            removeLinkedAudioOverlapping(seq, firstClip.name, firstClip.start.seconds, firstClip.end.seconds);

            var unitDur = Math.max(0.0, firstClip.duration.seconds);
            if (unitDur <= 0.0005) {
                firstClip.end = Math.min(segEnd, segStart + 0.001);
                applyMotionFromPlacement(firstClip, layout, place);
                clearOpacityTo100(firstClip);
                continue;
            }

            applyMotionFromPlacement(firstClip, layout, place);
            clearOpacityTo100(firstClip);

            var instanceClips = [firstClip];
            var t = segStart + unitDur;

            while (t < segEnd - 1e-6) {
                var ti = new Time(); ti.seconds = t;
                var tiResult = vt.overwriteClip(projItem, ti);
                clipsPerTrack[k] = clipsPerTrack[k] + 1;
                if (!tiResult) { $.writeln("Failed to place loop instance at t=" + t.toFixed(3)); break; }

                var loopClip = vt.clips[vt.clips.numItems - 1];
                removeLinkedAudioOverlapping(seq, loopClip.name, loopClip.start.seconds, loopClip.end.seconds);

                var nextT = t + unitDur;
                if (nextT >= segEnd - 1e-6) {
                    loopClip.end = segEnd; // trim last
                }
                applyMotionFromPlacement(loopClip, layout, place);
                clearOpacityTo100(loopClip);
                instanceClips.push(loopClip);

                if (nextT >= segEnd - 1e-6) break;
                t = nextT;
            }

            // Opacity policy:
            // - single instance: fade in + fade out on the same clip
            // - multiple: first ONLY fades in; last ONLY fades out; middle constant
            if (instanceClips.length === 1) {
                applyFadeInOnly(instanceClips[0], unitDur);
                applyFadeOutOnly(instanceClips[0], unitDur);
            } else {
                applyFadeInOnly(instanceClips[0], unitDur);                                 // first IN
                applyFadeOutOnly(instanceClips[instanceClips.length - 1], unitDur);         // last OUT
            }

            // ========= NEW FEATURE: reverse every OTHER placed video (2nd, 4th, ...) =========
            // ========= REVERSE EVERY OTHER INSTANCE (2nd, 4th, ...) by setting speed to -100 =========
            // for (var idx = 0; idx < instanceClips.length; idx++) {
            //     if (idx % 2 === 1) { // 2nd, 4th, ...
            //         var domClip = instanceClips[idx];
            //         var qeItem = findQEItemByNameAndTime(
            //             qeSeq,
            //             (k + existing),
            //             domClip.name,
            //             domClip.start.seconds,
            //             domClip.end.seconds
            //         );
            //         if (!setQEItemSpeedNegative(qeItem)) {
            //             $.writeln("WARN: could not set -100 speed on clip " + domClip.name +
            //                     " @" + domClip.start.seconds.toFixed(3) + "s");
            //         }
            //     }
            // }
            // ================================================================================
        }

        $.writeln("Placed " + (placeable - 1) + " media item(s) for segment " + (c + 1));
    }

    // final add effects to ALL existing clips (skip opacity for videos)
    var seq = app.project.activeSequence;

    // helper: map DOM clip -> QE item on the same track by start/end ticks
    function findQEItemForDomClip(qeSeq, trackIndex, domClip) {
        try {
            var qet = qeSeq.getVideoTrackAt(trackIndex);
            for (var i = 0; i < qet.numItems; i++) {
                var qei = qet.getItemAt(i);
                if (qei && qei.start && qei.end &&
                    qei.start.ticks === domClip.start.ticks &&
                    qei.end.ticks   === domClip.end.ticks) {
                    return qei;
                }
            }
            var domTrack = seq.videoTracks[trackIndex];
            if (domTrack && domTrack.clips && domTrack.clips.numItems <= qet.numItems) {
                return qet.getItemAt(domTrack.clips.numItems - 1);
            }
        } catch (e) {}
        return null;
    }

    var fxDrop = qe.project.getVideoEffectByName("Drop Shadow");
    var fxWave = qe.project.getVideoEffectByName("Wave Warp");

    for (var t = existing; t < seq.videoTracks.numTracks; t++) {
        var domTrack = seq.videoTracks[t];
        if (!domTrack) continue;

        for (var i = 0; i < domTrack.clips.numItems; i++) {
            try {
                var clip = domTrack.clips[i];
                if (!clip) continue;

                var qeItem = findQEItemForDomClip(qeSeq, t, clip);
                if (qeItem) {
                    if (fxDrop) { 
                        qeItem.addVideoEffect(fxDrop);
                        qeItem.addVideoEffect(fxDrop);
                        qeItem.addVideoEffect(fxDrop);
                        qeItem.addVideoEffect(fxDrop);
                        qeItem.addVideoEffect(fxDrop);
                        qeItem.addVideoEffect(fxDrop);
                        qeItem.addVideoEffect(fxDrop);
                    }
                    if (fxWave) { qeItem.addVideoEffect(fxWave); }
                }

                $.sleep(30);

                var wavewarp = getWaveWarpComponent(clip);
                if (wavewarp && wavewarp.properties && wavewarp.properties.numItems >= 5) {
                    wavewarp.properties[1].setValue(1);
                    wavewarp.properties[2].setValue(1280);
                    wavewarp.properties[3].setValue(90);
                    wavewarp.properties[4].setValue(0.3);
                }

                // SKIP global opacity for videos (videos handled per-instance above)
                if (!isVideoName(clip.name)) {
                    var opacityComponent = getOpacityComponent(clip);
                    if (opacityComponent) {
                        var opacity = opacityComponent.properties[0];
                        if (opacity) {
                            opacity.setTimeVarying(true);
                            var inS = clip.inPoint.seconds;
                            opacity.addKey(inS);                opacity.setValueAtKey(inS, 0);
                            var fadeInEnd = inS + 1.0;
                            opacity.addKey(fadeInEnd);          opacity.setValueAtKey(fadeInEnd, 100);
                            var clipDur  = clip.duration.seconds;
                            var fadeDur  = Math.min(1.0, clipDur);
                            var fadeOutStart = inS + clipDur - fadeDur;
                            var fadeOutEnd   = inS + clipDur - 0.001;
                            opacity.addKey(fadeOutStart);       opacity.setValueAtKey(fadeOutStart, 100);
                            opacity.addKey(fadeOutEnd);         opacity.setValueAtKey(fadeOutEnd, 0);
                        }
                    }
                }

            } catch (e) {
                $.writeln("Error adding/managing clip effects on V" + (t+1) + " clip #" + i + ": " + e);
            }
        }
    }

    alert("Done placing media aligned to A1 audio clips.");
})();
