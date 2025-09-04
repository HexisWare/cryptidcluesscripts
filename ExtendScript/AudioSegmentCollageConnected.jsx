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
    function pad2(n) { return (n < 10 ? "0" : "") + n; }

    function getFolderForSegment(segIndex) {
        var segName = "seg" + pad2(segIndex);
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

        /*
        // Preferred: QE addTracks(videoCount, audioCount)
        if (qeSeq && typeof qeSeq.addTracks === "function") {
            try {
                for (var i = 0; i < toAdd; i++) { qeSeq.addTracks(1, 0); added++; }
            } catch (e1) { $.writeln("qeSeq.addTracks failed: " + e1); }
        }

        // Fallback: QE addVideoTrack()
        if (added < toAdd && qeSeq && typeof qeSeq.addVideoTrack === "function") {
            try {
                for (var j = added; j < toAdd; j++) { qeSeq.addVideoTrack(); added++; }
            } catch (e2) { $.writeln("qeSeq.addVideoTrack failed: " + e2); }
        }
        
        */
    
        /*
            // Example: Add 1 video and 1 audio track after the current third video track
            activeSequence.addTracks(1, 3, 1, 3); // numVideo, afterVideo, numAudio, afterAudio
            */
        try {
            for (var i = 0; i < toAdd; i++) { qeSeq.addTracks(1,3,0); added++; }
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
        $.writeln(" using images in this directory: " + "C:/Users/12038/CryptidCluesScripting/test_images/seg0" + (c + 1));

        var outJson = "C:/Users/12038/CryptidCluesScripting/output/layout_project_seg" + (c + 1) + ".json";
        LAYOUT_JSON = outJson;
        var pngPath = "C:/Users/12038/CryptidCluesScripting/output/all_iterations_" + (c + 1) + ".png";
        //var waitFile = DISPLAY_OUTPUT ? pngPath : outJson;
        var waitFile = pngPath;
        var txt = runPythonPremiere(
            "C:/Users/12038/AppData/Local/Programs/Python/Python311/python.exe",
            "C:/Users/12038/CryptidCluesScripting/2DBinMaxReactPacking.py",
            [
              "--images-dir", "C:/Users/12038/CryptidCluesScripting/test_images/seg0" + (c + 1),
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
        var existing = 2;    // will be used to offset so already placed clips on existing tracks will be skipped    
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
        $.writeln("layout:");
        $.writeln(JSON.stringify(layout, null, 2)); // pretty JSON

        $.writeln("layout placements:");
        $.writeln(JSON.stringify(layout.placements, null, 2));

        $.writeln("map:");
        $.writeln(JSON.stringify(map, null, 2));

        
        // k is each track to be added/used here
        for (var k = 0; k < placeable; k++) {
            var projItem = items[k];
            if (!projItem) continue;

            var vt = seq.videoTracks[k + existing]; // V1..Vn
            var startTime = timeFromTicks(startTicks);
            if (c != 0) {
                // if we are on the second iteration, just use previous clip info
                startTime = a1.clips[c - 1].end.ticks;
            }

            // Overwrite at the clip start
            var newTI = vt.overwriteClip(projItem, startTime);
            if (!newTI) {
                $.writeln("Failed to place image on V" + (k + 1));
                continue;
            }

            // Align in/out to the audio clip span
            try {
                // vt.clips[c] is the current image clip we want
                // a1.clips[c] is the current audio clip we want
                $.writeln("Clip info: ");
                $.writeln(vt.clips[c].name);
                $.writeln(a1.clips[c].name);
                vt.clips[c].end = a1.clips[c].end.seconds;
                //now it's in sequence and aligned, change position and scale
                $.writeln("Layout usage handling");
                var motion = getMotionComponent(vt.clips[c]);
                $.writeln("motion");
                $.writeln(motion);
                if (!motion) {
                    missing.push(name + " (no Motion component)");
                    continue;
                }
                 //Hard setting Motion components such as position and scale
                var place = map[vt.clips[c].name];
                $.writeln("place");
                $.writeln(place);
                var params = motionParamsFromPlacement(place);
                $.writeln("params.pos");
                $.writeln(params.pos);
                $.writeln(params.pos[0]);
                $.writeln(params.pos[1]);
                $.writeln("params.scale");
                $.writeln(params.scale);

                $.writeln("motion.properties");
                $.writeln(motion.properties);
                $.writeln("motion.properties[0].displayName");
                $.writeln(motion.properties[0].displayName);
                $.writeln("motion.properties[1].displayName");
                $.writeln(motion.properties[1].displayName);
                motion.properties[0].setTimeVarying(false);
                motion.properties[1].setTimeVarying(false);
                // need center position, not top left
                var left = Number(place.x);
                var top  = Number(place.y);
                var fw   = Number(place.w);  // final width after scaling
                var fh   = Number(place.h);  // final height after scaling
                $.writeln("setting to center position");
                $.writeln(left);
                $.writeln(place.y);
                $.writeln(place.w);  // final width after scaling
                $.writeln(place.h);  // final height after scaling
                // Center of rect
                var cx = left + fw/2;
                var cy = top  + fh/2;
                $.writeln(cx);
                $.writeln(cy);
                $.writeln("layout project w and h");
                $.writeln(layout.project.w);
                $.writeln(layout.project.h);
                $.writeln(cx / layout.project.w);
                $.writeln(cy / layout.project.h);
                motion.properties[0].setValue([cx / layout.project.w, cy / layout.project.h]); //position
                motion.properties[1].setValue(params.scale);
                
            } catch (e) {
                $.writeln("Error changing clip duration.");
                $.writeln(e);
                //try {
                   // newTI.duration = timeFromTicks(durTicks);
                //} catch (e2) {
                    //$.writeln("Could not set duration; still may already match.");
                //}
            }
        }

        $.writeln("Placed " + placeable + " image(s) for segment " + (c + 1));
    }

    alert("Done placing images aligned to A1 audio clips.");
})();
