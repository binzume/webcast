"use strict";


class WebmPerser {
    constructor() {
        this.buffer = [];
        this.buffers = [];
        this.stack = [];
        this.position = 0;
        this.length = 0;
        this.offset = 0;
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
            0xa3: ['simple_block', 'simple_block']
        };
        clusterSpec[0x1f43b675] = ['cluster', 'object', clusterSpec] // TODO: handle unknown size elem.

        let infoSpec = {
            0x2ad7b1: ['timecode_scale', 'int'],
            0x4d80: ['mixing_app', 'string'],
            0x5741: ['writing_app', 'string'],
        };

        let trackEntSpec = {
            0x63a2: ['codec_private', 'raw'],
            0xe0: ['video', 'object'],
            0xe1: ['audio', 'object'],
            0xb0: ['width', 'int'],
            0xba: ['height', 'int'],
            0xb5: ['sampling_frequency', 'int'],
            0x86: ['codec', 'string']
        };

        let tracksSpec = {
            0xae: ['track_entry', 'object', trackEntSpec]
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
        this.handlers = {
            0x1a45dfa3: ["ebml", 'object', ebmlSpec],
            0x18538067: ["webm_segment", 'object', segmentSpec]
        };
        this.stack.push({name:"_root", handlers: this.handlers, childlen: []});
    }

    setListenser(name, cb) {
        this.listener[name] = cb;
    }

    append(b) {
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
            this.buffer = this.buffers.shift();
            return true;
        }
        return false;
    }
    
    // return value or null
    readId() {
        if(!this.checkBuf()) return null;
        let b = this.buffer[this.position];
        for (let i = 0; i < 8; i++) {
            if ((b << i) & 0x80) {
                return this.readNSafe(i + 1);
            }
        }
        return null;
    }

    // return value or null
    readInt() {
        if(!this.checkBuf()) return null;
        let b = this.buffer[this.position];
        let m = 0x80;
        for (let i = 0; i < 8; i++) {
            if ((b << i) & 0x80) {
                let v = this.readNSafe(i + 1);
                if (v !== null) v = v ^ m;
                return v;
            }
            m <<= 7;
        }
        return null;
    }

    readNSafe(l) {
        if (l > this.length - this.position) {
            return null;
        }
        let v = 0;
        for (let i = 0; i < l; i++) {
            v = (v<<8) | this.buffer[this.position];
            this.position++;
            this.checkBuf();
        }
        return v;
    }

    readBytes(l) {
        // TODO
        let p = this.position;
        this.position+=l;
        return new Uint8Array(this.buffer.buffer, p, l);
    }

    read8() {
        let v = this.buffer[this.position];
        this.position ++;
        return v;
    }
    read16() {
        return this.readN(2);
    }
    readN(l) {
        let v = 0;
        for (let i = 0; i < l; i++) {
            v = (v<<8) | this.buffer[this.position];
            this.position ++;
        }
        return v;
    }
    readStr(l) {
        return String.fromCharCode.apply(null, this.buffer.slice(this.position, this.position+l));
    }

    _concatBuffer(buffer1, buffer2) {
        var r = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
        r.set(new Uint8Array(buffer1), 0);
        r.set(new Uint8Array(buffer2), buffer1.byteLength);
        return r.buffer;
    }

    _parent() {
        return this.stack[this.stack.length - 1];
    }

    tryParse() {
        for (var t = 0 ;t < 200; t ++) {
            if (this.currentElement == null) {
                let id = this.readId();
                if (id === null) return;
                this.currentElement = {id: id, size: null, handlers:null, childlen: [], value: null};
            }
            if (this.currentElement.size === null) {
                let size = this.readInt();
                if (size === null) return;
                this.currentElement.size = size;
                this.currentElement.start = this.position;

                // console.log("block ", this.currentElement);
                if (this.handlers) {
                    let h = this.handlers[this.currentElement.id] || ['unknown','raw',null];
                    this.currentElement.name = h[0];
                    this.currentElement.type = h[1];
                    if (h[1] == 'object') {
                        this.handlers = h[2] || this.handlers;
                        this.currentElement.handlers = this.handlers;
                        this.stack.push(this.currentElement);
                        this.currentElement = null;
                        continue;
                    } else {
                        this.handlers = null;
                    }
                }
            }

            if (this.currentElement.size < 0 || this.length < this.currentElement.start + this.currentElement.size) {
                console.log("wait");
                return;
            }

            if (this.currentElement.type =='simple_block') {
                let tr = this.readInt(), t = this.read16(), f = this.read8();
                let sz =  this.currentElement.start + this.currentElement.size - this.position;
                if (sz < 0) sz = 0;
                this.currentElement.value = {track: tr, timecode: t, flags: f, payload: this.readBytes(sz)};
                this.currentElement.parent = this._parent();
            } else if (this.currentElement.type =='int') {
                this.currentElement.value = this.readN(this.currentElement.size);
            } else if (this.currentElement.type =='vint') {
                this.currentElement.value = this.readInt(this.currentElement.size);
            } else if (this.currentElement.type =='string') {
                this.currentElement.value = this.readStr(this.currentElement.size);
            }
            if (this.listener[this.currentElement.name]) {
                this.listener[this.currentElement.name](this.currentElement);
            }
            console.log("ok", this.currentElement);
            this.position = this.currentElement.start + this.currentElement.size;


            for (;;) {
                if (this.stack.length > 0) {
                    let p = this._parent();
                    if (this.currentElement.value !== null) {
                        p.childlen.push(this.currentElement);
                        p[this.currentElement.name] = this.currentElement.value;
                    }
                    if (p.start + p.size == this.position) {
                        this.currentElement = this.stack.pop();
                        if (this.listener[this.currentElement.name]) {
                            this.listener[this.currentElement.name](this.currentElement);
                        }
                        console.log("ok object", this.currentElement);
                        continue;
                    }
                }
                break;
            }

            if (this.stack.length == 0) {
                console.log("end");
                return;
            }

            this.handlers = this._parent().handlers;
            this.currentElement = null;
        }
    }
}
