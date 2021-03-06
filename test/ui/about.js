"use strict";

const assert = require("assert");
const helpers = require("../helpers.js");
const packageJSON = require("../../package.json");

var workingDir;
let app;

describe("About", function() {
  const windowTitle = "Before Dawn: About!";
  helpers.setupTest(this);

  beforeEach(() => {
    workingDir = helpers.getTempDir();
    helpers.setupFullConfig(workingDir);

    app = helpers.application(workingDir, true);

    return app.start().
              then(() => helpers.waitUntilBooted(app) ).
              then(() => app.electron.ipcRenderer.send("open-window", "about")).
              then(() => helpers.waitForWindow(app, windowTitle) );
  });

	afterEach(function() {
    if (this.currentTest.state === "failed") {
      helpers.outputLogs(app);
    }

    return helpers.stopApp(app);
	});

  it("has some text and current version number", function() {
    return helpers.waitForWindow(app, windowTitle).
      then(() => app.client.getText("body")).
      then((res) => {
        assert(res.lastIndexOf("// screensaver fun //") !== -1);
        assert(res.lastIndexOf(packageJSON.version) !== -1);
      });
  });
});
