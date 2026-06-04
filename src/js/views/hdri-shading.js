// IMPORTS
import * as THREE from "three";
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import * as MESSAGE from '../common/message.js';
import * as BASE from "../common/base.js";
import * as SCENE_CONFIGURATION from "../common/scene-configuration.js";
import * as CONSTANTS from "../common/constants.js";
import * as THREE_ACTIONS from "../common/three-actions.js";
import * as MISC from "../common/misc.js";

// VARIABLES AND CONSTANTS

var scene, renderer, camera, diffuseSphere, glossySphere, metallicSphere, controls;

var shadowLight, shadowGround;
var shadowLightHelper, shadowCameraHelper;

var currentModel = null;
var transformControls = null;
var lastUniformScale = 1;
const DEFAULT_MODEL_URL = "media/BoomBox.glb";

/**
 * Approximates image-based-lighting shadows by pointing a shadow-casting DirectionalLight towards
 * the brightest region of the HDRI. The light itself contributes no illumination (intensity 0) so
 * the IBL look is preserved; only the shadow it projects onto the catcher ground is visible.
 */
function updateShadowLightFromEnvironment(texture){
	var direction = THREE_ACTIONS.extractDominantLightDirection(texture);
	if(!direction){
		console.warn("IBL shadows: could not read HDRI pixel data, keeping previous light direction.");
		return;
	}

	// Make sure the light always comes from above the horizon. If the brightest spot is low (or
	// below) the horizon, the light would sit at/under the ground and cast no visible shadow.
	if(direction.y < 0.25){
		direction.y = 0.25;
		direction.normalize();
	}

	console.debug("IBL shadows: dominant light direction",direction);

	shadowLight.position.copy(direction.multiplyScalar(8));
	shadowLight.target.position.set(0,0,0);
	shadowLight.target.updateMatrixWorld();

	// Keep debug helpers in sync with the new light position/orientation.
	shadowLight.shadow.camera.updateProjectionMatrix();
	if(shadowLightHelper){ shadowLightHelper.update(); }
	if(shadowCameraHelper){ shadowCameraHelper.update(); }
}

var isRecording = false;
var mediaRecorder = null;
var recordedChunks = [];
var recordingFrameCount = 0;
var recordingTotalFrames = 0;
var autoPanWasOff = false;
var recordingStartExposure = 0;
var recordedVideoBlob = null;
var currentEnvBasename = 'recording';

function reset() {
	controls.reset();
	window.PBR1_CHANGE({'environment_exposure': 0});
}

/**
 * Places a loaded glTF model in the scene, replacing any previous one. The model is added at its
 * native position and scale; the shadow-catcher ground is dropped to the model's lowest point so
 * its shadow lines up. All meshes are configured to cast and receive shadows.
 */
function placeModel(gltf){
	if(currentModel){
		if(transformControls){ transformControls.detach(); }
		scene.remove(currentModel);
	}

	var model = gltf.scene || gltf.scenes[0];

	model.traverse((child) => {
		if(child.isMesh){
			child.castShadow = true;
			child.receiveShadow = true;
		}
	});

	currentModel = model;
	scene.add(model);

	lastUniformScale = model.scale.x;

	// Move the shadow-catcher ground to the bottom of the model.
	updateShadowGroundToModel();

	if(transformControls){ transformControls.attach(model); }
}

/**
 * Keeps the model's scale uniform (proportional) when the user drags the transform scale handle,
 * then realigns the shadow-catcher ground with the model.
 */
function onModelTransformChange(){
	if(currentModel){
		// TransformControls scales each axis independently; pick the axis that changed the most
		// from the last uniform value and apply it to all three so proportions are preserved.
		var s = currentModel.scale;
		var dx = Math.abs(s.x - lastUniformScale);
		var dy = Math.abs(s.y - lastUniformScale);
		var dz = Math.abs(s.z - lastUniformScale);
		var uniform = dx >= dy && dx >= dz ? s.x : (dy >= dz ? s.y : s.z);
		s.setScalar(uniform);
		lastUniformScale = uniform;
	}
	updateShadowGroundToModel();
}

