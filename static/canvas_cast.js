// cast canvas.
"use strict";

var canvasId = 'screen';
var streamType = 'video/webm;codecs=h264';
var segmentLength = 100;

var videoFrame = 0;
function drawFrame(ctx, width, height) {
	ctx.clearRect(0, 0, width, height);

	ctx.font = "40px sans-serif";
	ctx.fillText("FRAME:" + videoFrame, 10, 60);
	ctx.fillText(new Date().toString(), 10, 120);

	ctx.save();
	ctx.translate(parseInt(width / 2), parseInt(height / 2)); 
	ctx.rotate((videoFrame * Math.PI) / 180);

	ctx.beginPath();
	ctx.strokeRect(-50, -50, 100, 100);

	ctx.restore();

	videoFrame++;
}

function searchConfigRecord(b) {
	// parse NAL.
	// TODO get SPS(7) PPS(8)
	return null;
}

function createStreamMessage(type, e, payload) {
	let header = new ArrayBuffer(20);
	let hv = new DataView(header);
	let t = e.value.timecode + e.parent.timecode;
	hv.setUint16(0, type); // type: stream data.
	hv.setUint16(2, header.byteLength-4); // header size.
	hv.setUint32(4, 0); // TODO: Uint64 timestamp
	hv.setUint32(8, t); // Timestamp
	hv.setUint32(12, 1000); // Timescale.
	hv.setUint32(16, 0x61766300); // 'avc'
	return new Blob([header, payload]);
}

window.addEventListener('DOMContentLoaded',(function(e){
	let canvas = document.getElementById(canvasId);
	let ctx =canvas.getContext('2d');
	ctx.fillStyle = "rgb(255, 0, 0)";
	ctx.strokeStyle = "rgb(0, 0, 255)";

	let w = canvas.width;
	let h = canvas.height;
	
	setInterval(function() { drawFrame(ctx, w, h); }, 33);
	if (! window.MediaRecorder) {
		document.getElementById('status').innerText = "MediaRecorder undefined.";
	}

	let recorder = null;
	document.getElementById('start').addEventListener('click', function() {
		let ws = new WebSocket(document.getElementById('wsurl').value);
		let startRecoder = function () {
			if (recorder == null) {
				let parser = new WebmPerser();
				let configRecord = null;
				parser.setListenser('simple_block', function(e) {
					if (configRecord == null) {
						configRecord = searchConfigRecord(e.value.payload);
						// TODO
						if (configRecord != null) {
							console.log("ok. configurations.");
							if (ws) {
								ws.send(createStreamMessage(2, e, configRecord));
							}
						}
					}
					console.log(e.name);
					console.log(" size:" + e.value.payload.length);
					console.log(" time:" + e.value.timecode + " + " + e.parent.timecode);
					console.log(" flags:" + e.value.flags);
					if (ws) {
						ws.send(createStreamMessage(3, e, e.value.payload));
					}
					e.value = null; // avoid append to parent.
				});
	
				let canvasStream = canvas.captureStream();
				console.log(MediaRecorder.isTypeSupported(streamType));
				recorder = new MediaRecorder(canvasStream, {mimeType: streamType});
				recorder.ondataavailable = function(event) {
					if (event.data.size > 0) {
						console.log("data size: " + event.data.size);
						let reader = new FileReader();
						reader.onload = function() {
							parser.append(new Uint8Array(reader.result));
							parser.tryParse();
						};
						reader.readAsArrayBuffer(event.data);
					}
				  };
				recorder.start(segmentLength);
			}
		};	
		document.getElementById('status').innerText = "Connecting.";

		ws.addEventListener('open', function (event) {
			ws.send(JSON.stringify({"type":"connect", "debugMessage": "Hello!"}));
			startRecoder();
			document.getElementById('status').innerText = "Started.";
		});

		ws.addEventListener('close', function (event) {
			document.getElementById('status').innerText = "WebSocket Error.";
			startRecoder();
			ws = null;
		});

	}, true);

	document.getElementById('stop').addEventListener('click', function() {
		document.getElementById('status').innerText = "Ready.";
		if (recorder != null) {
			recorder.stop();
			recorder = null;
		}
	}, true);

	console.log("%cTest", 'color:Chocolate ; font-weight:bold; font-size:40pt');
}),false);
