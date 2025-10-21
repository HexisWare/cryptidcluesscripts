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
    //function pad2(n) { return (n < 10 ? "0" : "") + n; }

    function getFolderForSegment(segIndex) {
        var segName = "seg"
        if (segIndex > 9) {
            $.writeln("segIndex larger than 9, regular append");
            segName = segName + segIndex;
            $.writeln("segName: " + segName);
        }
        else {
            //IF segIndex < 10, pad it with a 0 (so 9 = 09 so on)
            segName = segName + "0" + segIndex;
        }
        var f = new Folder(imagesDirectoryPath + "/" + segName);
        return f.exists ? f : null;
    }

    function listImageFiles(folderObj) {
        if (!folderObj) return [];
        return folderObj.getFiles(function (f) {
            if (f instanceof File) {
                var n = f.name.toLowerCase();
                return n.match(/\.(png|jpg|jpeg|gif|tif|tiff|bmp)$/);
            }
            return false;
        });
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

    function ensureVideoTracks(minCount) {
        var current = seq.videoTracks.numTracks;
        if (current >= minCount) return current;

        var toAdd = minCount - current;
        var added = 0;
        $.writeln("ensureVideoTracks items: " + "toAdd: " + toAdd + " current: " + current + " minCount: " + minCount);
        try {
            for (var i = 0; i < toAdd; i++) { qeSeq.addTracks(1,1,0); added++; }
        } catch (e1) { $.writeln("qeSeq.addTracks failed: " + e1); }

        // Return how many tracks are now available
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
        } catch (e) {
            // Not critical; Python coords are already screen-space
            return null;
        }
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
    // Convert top-left rect to Motion center position and uniform Scale%
    // We prefer Python’s w0/h0 to compute exact Scale%.
    function motionParamsFromPlacement(place) {
        var cx = place.x + (place.w / 2);
        var cy = place.y + (place.h / 2);
        var pos = [cx, cy];
        var scale = 100.0; // fallback
        if (place.w0 && place.h0 && place.w0 > 0 && place.h0 > 0) {
            // uniform scale: choose the dimension that preserves fit (min)
            var sx = (place.w / place.w0) * 100.0;
            var sy = (place.h / place.h0) * 100.0;
            scale = Math.min(sx, sy);
        } else if (place.scale) {
            // Python's "scale" is factor vs original size; convert to %
            scale = place.scale * 100.0;
        }
        return { pos: pos, scale: scale };
    }

    // --- Get A1 track ---
    var a1 = seq.audioTracks && seq.audioTracks.numTracks > 0 ? seq.audioTracks[0] : null;
    if (!a1) {
        alert("No A1 track found in the active sequence.");
        return;
    }

    var numAudioClips = a1.clips ? a1.clips.numItems : 0;
    if (numAudioClips === 0) {
        alert("No audio clips found on A1.");
        return;
    }

    $.writeln("Found " + numAudioClips + " audio clip(s) on A1.");

    
    var existing = 1;
    // Place tracks first
    for (var c = 0; c < numAudioClips; c++) {
        var segFolder = getFolderForSegment(c + 1);
        if (!segFolder) {
            $.writeln("Skip: folder not found for segment " + (c + 1));
            continue;
        }
        var files = listImageFiles(segFolder);
        if (!files.length) {
            $.writeln("Skip: no images in " + segFolder.fsName);
            continue;
        }
        var items = importFilesReturnItems(files);
        if (!items.length) {
            $.writeln("Skip: could not import images from " + segFolder.fsName);
            continue;
        }
        //var existing = 1;    // will be used to offset so already placed clips on existing tracks will be skipped    
        // want = How many tracks would be needed
        var want = items.length + existing;
        var have = ensureVideoTracks(want);
    }
    //arrays to be used for video clip offsets for varying clip stack sizes per new track
    var clipsPerTrack = [];
    for (var i = 0; i < seq.videoTracks.numTracks - existing; i++) {
        clipsPerTrack.push(0);
    }
    $.writeln("Offset array clipsPerTrack: ");
    $.writeln(clipsPerTrack);
    //zeros is now [0,0,0,0,0]

    // For each A1 audio clip, import images from segNN and align each to the clip span
    for (var c = 0; c < numAudioClips; c++) {
        
        // Logic to run python script per segment
        function q(s){ return '"' + String(s).replace(/"/g, '\\"') + '"'; }

        function runPythonPremiere(pythonPath, scriptPath, argsArray, waitForFile, timeoutMs){
            var py = File(pythonPath).fsName;
            var sc = File(scriptPath).fsName;

            // Build: "<python>" "<script>" "arg1" "arg2" ...
            var cmd = q(py) + " " + q(sc);
            for (var i=0; i<argsArray.length; i++){
                cmd += " " + q(argsArray[i]); // quoting each arg is safe (flags included)
            }

            // Create a unique .bat in temp
            var bat = new File(Folder.temp.fsName + "/run_py_" + (new Date().getTime()) + ".bat");
            bat.encoding = "UTF-8";
            bat.open("w");
            // Ensure unicode codepage for safety; redirect stdout/stderr to a log (optional)
            bat.write('@echo off\r\nchcp 65001>nul\r\n' + cmd + ' 1> "%TEMP%\\run_py_stdout.txt" 2>&1\r\n');
            bat.close();

            // Launch (non-blocking)
            if (!bat.execute()){
                throw new Error("Failed to execute: " + bat.fsName);
            }

            // Wait for output file (JSON your Python writes)
            if (!waitForFile) return true;
            var out = new File(waitForFile);
            var deadline = Date.now() + (timeoutMs || 120000);
            while (!out.exists && Date.now() < deadline){ $.sleep(250); }
            if (!out.exists) throw new Error("Timed out waiting for " + out.fsName);

            // Read and return text
            out.open("r"); var txt = out.read(); out.close();
            return txt;
        }

        $.writeln("Invoking python script");
        var segmentedPath = "C:/Users/12038/CryptidCluesScripting/test_images/seg"
        if ((c + 1) > 9) {
            segmentedPath = segmentedPath + (c + 1);
        }
        else {
            segmentedPath = segmentedPath + "0" + (c + 1);
        }
        $.writeln(" using images in this directory: " + segmentedPath);

        var outJson = "C:/Users/12038/CryptidCluesScripting/output/layout_project_seg" + (c + 1) + ".json";
        LAYOUT_JSON = outJson;
        var pngPath = "C:/Users/12038/CryptidCluesScripting/output/all_iterations_" + (c + 1) + ".png";
        //var waitFile = DISPLAY_OUTPUT ? pngPath : outJson;
        var waitFile = pngPath;
        var txt = runPythonPremiere(
            "C:/Users/12038/AppData/Local/Programs/Python/Python311/python.exe",
            "C:/Users/12038/CryptidCluesScripting/2DBinMaxReactPacking.py",
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
            waitFile,            // wait for this file to appear
            300000              // timeout ms
        );



        
        
        // Take first audio track, c=0 up to numAudioClips (but not equal)
        var clip = a1.clips[c];
        if (!clip) continue;

        var startTicks = clip.start.ticks;
        var durTicks   = clip.duration.ticks;
        $.writeln("current Clip start and duration");
        $.writeln(startTicks);
        $.writeln(durTicks);

        var segFolder = getFolderForSegment(c + 1);
        if (!segFolder) {
            $.writeln("Skip: folder not found for segment " + (c + 1));
            continue;
        }
        $.writeln("Current segment folder handling");
        $.writeln(segFolder);

        var files = listImageFiles(segFolder);
        if (!files.length) {
            $.writeln("Skip: no images in " + segFolder.fsName);
            continue;
        }

        var items = importFilesReturnItems(files);
        if (!items.length) {
            $.writeln("Skip: could not import images from " + segFolder.fsName);
            continue;
        }

        // Ensure (or attempt) enough tracks to stack them; degrade if QE can't add
        // Ensure enough tracks equal images within segment folder
        var existing = 1;    // will be used to offset so already placed clips on existing tracks will be skipped    
        // want = How many tracks would be needed
        var want = items.length + existing;
        var have = ensureVideoTracks(want);
        var placeable = Math.min(want, have);
        if (placeable < want) {
            $.writeln("Only " + placeable + " video track(s) available; placing first " + placeable + " image(s), skipping " + (want - placeable) + ".");
        }
    
        // handle output for layouts
        $.writeln("Layout handling, initial for audio segment");
        var jsonFile = new File(LAYOUT_JSON);
        if (!jsonFile) {
            alert("No layout_project.json selected or found.");
            return;
        }
        var txt = readFileText(jsonFile);
        if (!txt) {
            alert("Could not read: " + jsonFile.fsName);
            return;
        }
        var layout = parseJSONSafe(txt);
        if (!layout || !layout.placements || !layout.from.bin) {
            alert("layout.json missing required fields (from.bin, placements).");
            return;
        }
        var map = buildPlacementMap(layout.placements);

        
        // k is each track to be added/used here
        for (var k = 0; k < placeable; k++) {
            $.writeln(k + "  " + "Iteration test, number of placeables: " + placeable);            
            $.writeln(placeable);
            var projItem = items[k];
            if (!projItem) continue;

            var vt = seq.videoTracks[k + existing]; // V1..Vn
            // var startTime = timeFromTicks(startTicks);
            // if (c != 0) {
            //     // if we are on the second iteration, just use previous clip info
            //     startTime = a1.clips[c - 1].end.ticks;
            // }
            var startTime = new Time();
            startTime.ticks = a1.clips[c].start.ticks;

            // Overwrite at the clip start
            var newTI = vt.overwriteClip(projItem, startTime);
            clipsPerTrack[k] = clipsPerTrack[k] + 1;
            if (!newTI) {
                $.writeln("Failed to place image on V" + (k + 1));
                continue;
            }
            var placedClip = vt.clips[vt.clips.numItems - 1];

            // Align in/out to the audio clip span
            try {
                // vt.clips[c] is the current image clip we want
                // a1.clips[c] is the current audio clip we want
                $.writeln("Clip info: on CURRENT track: " + k);
                $.writeln(placedClip.name);
                $.writeln(a1.clips[c].name);
                placedClip.end = a1.clips[c].end.seconds;
                //now it's in sequence and aligned, change position and scale
                //$.writeln("Layout usage handling");
                var motion = getMotionComponent(placedClip);
                //$.writeln("motion");
                //$.writeln(motion);
                if (!motion) {
                    missing.push(name + " (no Motion component)");
                    continue;
                }
                 //Hard setting Motion components such as position and scale
                var place = map[placedClip.name];
                //$.writeln("place");
                //$.writeln(place);
                var params = motionParamsFromPlacement(place);
                motion.properties[0].setTimeVarying(false);
                motion.properties[1].setTimeVarying(false);
                // need center position, not top left
                var left = Number(place.x);
                var top  = Number(place.y);
                var fw   = Number(place.w);  // final width after scaling
                var fh   = Number(place.h);  // final height after scaling
                // Center of rect
                var cx = left + fw/2;
                var cy = top  + fh/2;
                // setting Motion's X and Y to be center rect vals for placements off mapping
                motion.properties[0].setValue([cx / layout.project.w, cy / layout.project.h]); //position
                motion.properties[1].setValue(params.scale);
                
            } catch (e) {
                $.writeln("Error changing clip duration and placement.");
                $.writeln(e);
            }
        //     // Adding effects to video clips
        // }
        // var qeSeq = qe.project.getActiveSequence();
        // for (var k = 0; k < placeable; k++) {
        //     try {
        //         //var qeSeq = qe.project.getActiveSequence();
        //         // If your video track is V1, leave 0. If it's a different track, set that index.
        //         // var vt = seq.videoTracks[k + existing];

        //         // Grab track starting at existing, cant be 0
        //         // k = number of place-ables looped starting at 0
        //         var currentTrackOfInterestIndex = k + existing;
        //         var qeVTrack = qeSeq.getVideoTrackAt(currentTrackOfInterestIndex);
        //         $.writeln(currentTrackOfInterestIndex);
        //         $.writeln(k);
        //         $.writeln(existing);
        //         // Grab current clip on track
        //         // c = number of audio clips looped starting at 0, 
        //         // var currentClipIndexOffset = (c + 1) - clipsPerTrack[k];
        //         var qeItem   = qeVTrack.getItemAt(clipsPerTrack[k] - 1);

        //         $.writeln("clipsPerTrack[k] output:");
        //         $.writeln(clipsPerTrack[k]);
        //         $.writeln(clipsPerTrack[k] - 1);
        //         $.writeln("Getting track: V"+(currentTrackOfInterestIndex + 1));
        //         $.writeln(qeVTrack.numItems);
        //         //1,1,1,1,0
        //         //12,10,10,9,3

        //         // Find effects by name (locale-sensitive)
        //         var fxDrop = qe.project.getVideoEffectByName("Drop Shadow");
        //         var fxWave = qe.project.getVideoEffectByName("Wave Warp");
        //         qeItem.addVideoEffect(fxDrop);
        //         qeItem.addVideoEffect(fxDrop);
        //         qeItem.addVideoEffect(fxDrop);
        //         qeItem.addVideoEffect(fxDrop);
        //         qeItem.addVideoEffect(fxDrop);
        //         qeItem.addVideoEffect(fxDrop);
        //         qeItem.addVideoEffect(fxDrop);
        //         qeItem.addVideoEffect(fxWave);
        //         var wavewarp = getWaveWarpComponent(placedClip);
        //         wavewarp.properties[1].setValue(1); // Wave height?
        //         wavewarp.properties[2].setValue(1280); // Wave Width?
        //         wavewarp.properties[3].setValue(90); // Wave Direction?
        //         wavewarp.properties[4].setValue(0.3); // Wave Speed? 
                
        //         // Setup Opacity, 0% to 100% in 45 frames.
        //         var opacityComponent = getOpacityComponent(placedClip);
        //         opacityComponent.properties[0].setTimeVarying(true);
        //         // Add/overwrite keys
        //         //$.writeln("Opacity name");
        //         //$.writeln(opacityComponent.properties[0].displayName);
                
        //         // Adding fade in (keep as-is)
        //         opacityComponent.properties[0].addKey(placedClip.inPoint.seconds);
        //         opacityComponent.properties[0].setValueAtKey(placedClip.inPoint.seconds, 0);
        //         var fadeOutTime = placedClip.inPoint.seconds + 1; // seconds until we hit 100% Opacity
        //         opacityComponent.properties[0].addKey(fadeOutTime);   
        //         opacityComponent.properties[0].setValueAtKey(fadeOutTime, 100);

        //         // Adding fade out (use inPoint + duration; avoid exact clip end)
        //         var clipIn   = placedClip.inPoint.seconds;
        //         var clipDur  = placedClip.duration.seconds;
        //         var fadeDur  = Math.min(1.0, clipDur);            // 1s fade or shorter if clip < 1s
        //         var fadeOutStart = clipIn + clipDur - fadeDur;    // start of fade-out
        //         var fadeOutEnd   = clipIn + clipDur - 0.001;      // tiny epsilon before end

        //         opacityComponent.properties[0].addKey(fadeOutStart);
        //         opacityComponent.properties[0].setValueAtKey(fadeOutStart, 100);
        //         opacityComponent.properties[0].addKey(fadeOutEnd);
        //         opacityComponent.properties[0].setValueAtKey(fadeOutEnd, 0);
                
        //     } catch (e) {
        //         $.writeln("Error adding and managing clip affects.");
        //         $.writeln(e);
        //     }
        }

        $.writeln("Placed " + (placeable - 1) + " image(s) for segment " + (c + 1));
    }
    // $.writeln("LENGTHS of each sequence vid track starting at existing index");
    // var qeTracks = [];
    // for (var i = existing; i < app.project.activeSequence.videoTracks.numTracks; i++) {
    //     qeTracks.push(qeSeq.getVideoTrackAt(i));
    //     $.writeln(qeTracks[i - 1].numItems);
    // }

    // $.writeln("clipsPerTrack: ");
    // $.writeln(clipsPerTrack);
    
    // var track = seq.videoTracks[1]; // V2 is index 1
    // for (var i = 0; i < track.clips.numItems; i++) {
    //     $.writeln(track.clips[i].name);
    // }
    // $.writeln("FIRST and LAST");
    // $.writeln(track.clips[0].name);
    // $.writeln(track.clips[11].name);
    // $.writeln(track.clips[12].name);
    // $.writeln(track.clips[13].name);
    // $.writeln(track.clips[14].name);

    // final add affects to ALL existing clips:
    // assumes: app.enableQE(); var qeSeq = qe.project.getActiveSequence();
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
            // fallback: try same index if counts line up
            var domTrack = seq.videoTracks[trackIndex];
            if (domTrack && domTrack.clips && domTrack.clips.numItems <= qet.numItems) {
                return qet.getItemAt(domTrack.clips.numItems - 1);
            }
        } catch (e) {}
        return null;
    }

    var fxDrop = qe.project.getVideoEffectByName("Drop Shadow");
    var fxWave = qe.project.getVideoEffectByName("Wave Warp");

    // Loop all tracks from `existing` to the end (skip V1..V(existing))
    for (var t = existing; t < seq.videoTracks.numTracks; t++) {
        var domTrack = seq.videoTracks[t];
        if (!domTrack) continue;

        for (var i = 0; i < domTrack.clips.numItems; i++) {
            try {
                var clip = domTrack.clips[i];
                if (!clip) continue;

                // QE: add effects to the matching QE item for this clip
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

                // Give PPro a moment to register newly added components
                $.sleep(30);

                // EXACT SAME LOGIC as your snippet, but applied to `clip`
                // Wave Warp numeric indices (as in your code)
                var wavewarp = getWaveWarpComponent(clip);
                if (wavewarp && wavewarp.properties && wavewarp.properties.numItems >= 5) {
                    wavewarp.properties[1].setValue(1);      // Wave Height
                    wavewarp.properties[2].setValue(1280);   // Wave Width
                    wavewarp.properties[3].setValue(90);     // Direction
                    wavewarp.properties[4].setValue(0.3);    // Wave Speed
                }

                // Opacity fade in/out (same timing math, but on `clip`)
                var opacityComponent = getOpacityComponent(clip);
                if (opacityComponent) {
                    var opacity = opacityComponent.properties[0]; // "Opacity"
                    if (opacity) {
                        opacity.setTimeVarying(true);

                        // Fade in: from inPoint -> inPoint+1s (0% -> 100%)
                        var inS = clip.inPoint.seconds;
                        opacity.addKey(inS);
                        opacity.setValueAtKey(inS, 0);
                        var fadeInEnd = inS + 1.0;
                        opacity.addKey(fadeInEnd);
                        opacity.setValueAtKey(fadeInEnd, 100);

                        // Fade out: last 1s of the clip (100% -> 0%)
                        var clipDur  = clip.duration.seconds;
                        var fadeDur  = Math.min(1.0, clipDur);
                        var fadeOutStart = inS + clipDur - fadeDur;
                        var fadeOutEnd   = inS + clipDur - 0.001;

                        opacity.addKey(fadeOutStart);
                        opacity.setValueAtKey(fadeOutStart, 100);
                        opacity.addKey(fadeOutEnd);
                        opacity.setValueAtKey(fadeOutEnd, 0);
                    }
                }

            } catch (e) {
                $.writeln("Error adding/managing clip effects on V" + (t+1) + " clip #" + i + ": " + e);
            }
        }
    }

    alert("Done placing images aligned to A1 audio clips.");
})();
