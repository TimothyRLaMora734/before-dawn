'use strict';

/***

   Welcome to....

    ____        __                  ____                       
   | __ )  ___ / _| ___  _ __ ___  |  _ \  __ ___      ___ __  
   |  _ \ / _ \ |_ / _ \| '__/ _ \ | | | |/ _` \ \ /\ / / '_ \ 
   | |_) |  __/  _| (_) | | |  __/ | |_| | (_| |\ V  V /| | | |
   |____/ \___|_|  \___/|_|  \___| |____/ \__,_| \_/\_/ |_| |_|

   a screensaver package built on the tools of the web. Enjoy!
   
 */

const electron = require('electron');
const app = electron.app;  // Module to control application life.
const BrowserWindow = electron.BrowserWindow;  // Module to create native browser window.
const Menu = electron.Menu;
const Tray = electron.Tray;
const {ipcMain} = require('electron');

const fs = require('fs');
const path = require('path');
const screen = require('./lib/screen.js');
const parseArgs = require('minimist');

const releaseChecker = require('./lib/release_check.js');
const power = require('./lib/power.js');

// NOTE -- this needs to be global, otherwise the app icon gets
// garbage collected and won't show up in the system tray
let appIcon = null;

let argv = parseArgs(process.argv);
let debugMode = ( argv.debug === true );

let saverWindows = [];

let stateManager = require('./lib/state_manager.js');

var grabber;

// track total displays so that when the screensaver is
// running everywhere we can handle some background work
var totalDisplays = 0;

var appReady = false;
var configLoaded = false;

var shouldQuit = false;

var globalJSCode, globalCSSCode;

var prefsWindowHandle = null;


/**
 * Open the preferences window
 */
var openPrefsWindow = function() {
  var electronScreen = electron.screen;
  var primary = electronScreen.getPrimaryDisplay();
  var displays = [
    primary
  ];

  // take a screenshot of the main screen for use in previews
  ipcMain.once("screenshot-" + primary.id, function(e, message) {
    grabber.reload();

    // call savers.reload to make sure our data is properly refreshed
    // and check for any system updates
    global.savers.reload(function() {
      var prefsUrl = 'file://' + __dirname + '/ui/prefs.html';
      prefsWindowHandle = new BrowserWindow({
        width:800,
        height:675,
        resizable:true,
        icon: path.join(__dirname, 'assets', 'icon.png')
      });

      prefsUrl = prefsUrl + "?screenshot=" + encodeURIComponent("file://" + message.url);
      
      prefsWindowHandle.loadURL(prefsUrl);
      
      if ( typeof(app.dock) !== "undefined" ) {
        app.dock.show();
      }

      if ( debugMode === true ) {
        prefsWindowHandle.webContents.openDevTools();
      }

      prefsWindowHandle.on('closed', function() {
        prefsWindowHandle = null;
        global.savers.reload();
        updateStateManager();

        if ( typeof(app.dock) !== "undefined" ) {
          app.dock.hide();
        }
      });
    });
  });


  grabber.webContents.send('screengrab-request', displays);
};


/**
 * Open the About window for the app
 */
