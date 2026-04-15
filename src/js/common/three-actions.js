import * as THREE from "three";
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import * as MISC from "./misc.js";
import * as LOADING from "./loading.js";
import * as MESSAGE from "./message.js";

/**
 * Updates the environment of a given ThreeJS-scene.
 * This happens in multiple places and is therefore defined as its own dedicated function.
 */
export function updateSceneEnvironment(url,scene,renderer){
	console.debug("Updating scene environment (url): ",url);

	var envFileUrl = url;
	var envFileName = MISC.filenameFromUrl(url);
	
	var loadingNote = new LOADING.LoadingNote(envFileName,envFileUrl);
	loadingNote.start();
	
	try{
		var envFileExtension = MISC.fileExtensionFromUrl(url);
		var envLoader = pickEnvLoader(envFileExtension);

		envLoader.load(envFileUrl, texture => {
			const gen = new THREE.PMREMGenerator(renderer);
			const envMap = gen.fromEquirectangular(texture).texture;
			scene.environment = envMap;
			scene.background = envMap;
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

/**
 * Loads an environment texture from a local File object (e.g. from drag-and-drop).
 * Creates a temporary blob URL, loads with the appropriate loader, then revokes the URL.
 * @param {File} file - The local .exr or .hdr file
 * @param {Function} onTextureLoaded - Callback receiving the loaded texture
 */
export function loadEnvironmentFromFile(file, onTextureLoaded){
	var fileName = file.name;
	var extension = fileName.split('.').pop().toLowerCase();
	var blobUrl = URL.createObjectURL(file);

	var loadingNote = new LOADING.LoadingNote(fileName, fileName, false);
	loadingNote.start();

	try{
		var envLoader = pickEnvLoader(extension);
		envLoader.load(blobUrl, (texture) => {
			URL.revokeObjectURL(blobUrl);
			loadingNote.finish();
			onTextureLoaded(texture);
		}, null, (error) => {
			URL.revokeObjectURL(blobUrl);
			loadingNote.fail(error);
		});
	}catch(error){
		URL.revokeObjectURL(blobUrl);
		loadingNote.fail(error);
	}
}

/**
 * Sets up drag-and-drop on the window for loading local .exr/.hdr environment files.
 * Shows a visual overlay during drag and invokes the callback with the loaded texture on drop.
 * @param {Function} onTextureLoaded - Callback receiving the loaded THREE.Texture
 */
export function setupEnvironmentFileDrop(onTextureLoaded){
	var overlay = document.createElement('div');
	overlay.id = 'drag-drop-overlay';
	overlay.innerHTML = '<p>Drop .exr or .hdr file here</p>';
	document.body.appendChild(overlay);

	var dragCounter = 0;

	window.addEventListener('dragenter', (e) => {
		e.preventDefault();
		dragCounter++;
		overlay.classList.add('active');
	});

	window.addEventListener('dragleave', (e) => {
		e.preventDefault();
		dragCounter--;
		if(dragCounter === 0){
			overlay.classList.remove('active');
		}
	});

	window.addEventListener('dragover', (e) => {
		e.preventDefault();
	});

	window.addEventListener('drop', (e) => {
		e.preventDefault();
		dragCounter = 0;
		overlay.classList.remove('active');

		var file = e.dataTransfer.files[0];
		if(!file) return;

		var extension = file.name.split('.').pop().toLowerCase();
		if(extension !== 'exr' && extension !== 'hdr'){
			MESSAGE.newWarning(`Unsupported file type: .${extension}. Please drop an .exr or .hdr file.`);
			return;
		}

		console.debug("Loading local environment file (name): ", file.name);
		loadEnvironmentFromFile(file, onTextureLoaded);
	});
}