"use strict";

module.exports.charging = function() {
  if ( process.platform === "darwin") {
    var osxBattery = require("osx-battery");

    return osxBattery().then(res => {
      return res.isCharging || res.fullyCharged;
    }).catch(() => {
      return false;
    });
  }
  else if ( process.platform === "linux") {
    var linuxBattery = require("linux-battery");
    
    // NOTE: this is not actually tested
    return linuxBattery().then(res => {
      return ( !res.state || res.state !== "discharging" );
    }).catch(() => {
      return true;
    });
  } 
  else {
    // this code is modified from https://github.com/gillstrom/battery-level/blob/master/win.js
    var p = new Promise(function(resolve, reject) {
      var cmd = "WMIC";
      let args = ["Path", "Win32_Battery", "Get", "BatteryStatus"];

      //Other (1)
      //The battery is discharging.
      var exec = require("child_process").execFile;
      exec(cmd, args, function(error, stdout) {
        // console.log("stdout: " + stdout);
        // console.log("stderr: " + stderr);
        if (error !== null) {
          reject(error);
        }

        stdout = parseInt(stdout.trim().split("\n")[1], 10);

        var result = (stdout !== 1);
        resolve(result);
      });
    });

    return p;    
  }
};