/**
 * Aligns the shadow-catcher ground with the current model: it sits under the model's lowest point
 * and follows the model horizontally, so the projected shadow stays anchored to the model's base.
 */
function updateShadowGroundToModel(){
	if(!currentModel || !shadowGround){ return; }
	var box = new THREE.Box3().setFromObject(currentModel);
	shadowGround.position.x = currentModel.position.x;
	shadowGround.position.z = currentModel.position.z;
	shadowGround.position.y = box.min.y;
}

function preprocessSceneConfiguration(sceneConfiguration){

	// More URLs than names
	if(sceneConfiguration.environment_url.length > sceneConfiguration.environment_name.length && sceneConfiguration.environment_url.length > 1){
		MESSAGE.newWarning("Not all environments have a name.");
		sceneConfiguration.environment_name = MISC.padArray(sceneConfiguration.environment_name,sceneConfiguration.environment_url.length,"Unnamed HDRI");
	}

	// More names than URLs
	else if(sceneConfiguration.environment_url.length < sceneConfiguration.environment_name.length){
		MESSAGE.newWarning("More env. names than URLs have been defined.")
		sceneConfiguration.environment_name = sceneConfiguration.environment_name.slice(0,sceneConfiguration.environment_url.length);
	}

	return sceneConfiguration;
}

function updateScene(oldSceneConfiguration,newSceneConfiguration){

	console.debug("Update scene (old,new): ",oldSceneConfiguration,newSceneConfiguration);

	// Exposure
	renderer.toneMappingExposure = Math.pow(2,newSceneConfiguration["environment_exposure"]);
	renderer.toneMapping = CONSTANTS.toneMapping[newSceneConfiguration["environment_tonemapping"]];

	// Show spheres
	scene.visible = Boolean(parseInt(newSceneConfiguration["spheres_enable"]));

	// Auto pan
	controls.autoRotate = Boolean(parseInt(newSceneConfiguration["auto_pan_enable"]));

	// Set Environment
	if(newSceneConfiguration.environment_url.length > 0){
		if( !SCENE_CONFIGURATION.equalAtKey(oldSceneConfiguration,newSceneConfiguration,"environment_index") || 
			!SCENE_CONFIGURATION.equalAtKey(oldSceneConfiguration,newSceneConfiguration,"environment_url")){
			var envFileUrl = newSceneConfiguration.environment_url[newSceneConfiguration.environment_index];
			currentEnvBasename = envFileUrl.split('/').pop().replace(/\.[^.]+$/, '');
			THREE_ACTIONS.updateSceneEnvironment(envFileUrl,scene,renderer,updateShadowLightFromEnvironment);
			reset();
		}
	}

	// Accent color
	glossySphere.material.color.set(parseInt(newSceneConfiguration['spheres_accent_color'],16));
	
}

