#target photoshop
app.bringToFront();

// --- hardcoded image path ---
// var imageFile = new File("C:/Users/12038/CryptidCluesScripting/test_images/seg01/gnome.jpg");
var pathToImageDir = "C:/Users/12038/CryptidCluesScripting/test_images/seg01/"
var imageFolder = new Folder(pathToImageDir);

if (!imageFolder.exists) {
    alert("Folder not found: " + imageFolder.fsName);
} else {
    var files = imageFolder.getFiles(); // gets all files & subfolders

    var names = [];
    for (var i = 0; i < files.length; i++) {
        if (files[i] instanceof File) {
            names.push(files[i].name);
        }
    }

    // Show results
    $.writeln("Found " + names.length + " files:\n\n" + names.join("\n"));
    // Also write to ESTK console
    $.writeln("Files in " + imageFolder.fsName + ":");
    for (var j = 0; j < names.length; j++) {
        $.writeln(names[j]);
    }

    var targetDoc = app.activeDocument;

    for (var k = 0; k < names.length; k++) {
        $.writeln("pathToImageDir + names[0]");
        $.writeln(pathToImageDir + names[k]);
        var fullCurrentImagePath = new File(pathToImageDir + names[k]);
        var src = app.open(fullCurrentImagePath);
        src.flatten();
        src.layers[0].duplicate(targetDoc, ElementPlacement.PLACEATBEGINNING);
        src.close(SaveOptions.DONOTSAVECHANGES);
        app.activeDocument = targetDoc;
        targetDoc.activeLayer.name = names[0];
        $.writeln("Imported " + names[0] + " as a new layer.");
    }

}