// player
"use strict";
var streamType = 'video/webm;codecs=vp8';

class Player {
    constructor(segmentLength) {
		this.ws = null;
	}
	start(wsURL, streamName, video) {
        if (this.ws != null || wsURL == "") {
            // for debugging
            return;
        }

		this.ws = new WebSocket(wsURL);
		this.ws.binaryType = 'arraybuffer';
		let f = false;
		this.ws.addEventListener('open', (event) => {
			console.log(event);
			// init media source.
			this.mediaSource = new MediaSource();
			this.mediaSource.addEventListener('sourceopen', () => {
				this.sourceBuffer = this.mediaSource.addSourceBuffer(streamType);
				this.sourceBuffer.addEventListener('updateend', () => {
					console.log("updateend...");
					f = true;
				}, false);
				this.ws.send(JSON.stringify({"type":"connect", "stream":streamName, "debugMessage": "Hello!"}));
			}, false);
	
			console.log(this.mediaSource);
			// video.srcObject = this.mediaSource; not work
			video.src = URL.createObjectURL(this.mediaSource);
		});
		video.addEventListener('error', (e) => { console.log(e, video.error); throw("error" + video.error.detail) }, true);
		this.ws.addEventListener('close', (event) => {
			console.log(event);
            this.ws = null;
		});
		let parser = new WebmParser(); // debug
		let tt = 1000;
        parser.setListenser('tracks', (e) => {console.log(e)});
        parser.setListenser('cluster', (e) => {console.log(e)});
		this.ws.addEventListener('message', (event) => {
			// TODO
			let message = this.parseMessage(event.data);
			console.log("message", message);
			if (message.type == 2) {
				this.sourceBuffer.appendBuffer(message.payload);
				parser.appendBuf(message.payload);
				parser.tryParse();
				console.log(parser.length - parser.position);
			}
			if (message.type == 3) {
				let data = new ArrayBuffer(message.payload.length + 28);
				let v = new DataView(data);
				v.setUint32(0, 0x1f43b675); // cluster
				v.setUint32(4, 0x01ffffff); // unknown size
				v.setUint32(8, 0xffffffff); // unknown size
				v.setUint8(12, 0xe7); // timecode
				v.setUint8(13, 0x85); // timecode size
				v.setUint8(14, 0x00); // 32 + 8 bit TODO
				v.setUint32(15, message.timestamp); // timecode
				// 
				tt++;

				v.setUint8(19, 0xa3); // simpleblock
				v.setUint32(20, 0x10000000 | (message.payload.length + 4)); // 32bit size

				v.setUint8(24, 0x81); // track
				v.setUint16(25, 0); // block timecode. always 0.
				v.setUint8(27, message.flags); // track
				let buffer = new Uint8Array(data);
				buffer.set(message.payload, 28);

				parser.appendBuf(buffer);
				parser.tryParse();

				if (f) {
					f = false;
					this.sourceBuffer.appendBuffer(data);
				}
			}
		});

	}
	stop() {
        if (this.ws != null) {
            this.ws.close();
            this.ws = null;
        }
	}

	parseMessage(ab) {
		let v = new DataView(ab);
		let offset = v.getUint16(2);
		let t = v.getUint32(4) * 4294967296 + v.getUint32(8);
		let timescale = v.getUint32(12);
		let b = new Uint8Array(ab, offset + 4, v.byteLength - offset - 4);
		return {type: v.getUint8(0), flags: v.getUint8(1), timestamp: t, timescale: timescale, payload: b};
	}
}

let canvasId = 'screen';
let player = new Player();

window.addEventListener('DOMContentLoaded',(function(e){
	let canvas = document.getElementById(canvasId);
	let ctx =canvas.getContext('2d');
	ctx.fillStyle = "rgb(255, 0, 0)";
	ctx.strokeStyle = "rgb(0, 0, 255)";

	document.getElementById('start').addEventListener('click', function() {
		player.start(document.getElementById('wsurl').value, "", document.getElementById('video'));
		document.getElementById('status').innerText = "Started.";
	}, true);

	document.getElementById('stop').addEventListener('click', function() {
		player.stop();
		document.getElementById('status').innerText = "Ready.";
	}, true);


}),false);
