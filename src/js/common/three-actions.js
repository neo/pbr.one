import * as THREE from "three";
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import * as MISC from "./misc.js";
import * as LOADING from "./loading.js";

/**
 * Updates the environment of a given ThreeJS-scene.
 * This happens in multiple places and is therefore defined as its own dedicated function.
 *
 * @param {function} [onTextureLoaded] Optional callback that receives the raw equirectangular
 *        texture right before it is disposed. Useful for analysing the HDRI (e.g. to derive a
 *        dominant light direction for image-based shadows). When provided, the texture is loaded
 *        as full 32-bit float data so the pixel values can be read back on the CPU.
 */
export function updateSceneEnvironment(url,scene,renderer,onTextureLoaded){
	console.debug("Updating scene environment (url): ",url);

	var envFileUrl = url;
	var envFileName = MISC.filenameFromUrl(url);
	
	var loadingNote = new LOADING.LoadingNote(envFileName,envFileUrl);
	loadingNote.start();
	
	try{
		var envFileExtension = MISC.fileExtensionFromUrl(url);
		var envLoader = pickEnvLoader(envFileExtension);

		// When the caller wants to inspect the pixel data we need readable float values.
		if(onTextureLoaded){
			envLoader.setDataType(THREE.FloatType);
		}

		envLoader.load(envFileUrl, texture => {
			const gen = new THREE.PMREMGenerator(renderer);
			const envMap = gen.fromEquirectangular(texture).texture;
			scene.environment = envMap;
			scene.background = envMap;

			if(onTextureLoaded){
				try{
					onTextureLoaded(texture);
				}catch(error){
					console.error("onTextureLoaded callback failed: ",error);
				}
			}

			texture.dispose()
			gen.dispose()
			
			loadingNote.finish();
		},null,(error) =>{
			loadingNote.fail(error);
		});
	}catch(error){
		loadingNote.fail(error);
	}

	
}

/**
 * Decodes a single IEEE 754 half-precision (16-bit) float stored in a Uint16.
 */
function decodeHalfFloat(half){
	const sign = (half & 0x8000) >> 15;
	const exponent = (half & 0x7C00) >> 10;
	const fraction = half & 0x03FF;

	if(exponent === 0){
		return (sign ? -1 : 1) * Math.pow(2,-14) * (fraction / 1024);
	}
	if(exponent === 0x1F){
		return fraction ? NaN : (sign ? -1 : 1) * Infinity;
	}
	return (sign ? -1 : 1) * Math.pow(2,exponent - 15) * (1 + fraction / 1024);
}

/**
 * Analyses an equirectangular HDRI texture and returns the normalized direction (pointing from the
 * scene origin towards the light) of its brightest region. This is a cheap approximation of
 * image-based lighting that can be used to drive a regular shadow-casting DirectionalLight.
 *
 * @param {THREE.Texture} texture An equirectangular texture whose `image.data` is readable
 *        (Float32Array or a half-float Uint16Array).
 * @returns {THREE.Vector3|null} The dominant light direction, or null if the data is not readable.
 */
export function extractDominantLightDirection(texture){
	const image = texture && texture.image;
	if(!image || !image.data){
		return null;
	}

	const { width, height, data } = image;
	const channels = data.length / (width * height);
	const isFloat = data instanceof Float32Array;

	// Sample at most ~512 columns to keep the one-time CPU cost low for large HDRIs.
	const stride = Math.max(1, Math.floor(width / 512));

	let bestLuminance = -Infinity;
	let bestI = 0;
	let bestJ = 0;

	for(let j = 0; j < height; j += stride){
		// Texels near the poles cover a smaller solid angle, so weight them down to avoid
		// the zenith/nadir dominating the result.
		const v = (j + 0.5) / height;
		const elevation = (0.5 - v) * Math.PI;
		const solidAngleWeight = Math.cos(elevation);

		for(let i = 0; i < width; i += stride){
			const idx = (j * width + i) * channels;
			const r = isFloat ? data[idx]     : decodeHalfFloat(data[idx]);
			const g = isFloat ? data[idx + 1] : decodeHalfFloat(data[idx + 1]);
			const b = isFloat ? data[idx + 2] : decodeHalfFloat(data[idx + 2]);

			const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) * solidAngleWeight;
			if(luminance > bestLuminance){
				bestLuminance = luminance;
				bestI = i;
				bestJ = j;
			}
		}
	}

	// Convert the brightest texel back into a world-space direction. The azimuth matches ThreeJS's
	// equirectUv() convention so the light lines up horizontally with the visible background.
	const u = (bestI + 0.5) / width;
	const v = (bestJ + 0.5) / height;
	const azimuth = (u - 0.5) * Math.PI * 2;
	const elevation = (0.5 - v) * Math.PI;
	const cosElevation = Math.cos(elevation);

	return new THREE.Vector3(
		cosElevation * Math.cos(azimuth),
		Math.sin(elevation),
		cosElevation * Math.sin(azimuth)
	).normalize();
}

/**
 * 
 * @param {*} extension 
 * @returns 
 */
export function pickEnvLoader(extension){
	switch (extension) {
		case "hdr":
			var envLoader = new RGBELoader();
			console.debug("Using RGBELoader (.hdr)");
			break;
		case "exr":
			var envLoader = new EXRLoader();
			console.debug("Using EXRLoader (.exr)");
			break;
		default:
			throw new Error(`Could not determine a fitting resource loader (exr/hdr) for URL extension '${extension}'`);
			break;
	}
	return envLoader;
}

/**
 * Resizes the rendering area for ThreeJS based on the current window size (window.innerWidth/-Height).
 */
export function resizeRenderingArea(camera,renderer) {
	if(camera && renderer){
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	}
}