function initializeScene(){

	SCENE_CONFIGURATION.initializeConfiguration({

		"spheres_enable" : 1,
	
		"environment_tonemapping" : "filmic",
		"environment_exposure" : 0.0,
	
		"environment_url" : [],
		"environment_name": [],
		"environment_index":0,

		"spheres_accent_color": "116DD5",

		"auto_pan_enable": 0
	
	});

	// scene
	scene = new THREE.Scene();

	// camera
	camera = new THREE.PerspectiveCamera( 80, window.innerWidth / window.innerHeight, 0.1, 1000 );
	camera.position.x = -2;
	camera.position.y = 1;

	// preview objects
	diffuseSphere = new THREE.Mesh( 
		new THREE.SphereGeometry(0.33,128,128), 
		new THREE.MeshPhysicalMaterial({"color":0xFFFFFF}) 
	);
	diffuseSphere.position.z = 1;

	glossySphere = new THREE.Mesh( 
		new THREE.SphereGeometry(0.33,128,128), 
		new THREE.MeshPhysicalMaterial({"color":parseInt("116DD5",16),"roughness":0}) 
	);
	glossySphere.position.z = -1;

	metallicSphere = new THREE.Mesh(
		new THREE.SphereGeometry(0.5,128,128), 
		new THREE.MeshPhysicalMaterial({"color":0xFFFFFF,"roughness":0,"metalness":1}) 
	);
	metallicSphere.position.z = 0;

	// scene.add(diffuseSphere);
	// scene.add(glossySphere);
	// scene.add(metallicSphere);

	// IBL shadows: a shadow-casting light aimed at the HDRI's brightest spot plus a transparent
	// catcher ground that only renders the shadow. The light contributes no illumination
	// (intensity 0) so the IBL look is preserved; ShadowMaterial draws the shadow mask directly.
	shadowLight = new THREE.DirectionalLight(0xffffff, 0);
	shadowLight.castShadow = true;
	shadowLight.shadow.mapSize.set(2048,2048);
	shadowLight.shadow.camera.near = 0.1;
	shadowLight.shadow.camera.far = 20;
	shadowLight.shadow.camera.left = -3;
	shadowLight.shadow.camera.right = 3;
	shadowLight.shadow.camera.top = 3;
	shadowLight.shadow.camera.bottom = -3;
	shadowLight.shadow.bias = -0.0005;
	shadowLight.shadow.normalBias = 0.02;
	scene.add(shadowLight);
	scene.add(shadowLight.target);

	// DEBUG: visualize the directional light and its shadow camera frustum.
	// The blue/yellow plane marks the light's position and direction; the line frustum shows the
	// volume the shadow map covers. Remove these once shadows are confirmed.
	// shadowLightHelper = new THREE.DirectionalLightHelper(shadowLight, 1, 0xffff00);
	// scene.add(shadowLightHelper);
	// shadowCameraHelper = new THREE.CameraHelper(shadowLight.shadow.camera);
	// scene.add(shadowCameraHelper);

	shadowGround = new THREE.Mesh(
		new THREE.PlaneGeometry(20,20),
		new THREE.ShadowMaterial({"opacity":0.4})
	);
	shadowGround.rotation.x = -Math.PI / 2;
	shadowGround.position.y = -0.55;
	shadowGround.receiveShadow = true;
	scene.add(shadowGround);

	// Default 3D model. Loaded from a hosted URL until the user drops in their own.
	THREE_ACTIONS.loadModelFromUrl(DEFAULT_MODEL_URL, placeModel);

	// renderer
	renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
	renderer.outputEncoding = CONSTANTS.encoding.sRGB;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	THREE_ACTIONS.updateSceneEnvironment("./media/env-placeholder.exr",scene,renderer,updateShadowLightFromEnvironment);

	// orbit controls
	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableZoom = true;
	controls.minDistance = controls.maxDistance = 2;
	controls.enablePan = false;
	controls.enableDamping = true;
	controls.autoRotateSpeed = 12.0;
	controls.listenToKeyEvents(window);

	// DEBUG: transform handles to move/rotate/scale the model.
	// Switch modes with the W (translate), E (rotate) and R (scale) keys.
	transformControls = new TransformControls(camera, renderer.domElement);
	transformControls.addEventListener('dragging-changed', (e) => {
		controls.enabled = !e.value;
	});
	transformControls.addEventListener('objectChange', onModelTransformChange);
	window.addEventListener('keydown', (e) => {
		switch(e.key.toLowerCase()){
			case 'w': transformControls.setMode('translate'); break;
			case 'e': transformControls.setMode('rotate'); break;
			case 'r': transformControls.setMode('scale'); break;
		}
	});
	scene.add(transformControls.getHelper());
	if(currentModel){ transformControls.attach(currentModel); }

	// Window resizing
	window.addEventListener('resize', (e) => { THREE_ACTIONS.resizeRenderingArea(camera,renderer)}, false);
	window.addEventListener('mousedown', (e) => { THREE_ACTIONS.resizeRenderingArea(camera,renderer)}, false);
	window.addEventListener('touchstart', (e) => { THREE_ACTIONS.resizeRenderingArea(camera,renderer)}, false);

	// Zoom
	var zoomHandler = function(event,camera) {
		camera.fov = Math.min(Math.max(camera.fov + event.deltaY/50, 1), 150);
		camera.updateProjectionMatrix();
	}

	// Exposure control via mouse wheel and zoom
	var exposureStep = 0.25;
	var exposureMin = -16;
	var exposureMax = 16;

	window.addEventListener('wheel', (e) => {
		var scrollExposure = document.getElementById('exposure_scroll_enable').checked;
		if(scrollExposure){
			e.preventDefault();
			var current = parseFloat(SCENE_CONFIGURATION.getConfiguration()["environment_exposure"]);
			var delta = e.deltaY > 0 ? -exposureStep : exposureStep;
			var newVal = Math.min(exposureMax, Math.max(exposureMin, current + delta));
			window.PBR1_CHANGE({'environment_exposure': newVal});
		}else{
			zoomHandler(e,camera);
		}
	}, {passive: false});

	// Exposure control via arrow keys
	window.addEventListener('keydown', (e) => {
		if(!document.getElementById('exposure_keys_enable').checked) return;
		if(e.key === 'ArrowUp' || e.key === 'ArrowRight'){
			e.preventDefault();
			var current = parseFloat(SCENE_CONFIGURATION.getConfiguration()["environment_exposure"]);
			var newVal = Math.min(exposureMax, current + exposureStep);
			window.PBR1_CHANGE({'environment_exposure': newVal});
		}else if(e.key === 'ArrowDown' || e.key === 'ArrowLeft'){
			e.preventDefault();
			var current = parseFloat(SCENE_CONFIGURATION.getConfiguration()["environment_exposure"]);
			var newVal = Math.max(exposureMin, current - exposureStep);
			window.PBR1_CHANGE({'environment_exposure': newVal});
		}
	});

	// Set up renderer
	document.querySelector('#renderer_target').appendChild( renderer.domElement );
	THREE_ACTIONS.resizeRenderingArea(camera,renderer);

	// Drag-and-drop local environment file
	var handleLocalEnvFile = function(texture) {
		var gen = new THREE.PMREMGenerator(renderer);
		var envMap = gen.fromEquirectangular(texture).texture;
		scene.environment = envMap;
		scene.background = envMap;
		texture.dispose();
		gen.dispose();
		reset();
	};

	THREE_ACTIONS.setupEnvironmentFileDrop(handleLocalEnvFile, placeModel);

	// Upload button file input
	document.getElementById('environment_file_input').addEventListener('change', (e) => {
		var file = e.target.files[0];
		if(file) {
			currentEnvBasename = file.name.replace(/\.[^.]+$/, '');
			THREE_ACTIONS.loadEnvironmentFromFile(file, handleLocalEnvFile);
		}
		e.target.value = '';
	});

	// Track env basename from drag-and-drop
	window.addEventListener('drop', (e) => {
		var file = e.dataTransfer && e.dataTransfer.files[0];
		if(file) {
			var ext = file.name.split('.').pop().toLowerCase();
			if(ext === 'exr' || ext === 'hdr') {
				currentEnvBasename = file.name.replace(/\.[^.]+$/, '');
			}
		}
	});

	// Record video
	document.getElementById('record_video_btn').addEventListener('click', toggleRecording);
	document.getElementById('video_preview_close').addEventListener('click', closeVideoPreview);
	document.getElementById('download_video_btn').addEventListener('click', downloadVideo);
// Take photo
	document.getElementById('take_photo_btn').addEventListener('click', takePhoto);
}

