var toyWindow = null;

window.exports = {
  "start-toy": {
    mode: "none",
    args: {
      enter: function () {
        if (toyWindow && !toyWindow.isDestroyed()) {
          ztools.outPlugin();
          return;
        }
        ztools.hideMainWindow();

        var w = 380;
        var h = 380;
        var x = 0;
        var y = 0;
        try {
          var cur = ztools.getCursorScreenPoint();
          if (ztools.screenToDipPoint) cur = ztools.screenToDipPoint(cur);
          var disp = ztools.getDisplayNearestPoint
            ? ztools.getDisplayNearestPoint(cur)
            : ztools.getPrimaryDisplay();
          if (disp && disp.bounds) {
            x = disp.bounds.x;
            y = disp.bounds.y;
            w = disp.bounds.width;
            h = disp.bounds.height;
          } else {
            x = Math.round(cur.x - w / 2);
            y = Math.round(cur.y - h / 2);
          }
        } catch (e) {
          try {
            var d = ztools.getPrimaryDisplay();
            if (d && d.bounds) {
              x = d.bounds.x;
              y = d.bounds.y;
              w = d.bounds.width;
              h = d.bounds.height;
            }
          } catch (e2) {}
        }

        toyWindow = ztools.createBrowserWindow("toy/index.html", {
          x: x,
          y: y,
          width: w,
          height: h,
          frame: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          resizable: true,
          hasShadow: false,
          backgroundColor: "#00000000",
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false,
          },
        });
        ztools.outPlugin();
      },
    },
  },
};