var openAboutWindow = function() {
  var prefsUrl = 'file://' + __dirname + '/ui/about.html';
  var w = new BrowserWindow({
    width:450,
    height:300,
    resizable:false,
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  w.loadURL(prefsUrl);
  if ( typeof(app.dock) !== "undefined" ) {
    app.dock.show();
  }
  
  if ( debugMode === true ) {
    w.webContents.openDevTools();
  }
  w.on('closed', function() {
    w = null;
    if ( typeof(app.dock) !== "undefined" ) {
      app.dock.hide();
    }
  });
};

var openHelpUrl = function() {
  require('electron').shell.openExternal(global.HELP_URL);
};


/**
 * open our screen grabber tool. this should run in the background,
 * waiting to take screenshots when needed.
 */
var openScreenGrabber = function() {
  var grabberUrl = 'file://' + __dirname + '/ui/grabber.html';
  grabber = new BrowserWindow({
    show: debugMode === true,
    width:800,
    height:600
  });

  grabber.loadURL(grabberUrl);
  
  if ( debugMode === true ) {
    grabber.webContents.openDevTools();
  }
  grabber.on('closed', function() {
    grabber = null;
  });
};


/**
 * run the specified screensaver on the specified screen
 */
var runScreenSaverOnDisplay = function(saver, s) {
  var size = s.bounds;
  var url_opts = { 
    width: size.width,
    height: size.height,
    platform: process.platform
  };
  
  var windowOpts = {
    fullscreen: ( debugMode !== true ),
    autoHideMenuBar: true,
    alwaysOnTop: true,
    x: s.bounds.x,
    y: s.bounds.y
  };

  // don't do anything if we don't actually have a screensaver
  if ( typeof(saver) === "undefined" || saver === null ) {
    return;
  }
  
  // listen for an event that we have an image of the display we will run on before completing setup
  ipcMain.once("screenshot-" + s.id, function(e, message) {
    var w = new BrowserWindow(windowOpts);       

    saverWindows.push(w);

    if ( debugMode === true ) {
      w.webContents.openDevTools();
    }
    
    // Emitted when the window is closed.
    w.on('closed', function() {
      w.isClosed = true;
      console.log("window closed!");

      if ( ! screenSaverIsRunning() ) {
        console.log("all windows closed, reset");
        stateManager.reset();
      }
    });
    
    
    url_opts.screenshot = encodeURIComponent("file://" + message.url);

    var url = saver.getUrl(url_opts);
    //console.log("loading " + url);
    
    // and load the index.html of the app.
    w.loadURL(url);
    
    // windows is having some issues with putting the window behind existing
    // stuff -- @see https://github.com/atom/electron/issues/2867
    if ( process.platform == "win32" ) {
      w.minimize();
    }
    w.focus();
    
    // inject our custom JS and CSS here
    w.webContents.on('did-finish-load', function() {
      w.webContents.insertCSS(globalCSSCode);      
      w.webContents.executeJavaScript(globalJSCode);
    });

    
    // reload the screengrabber window to keep it from churning
    // CPU, until I can figure out why that is even happening
    if ( saverWindows.length >= totalDisplays ) {
      //console.log("Reloading screengrabber");
      grabber.reload();
    }

  });
};

/**
 * get a list of displays connected to the computer.
 */
var getDisplays = function() {
  var electronScreen = electron.screen;
  var displays = [];
  if ( debugMode === true ) {
    displays = [
      electronScreen.getPrimaryDisplay()
    ];
  }
  else {
    displays = electronScreen.getAllDisplays();
  }

  return displays;
};


var setStateToRunning = function() {
  stateManager.run();
};


/**
 * run the user's chosen screensaver on any available screens
 */
var runScreenSaver = function() {
  var displays = getDisplays();
  var saver = global.savers.getCurrentData();

  // make sure we have something to display
  if ( typeof(saver) === "undefined" ) {
    return;
  }

  // @todo maybe add an option to only run on a single display?
  
  // limit to a single screen when debugging
  if ( debugMode === true ) {
    if ( typeof(app.dock) !== "undefined" ) {
      app.dock.show();
    }
  }

  totalDisplays = displays.length;

  try {
    for ( var i in displays ) {
      runScreenSaverOnDisplay(saver, displays[i]);
    } // for

    grabber.webContents.send('screengrab-request', displays);
  }
  catch (e) {
    console.log(e);
  }
};

var screenSaverIsRunning = function() {
  return ( saverWindows.length > 0 );
}

/**
 * should we lock the user's screen when returning from running the saver?
 */
var shouldLockScreen = function() {
  return ( savers.getLock() === true );
};

/**
 * stop the running screensaver
 */
var stopScreenSaver = function(fromBlank) {
  console.log("received stopScreenSaver call");

  if ( ! screenSaverIsRunning() || debugMode === true ) {
    return;
  }

  if ( fromBlank !== true ) {
    console.log("fromBlank", fromBlank);
    stateManager.reset();
  }
  
  // trigger lock screen before actually closing anything
  if ( shouldLockScreen() ) {
    screen.doLockScreen();
  }

  for ( var s in saverWindows ) {
    saverWindows[s].destroy();
  }
};



var trayMenu;


/**
 * once the app is ready and our config is loaded, check to see if the app
 * has been loaded before. if not, let's go ahead and open the prefs window now.
 */
var openPrefsOnFirstLoad = function() {
  if ( appReady === false || configLoaded === false ) {
    return;
  }
  if ( savers.firstLoad() === true ) {
    setTimeout(openPrefsWindow, 1000);
  }
};


/**
 * handle initial startup of app
 */
var bootApp = function(_basePath) {
  if ( typeof(_basePath) !== "undefined" ) {
    global.basePath = _basePath;
  }

  trayMenu.items[3].visible = global.NEW_RELEASE_AVAILABLE;

  global.savers.init(global.basePath, function() {
    configLoaded = true;
    updateStateManager();

    openPrefsOnFirstLoad();
  });
};

var runScreenSaverIfPowered = function() {
  console.log("runScreenSaverIfPowered");
  // check if we are on battery, and if we should be running in that case
  if ( global.savers.getDisableOnBattery() ) {
    power.charging().then((is_powered) => {
      if ( is_powered ) {
        runScreenSaver();
      }
      else {
        console.log("I would run, but we're on battery :(");
        stateManager.resetAt(savers.getDelay() * 60000);
      }
    });
  }
  else {
    runScreenSaver();
  }
};

var blankScreenIfNeeded = function() {
  if ( screenSaverIsRunning() ) {
    stopScreenSaver(true);
    screen.doSleep();
  }
  else {
    stateManager.reset();
  }
}

var updateStateManager = function() {
  stateManager.setup({
    idleTime: savers.getDelay() * 60000,
    blankTime: savers.getSleep() * 60000,
    onIdleTime: runScreenSaverIfPowered,
    onBlankTime: blankScreenIfNeeded
  });
};


// load a few global variables
require('./bootstrap.js');

// store our root path as a global variable so we can access it from screens
global.basePath = app.getPath('appData') + "/" + global.APP_DIR;
global.savers = require('./lib/savers.js');

// some global JS/CSS we'll inject into running screensavers
globalJSCode = fs.readFileSync( path.join(__dirname, 'assets', 'global-js-handlers.js'), 'ascii');
globalCSSCode = fs.readFileSync( path.join(__dirname, 'assets', 'global.css'), 'ascii');  


/**
 * make sure we're only running a single instance
 */
shouldQuit = app.makeSingleInstance(function(commandLine, workingDirectory) {
  return true;
});

if (shouldQuit) {
  app.quit();
}

// don't show app in dock
if ( typeof(app.dock) !== "undefined" ) {
  app.dock.hide();
}

// seems like we need to catch this event to keep OSX from exiting app after screensaver runs?
app.on('window-all-closed', function() {
  console.log("window-all-closed");
});

trayMenu = Menu.buildFromTemplate([
  {
    label: 'Run Now',
    click: function() { setStateToRunning(); }
  },
  {
    label: 'Disable',
    click: function() {
      stateManager.pause();
      trayMenu.items[1].visible = false;
      trayMenu.items[2].visible = true;
    }
  },
  {
    label: 'Enable',
    click: function() { 
      stateManager.reset();
      trayMenu.items[1].visible = true;
      trayMenu.items[2].visible = false;
    },
    visible: false
  },
  {
    label: 'Update Available!',
    click: function() { 
      require('electron').shell.openExternal('https://github.com/' + global.APP_REPO + '/releases/latest');
    },
    visible: (global.NEW_RELEASE_AVAILABLE === true)
  },
  {
    label: 'Preferences',
    click: function() { openPrefsWindow(); }
  },
  {
    label: 'About ' + global.APP_NAME,
    click: function() { openAboutWindow(); }
  },
  {
    label: 'Help',
    click: function() { openHelpUrl(); }
  },
  {
    label: 'Quit',
    click: function() { app.quit(); }
  }
]);



// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.once('ready', function() {  
  appIcon = new Tray(__dirname + '/assets/icon.png');
  appIcon.setToolTip(global.APP_NAME);
  appIcon.setContextMenu(trayMenu); 

  var menuTemplate = require("./ui/menu_template.js").buildMenuTemplate(app);
  var menu = Menu.buildFromTemplate(menuTemplate);

  Menu.setApplicationMenu(menu);

  openScreenGrabber();

  if ( argv.screen === "prefs" ) {
    openPrefsWindow();
  }
  else if ( argv.screen === "about" ) {
    openAboutWindow();
  }
  else if ( argv.screen === "saver" ) {
    setStateToRunning();
  }
  
  appReady = true;

  openPrefsOnFirstLoad();
});


//
// listen for a message from global.js that we should stop running the screensaver
//
ipcMain.on("stopScreenSaver", (event, arg) => {
  stopScreenSaver();
});


//
// if the user has updated one of their screensavers, we can let
// the prefs window know that it needs to reload
//
ipcMain.on('savers-updated', (event, arg) => {
  if ( prefsWindowHandle !== null ) {
    prefsWindowHandle.send('savers-updated', arg);
  }
});



/**
 * check for a release and then boot!
 */
releaseChecker.checkLatestRelease(
  global.APP_REPO, global.APP_VERSION, 
  function() {
    global.NEW_RELEASE_AVAILABLE = true;
    bootApp();
  }, 
  function() {
    bootApp();
  });
