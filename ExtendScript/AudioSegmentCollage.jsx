$.writeln("-------------------------------------------------------");

// ========= USER SET THIS =========
var imagesDirectoryPath = "D:/Youtube/CryptidClues/Season3/images/TESTautomatedScriptsVideo"; // e.g. "D:/assets/my_collage_images"
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
        var want = items.length + existing;
        var have = ensureVideoTracks(want);
        var placeable = Math.min(want, have);
        if (placeable < want) {
            $.writeln("Only " + placeable + " video track(s) available; placing first " + placeable + " image(s), skipping " + (want - placeable) + ".");
        }

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
