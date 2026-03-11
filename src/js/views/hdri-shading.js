// IMPORTS
import * as THREE from "../threejs/three.module.js";
import * as ORBIT_CONTROLS from '../threejs/OrbitControls.js';
import * as MESSAGE from '../common/message.js';
import * as BASE from "../common/base.js";
import * as SCENE_CONFIGURATION from "../common/scene-configuration.js";
import * as CONSTANTS from "../common/constants.js";
import * as THREE_ACTIONS from "../common/three-actions.js";
import * as MISC from "../common/misc.js";

// VARIABLES AND CONSTANTS

var scene, renderer, camera, diffuseSphere, glossySphere, metallicSphere, controls;
var isRecording = false;
var mediaRecorder = null;
var recordedChunks = [];
var recordingFrameCount = 0;
var recordingTotalFrames = 0;
var autoPanWasOff = false;

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
			THREE_ACTIONS.updateSceneEnvironment(envFileUrl,scene,renderer);
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
	camera.position.x = 2;
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
	glossySphere.position.z = 0;

	metallicSphere = new THREE.Mesh(
		new THREE.SphereGeometry(0.33,128,128), 
		new THREE.MeshPhysicalMaterial({"color":0xFFFFFF,"roughness":0,"metalness":1}) 
	);
	metallicSphere.position.z = -1;

	scene.add(diffuseSphere);
	scene.add(glossySphere);
	scene.add(metallicSphere);

	// renderer
	renderer = new THREE.WebGLRenderer();
	renderer.outputEncoding = CONSTANTS.encoding.sRGB;

	THREE_ACTIONS.updateSceneEnvironment("./media/env-placeholder.exr",scene,renderer);

	// orbit controls
	controls = new ORBIT_CONTROLS.OrbitControls(camera, renderer.domElement);
	controls.enableZoom = true;
	controls.minDistance = controls.maxDistance = 2;
	controls.enablePan = false;
	controls.enableDamping = true;
	controls.autoRotateSpeed = 12.0;
	controls.listenToKeyEvents(window);

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
	};

	THREE_ACTIONS.setupEnvironmentFileDrop(handleLocalEnvFile);

	// Upload button file input
	document.getElementById('environment_file_input').addEventListener('change', (e) => {
		var file = e.target.files[0];
		if(file) THREE_ACTIONS.loadEnvironmentFromFile(file, handleLocalEnvFile);
		e.target.value = '';
	});

	// Record video
	document.getElementById('record_video_btn').addEventListener('click', toggleRecording);
	document.getElementById('video_preview_close').addEventListener('click', closeVideoPreview);
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
		var blob = new Blob(recordedChunks, { type: 'video/webm' });
		var url = URL.createObjectURL(blob);
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

	// Restore auto pan state
	if (autoPanWasOff) {
		window.PBR1_CHANGE({'auto_pan_enable': 0});
		document.getElementById('auto_pan_enable').checked = false;
		autoPanWasOff = false;
	}
}

function closeVideoPreview() {
	var container = document.getElementById('video_preview_container');
	var video = document.getElementById('video_preview');
	if (video.src) URL.revokeObjectURL(video.src);
	video.removeAttribute('src');
	container.style.display = 'none';
}

function updateRecordingProgress() {
	if (!isRecording) return;

	recordingFrameCount++;

	var progress = Math.min(recordingFrameCount / recordingTotalFrames, 1);
	document.getElementById('record_progress_bar').style.setProperty('--record-progress', (progress * 100) + '%');

	// Stop before rendering the duplicate start frame
	if (recordingFrameCount >= recordingTotalFrames) {
		stopRecording();
	}
}

function animate() {
    requestAnimationFrame( animate );
	controls.update();
	updateRecordingProgress();
    renderer.render( scene, camera );
}

BASE.start(initializeScene,preprocessSceneConfiguration,updateScene,animate);