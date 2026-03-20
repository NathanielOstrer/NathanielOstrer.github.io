importScripts('../lib/opencv.js');
var cvVal = self.cv;
cvVal.then(function(openCv) {
  self.cv = openCv;
  var codes = {
    RGBA2BGR: typeof cv.COLOR_RGBA2BGR !== 'undefined' ? cv.COLOR_RGBA2BGR : 'UNDEF',
    RGBA2RGB: typeof cv.COLOR_RGBA2RGB !== 'undefined' ? cv.COLOR_RGBA2RGB : 'UNDEF',
    BGR2GRAY: typeof cv.COLOR_BGR2GRAY !== 'undefined' ? cv.COLOR_BGR2GRAY : 'UNDEF',
    BGR2HSV: typeof cv.COLOR_BGR2HSV !== 'undefined' ? cv.COLOR_BGR2HSV : 'UNDEF',
    RGB2HSV: typeof cv.COLOR_RGB2HSV !== 'undefined' ? cv.COLOR_RGB2HSV : 'UNDEF',
    RGBA2GRAY: typeof cv.COLOR_RGBA2GRAY !== 'undefined' ? cv.COLOR_RGBA2GRAY : 'UNDEF'
  };

  // Test actual conversion: create a known pixel and convert
  var testMat = new cv.Mat(1, 1, cv.CV_8UC4, [255, 0, 0, 255]); // RGBA red pixel
  var bgrMat = new cv.Mat();
  cv.cvtColor(testMat, bgrMat, cv.COLOR_RGBA2BGR);
  var bgrPixel = [bgrMat.data[0], bgrMat.data[1], bgrMat.data[2]]; // should be [0,0,255] for BGR
  testMat.delete(); bgrMat.delete();

  postMessage(JSON.stringify({ codes: codes, redPixelAsBGR: bgrPixel }));
});
