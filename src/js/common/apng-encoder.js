// Minimal APNG encoder
// Takes an array of PNG ArrayBuffers and assembles them into an Animated PNG

function crc32(buf) {
	var table = new Uint32Array(256);
	for (var i = 0; i < 256; i++) {
		var c = i;
		for (var j = 0; j < 8; j++) {
			c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
		}
		table[i] = c;
	}
	var crc = 0xFFFFFFFF;
	for (var i = 0; i < buf.length; i++) {
		crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
	}
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

function readUint32(data, offset) {
	return (data[offset] << 24 | data[offset + 1] << 16 | data[offset + 2] << 8 | data[offset + 3]) >>> 0;
}

function writeUint32(arr, offset, value) {
	arr[offset]     = (value >>> 24) & 0xFF;
	arr[offset + 1] = (value >>> 16) & 0xFF;
	arr[offset + 2] = (value >>> 8) & 0xFF;
	arr[offset + 3] = value & 0xFF;
}

function writeUint16(arr, offset, value) {
	arr[offset]     = (value >>> 8) & 0xFF;
	arr[offset + 1] = value & 0xFF;
}

function makeChunk(type, data) {
	var chunk = new Uint8Array(12 + data.length);
	writeUint32(chunk, 0, data.length);
	chunk[4] = type.charCodeAt(0);
	chunk[5] = type.charCodeAt(1);
	chunk[6] = type.charCodeAt(2);
	chunk[7] = type.charCodeAt(3);
	chunk.set(data, 8);
	var crcBuf = new Uint8Array(4 + data.length);
	crcBuf[0] = type.charCodeAt(0);
	crcBuf[1] = type.charCodeAt(1);
	crcBuf[2] = type.charCodeAt(2);
	crcBuf[3] = type.charCodeAt(3);
	crcBuf.set(data, 4);
	writeUint32(chunk, 8 + data.length, crc32(crcBuf));
	return chunk;
}

function parsePNGChunks(pngData) {
	var data = new Uint8Array(pngData);
	var offset = 8; // skip PNG signature
	var chunks = [];
	while (offset < data.length) {
		var length = readUint32(data, offset);
		var type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
		var chunkData = data.slice(offset + 8, offset + 8 + length);
		chunks.push({ type: type, data: chunkData });
		offset += 12 + length;
	}
	return chunks;
}

/**
 * Encodes an array of PNG ArrayBuffers into an APNG ArrayBuffer.
 * @param {ArrayBuffer[]} pngBuffers - Array of PNG file data
 * @param {number} fps - Frames per second for the animation
 * @returns {ArrayBuffer} The assembled APNG file data
 */
export function encodeAPNG(pngBuffers, fps) {
	var numFrames = pngBuffers.length;
	if (numFrames === 0) return null;

	var delayNum = 1;
	var delayDen = fps || 60;

	// Parse first frame to get IHDR
	var firstChunks = parsePNGChunks(pngBuffers[0]);
	var ihdrChunk = firstChunks.find(function(c) { return c.type === 'IHDR'; });
	var width = readUint32(ihdrChunk.data, 0);
	var height = readUint32(ihdrChunk.data, 4);

	var parts = [];

	// PNG signature
	parts.push(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

	// IHDR
	parts.push(makeChunk('IHDR', ihdrChunk.data));

	// acTL (animation control)
	var actlData = new Uint8Array(8);
	writeUint32(actlData, 0, numFrames);
	writeUint32(actlData, 4, 0); // 0 = infinite loop
	parts.push(makeChunk('acTL', actlData));

	var seq = 0;

	for (var i = 0; i < numFrames; i++) {
		var chunks = (i === 0) ? firstChunks : parsePNGChunks(pngBuffers[i]);

		// fcTL (frame control)
		var fctlData = new Uint8Array(26);
		writeUint32(fctlData, 0, seq++);
		writeUint32(fctlData, 4, width);
		writeUint32(fctlData, 8, height);
		writeUint32(fctlData, 12, 0); // x_offset
		writeUint32(fctlData, 16, 0); // y_offset
		writeUint16(fctlData, 20, delayNum);
		writeUint16(fctlData, 22, delayDen);
		fctlData[24] = 0; // dispose_op: NONE
		fctlData[25] = 0; // blend_op: SOURCE
		parts.push(makeChunk('fcTL', fctlData));

		// IDAT / fdAT
		var idatChunks = chunks.filter(function(c) { return c.type === 'IDAT'; });
		if (i === 0) {
			for (var j = 0; j < idatChunks.length; j++) {
				parts.push(makeChunk('IDAT', idatChunks[j].data));
			}
		} else {
			for (var j = 0; j < idatChunks.length; j++) {
				var fdatData = new Uint8Array(4 + idatChunks[j].data.length);
				writeUint32(fdatData, 0, seq++);
				fdatData.set(idatChunks[j].data, 4);
				parts.push(makeChunk('fdAT', fdatData));
			}
		}
	}

	// IEND
	parts.push(makeChunk('IEND', new Uint8Array(0)));

	// Concatenate
	var totalLength = 0;
	for (var i = 0; i < parts.length; i++) totalLength += parts[i].length;
	var result = new Uint8Array(totalLength);
	var offset = 0;
	for (var i = 0; i < parts.length; i++) {
		result.set(parts[i], offset);
		offset += parts[i].length;
	}

	return result.buffer;
}