function takePhoto() {
	var formatter = new Intl.NumberFormat('en-US', { signDisplay: 'always', minimumFractionDigits: 1 });
	renderer.domElement.toBlob((blob) => {
		var a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		var ev = parseFloat(SCENE_CONFIGURATION.getConfiguration()["environment_exposure"])
		a.download = currentEnvBasename + '-ev' + formatter.format(ev) + '.png';
		a.click();
		URL.revokeObjectURL(a.href);
	})
}

function toggleRecording() {
	if (isRecording) {
		stopRecording();
		return;
	}


	// Enable auto pan if not already on
	autoPanWasOff = !controls.autoRotate;
	if (autoPanWasOff) {
		window.PBR1_CHANGE({'auto_pan_enable': 1});
		document.getElementById('auto_pan_enable').checked = true;
	}

	isRecording = true;
	recordedChunks = [];
	recordingFrameCount = 0;
	recordingTotalFrames = Math.round(3600 / controls.autoRotateSpeed) + 3;
	recordingStartExposure = parseFloat(SCENE_CONFIGURATION.getConfiguration()["environment_exposure"]);
	controls.enableDamping = false;

	// Show progress bar
	var progressBar = document.getElementById('record_progress_bar');
	progressBar.style.display = 'block';
	progressBar.style.setProperty('--record-progress', '0%');

	// Hide any existing preview
	document.getElementById('video_preview_container').style.display = 'none';

	// Start MediaRecorder
	var stream = renderer.domElement.captureStream();
	mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=av1' });

	mediaRecorder.ondataavailable = function(e) {
		if (e.data.size > 0) recordedChunks.push(e.data);
	};

	mediaRecorder.onstop = function() {
		recordedVideoBlob = new Blob(recordedChunks, { type: 'video/webm' });
		var url = URL.createObjectURL(recordedVideoBlob);
		var container = document.getElementById('video_preview_container');
		var video = document.getElementById('video_preview');
		video.src = url;
		container.style.display = 'block';
	};

	mediaRecorder.start();

	document.getElementById('record_video_btn').textContent = 'Stop Recording';
}

