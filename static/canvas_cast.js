// cast canvas.
"use strict";

var canvasId = 'screen';
var streamType = 'video/webm;codecs=h264';
var segmentLength = 100;
var avc = streamType.includes('h264');

var videoFrame = 0;
function drawFrame(ctx, width, height) {
	ctx.clearRect(0, 0, width, height);
	ctx.save();
	ctx.translate(parseInt(width / 2), parseInt(height / 2)); 

	let cameraVideo = document.getElementById('camera');
	if (cameraVideo && cameraVideo.videoWidth > 0) {
		var w = cameraVideo.videoWidth;
		var h = cameraVideo.videoHeight;
		ctx.drawImage(cameraVideo, -w/2, -h/2, w, h);
	} else {
		ctx.rotate((videoFrame * Math.PI) / 180);
		ctx.strokeRect(-50, -50, 100, 100);
	}

	ctx.restore();
	ctx.font = "40px sans-serif";
	ctx.fillText("FRAME:" + videoFrame, 10, 60);
	ctx.fillText(new Date().toString(), 10, 120);

	videoFrame++;
}

function searchConfigRecord(b) {
	// parse NAL.
	// TODO: multiple pps?
	let sps = [], pps = [];
	let type = 0;
	for (let i = 0; i < b.length-4; i++) {
		if (b[i] == 0 && b[i+1] == 0 && b[i+2] == 0 && b[i+3] == 1) {
			console.log("NAL unit type" + (b[i+4]&0x1f));
			type = (b[i+4]&0x1f);
			if (type == 7) {
				console.log(" SPS profile" + (b[i+5]));
				console.log(" SPS level" + (b[i+7]));
			}
			i += 3;
		} else {
			if (type == 7) sps.push(b[i]);
			if (type == 8) pps.push(b[i]);
		}
	}
	console.log("SPS", sps);
	console.log("PPS", pps);
	var profile_idc = sps[1];
	var level_idc = sps[3];
	var compat = 0;
	var r = new Uint8Array(sps.length + pps.length + 11);
	r.set([1, profile_idc, compat, level_idc, 0xff, (7 << 5) | 1, sps.length << 8, sps.length]);
	r.set(sps, 8);
	r.set([1, 0, pps.length], 8 + sps.length);
	r.set(pps, 8 + sps.length + 3);
	console.log(r);
	return r;
}

function setNalUnitSize(b) {
	let p = -1;
	for (let i = 0; i < b.length-4; i++) {
		if (b[i] == 0 && b[i+1] == 0 && b[i+2] == 0 && b[i+3] == 1) {
			if (p >= 0) {
				let sz = i - p - 4;
				b[p + 0] = (sz >> 24) & 0xff;
				b[p + 1] = (sz >> 16) & 0xff;
				b[p + 2] = (sz >> 8 ) & 0xff;
				b[p + 3] = (sz      ) & 0xff;
			}
			p = i;
		}
	}
	if (p >= 0) {
		let sz = b.length - p - 4;
		b[p + 0] = (sz >> 24) & 0xff;
		b[p + 1] = (sz >> 16) & 0xff;
		b[p + 2] = (sz >> 8 ) & 0xff;
		b[p + 3] = (sz      ) & 0xff;
	}
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

	if (location.protocol != "file:") {
		document.getElementById('wsurl').value = (location.protocol=="https:" ? "wss://" : "ws://")+location.host+'/stream/test'
	}

	let recorder = null;
	document.getElementById('start').addEventListener('click', function() {
		let ws = new WebSocket(document.getElementById('wsurl').value);
		let startRecoder = function () {
			if (recorder == null) {
				if (ws != null) {
					ws.send(JSON.stringify({"type":"connect", "debugMessage": "Hello!"}));
				}
				let parser = new WebmParser();
				let configRecord = null;
				parser.setListenser('simple_block', function(e) {
					if (configRecord == null) {
						if (avc) {
							configRecord = searchConfigRecord(e.value.payload);
						} else {
							// TODO
							configRecord = "";
						}
						if (configRecord != null) {
							console.log("ok. configurations.");
							if (ws) {
								ws.send(createStreamMessage(2, e, configRecord));
							}
						}
					}
					console.log("frame time:" + e.value.timecode + "+" + e.parent.timecode + " flags:" + e.value.flags);
					if (ws) {
						if (avc) setNalUnitSize(e.value.payload);
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
							parser.appendBuf(new Uint8Array(reader.result));
							parser.tryParse();
						};
						reader.readAsArrayBuffer(event.data);
					}
				};
				recorder.onerror = function(event) {
					console.log("recorder error", event);
				};
				recorder.start(segmentLength);
			}
		};	
		document.getElementById('status').innerText = "Connecting.";

		ws.addEventListener('open', function (event) {
			startRecoder();
			document.getElementById('status').innerText = "Started.";
		});

		ws.addEventListener('close', function (event) {
			startRecoder();
			document.getElementById('status').innerText = "WebSocket Error.";
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


	// camera
	if (navigator.getUserMedia) {
		document.getElementById('cameraTest').addEventListener('click', function() {
			let cameraVideo = document.getElementById('camera');
			let localMediaStream = null;
			navigator.getUserMedia({video: true}, function(stream) {
				cameraVideo.srcObject = stream;
			}, function(error) {
				console.log("camera error", error);
			});
		}, true);
	}

	// d & d video file.
	canvas.addEventListener('dragover', function(e){
		if (e.dataTransfer.types[0] == 'Files') {
			e.preventDefault();
		}
	});
	canvas.addEventListener('drop', function(e){
		e.preventDefault();
		var files = e.dataTransfer.files;
		if (files.length > 0) {
			let cameraVideo = document.getElementById('camera');
			cameraVideo.src = URL.createObjectURL(files[0])
		}
	});

	console.log("%cTest", 'color:Chocolate ; font-weight:bold; font-size:40pt');
}),false);
