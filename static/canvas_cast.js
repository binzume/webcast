// cast canvas.
"use strict";

let canvasId = 'screen';
let streamType = 'video/webm;codecs=avc1';
let publisher = new Publisher();

let videoFrame = 0;
function drawFrame(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2, height / 2);

    let cameraVideo = document.getElementById('camera');
    if (cameraVideo && cameraVideo.videoWidth > 0) {
        var w = cameraVideo.videoWidth;
        var h = cameraVideo.videoHeight;
        ctx.drawImage(cameraVideo, -w / 2, -h / 2, w, h);
    } else {
        ctx.rotate((videoFrame * Math.PI) / 180);
        ctx.strokeRect(-50, -50, 100, 100);
    }

    ctx.restore();
    ctx.font = "40px sans-serif";
    ctx.fillText("FRAME:" + videoFrame + "  BYTES:" + publisher.bytes, 10, 60);
    ctx.fillText(new Date().toString(), 10, 120);

    videoFrame++;
}

window.addEventListener('DOMContentLoaded', (function (e) {
    let canvas = document.getElementById(canvasId);
    let ctx = canvas.getContext('2d');
    ctx.fillStyle = "rgb(255, 0, 0)";
    ctx.strokeStyle = "rgb(0, 0, 255)";

    let w = canvas.width;
    let h = canvas.height;

    setInterval(function () { drawFrame(ctx, w, h); }, 33);
    if (!window.MediaRecorder) {
        document.getElementById('status').innerText = "MediaRecorder undefined.";
    }

    if (location.protocol != "file:") {
        let wsurl = document.getElementById('wsurl');
        wsurl.value = wsurl.value.replace(/^ws:\/\/[\w:]+/, (location.protocol == "https:" ? "wss://" : "ws://") + location.host);
    }

    document.getElementById('start').addEventListener('click', function () {
        let canvasStream = canvas.captureStream();
        publisher.start(canvasStream, streamType, document.getElementById('wsurl').value, "");
    }, true);

    document.getElementById('stop').addEventListener('click', function () {
        publisher.stop();
        document.getElementById('status').innerText = "Ready.";
    }, true);


    // camera
    if (navigator.mediaDevices) {
        document.getElementById('cameraTest').addEventListener('click', function () {
            let cameraVideo = document.getElementById('camera');
            let localMediaStream = null;

            navigator.mediaDevices.enumerateDevices().then((devices) => {
                let videoDevices = devices.filter((d) => {
                    return d.kind == 'videoinput';
                });
                console.log(videoDevices);
                let d = videoDevices[videoDevices.length - 1];
                navigator.mediaDevices.getUserMedia({ video: { optional: [{ sourceId: d.deviceId }] } }).then((stream) => {
                    cameraVideo.srcObject = stream;
                }, (error) => {
                    console.log("camera error", error);
                });
            });
        }, true);
    } else if (navigator.getUserMedia) {
        // legacy api.
        document.getElementById('cameraTest').addEventListener('click', function () {
            let cameraVideo = document.getElementById('camera');
            let localMediaStream = null;
            navigator.getUserMedia({ video: true }, (stream) => {
                cameraVideo.srcObject = stream;
            }, (error) => {
                console.log("camera error", error);
            });
        }, true);
    }

    // d & d video file.
    canvas.addEventListener('dragover', function (e) {
        if (e.dataTransfer.types[0] == 'Files') {
            e.preventDefault();
        }
    });
    canvas.addEventListener('drop', function (e) {
        e.preventDefault();
        let files = e.dataTransfer.files;
        if (files.length > 0) {
            let cameraVideo = document.getElementById('camera');
            cameraVideo.srcObject = null;
            cameraVideo.src = URL.createObjectURL(files[0]);
        }
    });

    console.log("%cTest", 'color:Chocolate ; font-weight:bold; font-size:40pt');
}), false);