function stopRecording() {
	isRecording = false;
	controls.enableDamping = true;
	if (mediaRecorder && mediaRecorder.state !== 'inactive') {
		mediaRecorder.stop();
	}
	document.getElementById('record_progress_bar').style.display = 'none';
	document.getElementById('record_video_btn').textContent = 'Record Video';

	// Restore original exposure
	if (recordingStartExposure !== 0) {
		window.PBR1_CHANGE({'environment_exposure': recordingStartExposure});
	}

	// Restore auto pan state
	if (autoPanWasOff) {
		window.PBR1_CHANGE({'auto_pan_enable': 0});
		document.getElementById('auto_pan_enable').checked = false;
		autoPanWasOff = false;
	}
}

function downloadVideo() {
	if (!recordedVideoBlob) return;
	var a = document.createElement('a');
	a.href = URL.createObjectURL(recordedVideoBlob);
	a.download = currentEnvBasename + '.webm';
	a.click();
	URL.revokeObjectURL(a.href);
}

function closeVideoPreview() {
	var container = document.getElementById('video_preview_container');
	var video = document.getElementById('video_preview');
	if (video.src) URL.revokeObjectURL(video.src);
	video.removeAttribute('src');
	container.style.display = 'none';
	recordedVideoBlob = null;
}

function updateRecordingProgress() {
	if (!isRecording) return;

	var progress = Math.min(++recordingFrameCount / recordingTotalFrames, 1);
	document.getElementById('record_progress_bar').style.setProperty('--record-progress', (progress * 100) + '%');

	// Tween exposure: original -> -1 * original -> original over the full recording
	if (recordingStartExposure !== 0) {
		var tweened;
		if (progress < 0.5) {
			tweened = recordingStartExposure + (-recordingStartExposure - recordingStartExposure) * (progress * 2);
		} else {
			tweened = -recordingStartExposure + (recordingStartExposure - (-recordingStartExposure)) * ((progress - 0.5) * 2);
		}
		window.PBR1_CHANGE({'environment_exposure': tweened});
	}

	// Stop before rendering the duplicate start frame
	if (recordingFrameCount >= recordingTotalFrames) {
		stopRecording();
	}
}

function animate() {
    requestAnimationFrame( animate );
	controls.update();
	if(shadowLightHelper){ shadowLightHelper.update(); }
	if(shadowCameraHelper){ shadowCameraHelper.update(); }
    renderer.render( scene, camera );
	updateRecordingProgress();
}

BASE.start(initializeScene,preprocessSceneConfiguration,updateScene,animate);