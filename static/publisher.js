"use strict";

class Publisher {
    constructor(segmentLength) {
        this.bytes = 0;
        this.frames = 0;
        this.parser = null;
        this.ws = null;
        this.recorder = null;
        this.segmentLength = segmentLength || 40;
    }

    start(stream, mimeType, wsURL, streamName) {
        this.statusElement = document.getElementById('status');
        if (this.ws != null) {
            return false;
        }
        console.log("isTypeSupported:" + MediaRecorder.isTypeSupported(mimeType));
        this.recorder = new MediaRecorder(stream, {mimeType: mimeType});
        this.parser = new WebmParser();
        let parser = this.parser;

        this.recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                console.log("data size: " + event.data.size);
                let reader = new FileReader();
                reader.onload = () => {
                    parser.appendBuf(new Uint8Array(reader.result));
                    parser.tryParse();
                };
                reader.readAsArrayBuffer(event.data);
            }
        };
        this.recorder.onerror = (event) => {
            this.updateStatus("Recorder error.");
            console.log("recorder error", event);
        };

        if (wsURL == "") {
            // for debugging
            this.startRecoder(mimeType);
            return;
        }

        this.updateStatus("Connecting.");
        this.ws = new WebSocket(wsURL);
		this.ws.addEventListener('open', (event) => {
            this.ws.send(JSON.stringify({"type":"connect", "stream":streamName, "debugMessage": "Hello!"}));
			this.startRecoder(mimeType);
			this.updateStatus("Started.");
		});
		this.ws.addEventListener('close', (event) => {
            this.updateStatus("WebSocket Error.");
            this.ws = null;
		});
    }

    stop() {
		if (this.recorder != null) {
			this.recorder.stop();
			this.recorder = null;
        }
        if (this.ws != null) {
            this.ws.close();
            this.ws = null;
        }
        this.updateStatus("Ready");
    }

    updateStatus(message) {
        if (this.statusElement) {
            this.statusElement.innerText = message;
        }
        console.log(message);
    }

    startRecoder(mimeType) {
        let avc = mimeType.includes('h264') | mimeType.includes('avc1');
        let configRecord = null;
        this.parser.setListenser('track_entry', (e) => {
            console.log(e.value);
        });
        let blockListener = (e) => {
            if (configRecord == null) {
                if (avc) {
                    configRecord = this.searchConfigRecord(e.value.payload);
                } else {
                    // TODO
                    configRecord = "";
                }
                if (configRecord != null) {
                    console.log("ok. configurations.");
                    if (this.ws != null) {
                        this.ws.send(this.createStreamMessage(2, e, configRecord));
                    }
                }
            }
            console.log("frame time:" + e.value.timecode + "+" + e.parent.value.timecode + " flags:" + e.value.flags);
            this.frames ++;
            this.bytes += e.value.payload.length;
            if (avc) this.setNalUnitSize(e.value.payload);
            if (this.ws) {
                this.ws.send(this.createStreamMessage(3, e, e.value.payload));
            }
            e.value = null; // avoid append to parent.
        };
        this.parser.setListenser('simple_block', blockListener);
        this.parser.setListenser('block', blockListener); // TODO
        this.recorder.start(this.segmentLength);
    }

    searchConfigRecord(b) {
        // parse NAL.
        // TODO: multiple pps?
        let sps = [], pps = [];
        let type = 0;
        for (let i = 0; i < b.length-4; i++) {
            if (b[i] == 0 && b[i+1] == 0 && b[i+2] == 0 && b[i+3] == 1) {
                console.log("NAL unit type" + (b[i+4]&0x1f));
                type = (b[i+4]&0x1f);
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
        return r;
    }

    setNalUnitSize(b) {
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

    createStreamMessage(type, e, payload) {
        let header = new ArrayBuffer(20);
        let hv = new DataView(header);
        let t = e.value.timecode + e.parent.value.timecode;
        hv.setUint8(0, type); // type: stream data.
        hv.setUint8(1, e.value.flags);
        hv.setUint16(2, header.byteLength-4); // header size.
        hv.setUint32(4, t/4294967296); // Timestamp
        hv.setUint32(8, t); // Timestamp
        hv.setUint32(12, 1000); // Timescale.
        hv.setUint32(16, 0x61766300); // 'avc'
        return new Blob([header, payload]);
    }
}
