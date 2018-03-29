"use strict";

class WebmParser {
    constructor() {
        this.buffer = [];
        this.buffers = [];
        this.position = 0;
        this.offset = 0;
        this.length = 0;
        this.currentElement = null;
        this.listener = {};

        let ebmlSpec = {
            0x4286: ['version', 'int'],
            0x42f7: ['read_version', 'int'],
            0x42f2: ['max_id_length', 'int'],
            0x4282: ['doctype', 'string'],
            0x42f3: ['max_size_length', 'int'],
            0x4287: ['doctype_version', 'int'],
            0x4285: ['doctype_read_version', 'int'],
            0xec: ['void', 'raw']
        };

        // webm
        let clusterSpec = {
            0xe7: ['timecode', 'int'],
            0xa3: ['simple_block', 'simple_block'],
            0xa0: ['block_group', 'object'],
            0xa1: ['block', 'block'],
            0xfb: ['reference_block', 'int'],
            0x1f43b675: ['cluster', '_sibling_'] // ignore cluster in cluster.
        };

        let infoSpec = {
            0x2ad7b1: ['timecode_scale', 'int'],
            0x4d80: ['mixing_app', 'string'],
            0x5741: ['writing_app', 'string'],
        };

        let tracksSpec = {
            0xae: ['track_entry', 'object'],
            0xe0: ['video', 'object'],
            0xe1: ['audio', 'object'],
            0xb0: ['width', 'int'],
            0xba: ['height', 'int'],
            0xb5: ['sampling_frequency', 'int'],
            0x86: ['codec', 'string'],
            0x63a2: ['codec_private', 'raw']
        };

        let segmentSpec = {
            0x114d9b74: ['seek_head'],
            0x4dbb: ['seek'],
            0x1549a966: ['info', 'object', infoSpec],
            0x1654ae6b: ['tracks', 'object', tracksSpec],
            0x1c53bb6b: ['cues'],
            0xbb: ['cue_point'],
            0xb7: ['cue_track_points'],
            0x1f43b675: ['cluster', 'object', clusterSpec]
        };
        let spec = {
            0x1a45dfa3: ["ebml", 'object', ebmlSpec],
            0x18538067: ["webm_segment", 'object', segmentSpec]
        };
        this.currentElement = { name: "_root", type: 'object', value: {}, spec: spec, size: -1, parent: null };
    }

    setListenser(name, cb) {
        this.listener[name] = cb;
    }

    appendBuf(b) {
        this.buffers.push(b);
        this.length += b.length;
    }

    checkBuf() {
        if (this.position < this.buffer.length) {
            return true;
        }
        if (this.buffers.length > 0) {
            this.length -= this.buffer.length;
            this.position -= this.buffer.length;
            this.offset += this.buffer.length;
            this.buffer = this.buffers.shift();
            return true;
        }
        return false;
    }

    // return value or null.
    readVN(clearmsb) {
        if (!this.checkBuf()) return null;
        let v = this.buffer[this.position], mask = 0x80;
        for (let i = 0; i < 8; i++ , mask >>= 1) {
            if (v & mask) {
                if (i + 1 > this.length - this.position) {
                    return null;
                }
                if (clearmsb) v ^= mask;
                this.position++;
                for (; i > 0; i--) {
                    this.checkBuf();
                    v = v * 256 + this.buffer[this.position++];
                }
                return v;
            }
        }
        return null;
    }

    readBytes(l) {
        this.checkBuf();
        let p = this.position;
        this.position += l;
        if (this.position > this.buffer.length) {
            console.log("ERROR: out of range [" + p + "," + l + "]:" + this.buffer.length);
            l = this.buffer.length - p; // TODO concat next buffer.
        }
        return new Uint8Array(this.buffer.buffer, this.buffer.byteOffset + p, l);
    }

    readN(l) {
        let v = 0;
        for (let i = 0; i < l; i++) {
            this.checkBuf();
            v = v * 256 + this.buffer[this.position++];
        }
        return v;
    }

    readByte() {
        this.checkBuf();
        return this.buffer[this.position++];
    }

    readStr(l) {
        return String.fromCharCode.apply(null, this.readBytes(l));
    }

    completeElement(e) {
        if (this.listener[e.name]) {
            this.listener[e.name](e);
        }
        e.parent.value[e.name] = e.value;
        // console.log("ok" , e);
        return e.parent;
    }

    tryParse() {
        let objectCountLimit = 1000;
        for (let t = 0; t < objectCountLimit; t++) {
            let e = this.currentElement;
            while (e.size >= 0 && (e.start - this.offset + e.size == this.position)) {
                e = this.completeElement(e);
                this.currentElement = e;
            }

            if (this.currentElement.type == 'object') {
                let childId = this.readVN(false);
                if (childId === null) return;
                this.currentElement = { id: childId, spec: {}, value: null, size: null, parent: this.currentElement };
            }
            if (this.currentElement.size === null) {
                let size = this.readVN(true);
                if (size === null) return;
                this.currentElement.size = size;
                this.currentElement.start = this.position + this.offset;

                let parent = this.currentElement.parent;
                let type = parent.spec[this.currentElement.id] || ['unknown' + this.currentElement.id, 'raw', null];
                if (type[1] == '_sibling_') {
                    this.currentElement.parent = this.completeElement(parent);
                    parent = this.currentElement.parent;
                    type = parent.spec[this.currentElement.id] || ['unknown' + this.currentElement.id, 'raw', null];
                }
                this.currentElement.name = type[0];
                this.currentElement.type = type[1];
                if (type[1] == 'object') {
                    this.currentElement.value = {};
                    this.currentElement.spec = type[2] || parent.spec;
                    continue;
                }
            }
            if (this.currentElement.size < 0 || this.length - this.position < this.currentElement.size) {
                return;
            }

            if (this.currentElement.type == 'simple_block' || this.currentElement.type == 'block') {
                let tr = this.readVN(true), t = this.readN(2), f = this.readByte();
                let sz = this.currentElement.start + this.currentElement.size - this.position - this.offset;
                this.currentElement.value = { track: tr, timecode: t, flags: f, payload: this.readBytes(sz) };
            } else if (this.currentElement.type == 'int') {
                this.currentElement.value = this.readN(this.currentElement.size);
            } else if (this.currentElement.type == 'string') {
                this.currentElement.value = this.readStr(this.currentElement.size);
            }
            this.position = this.currentElement.start + this.currentElement.size - this.offset;
        }
    }
}
