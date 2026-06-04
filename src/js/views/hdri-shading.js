// IMPORTS
import * as THREE from "three";
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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

	// Set Environment
	if(newSceneConfiguration.environment_url.length > 0){
		if( !SCENE_CONFIGURATION.equalAtKey(oldSceneConfiguration,newSceneConfiguration,"environment_index") || 
			!SCENE_CONFIGURATION.equalAtKey(oldSceneConfiguration,newSceneConfiguration,"environment_url")){
			var envFileUrl = newSceneConfiguration.environment_url[newSceneConfiguration.environment_index];
			THREE_ACTIONS.updateSceneEnvironment(envFileUrl,scene,renderer,updateShadowLightFromEnvironment);
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

		"spheres_accent_color": "116DD5" 
	
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
	glossySphere.position.z = -1;

	metallicSphere = new THREE.Mesh(
		new THREE.SphereGeometry(0.5,128,128), 
		new THREE.MeshPhysicalMaterial({"color":0xFFFFFF,"roughness":0,"metalness":1}) 
	);
	metallicSphere.position.z = 0;
	metallicSphere.castShadow = true;
	metallicSphere.receiveShadow = true;

	// scene.add(diffuseSphere);
	// scene.add(glossySphere);
	scene.add(metallicSphere);

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

	// renderer
	renderer = new THREE.WebGLRenderer();
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
	document.addEventListener( 'mousewheel', (e) =>{zoomHandler(e,camera)});

	// Set up renderer
	document.querySelector('#renderer_target').appendChild( renderer.domElement );
	THREE_ACTIONS.resizeRenderingArea(camera,renderer);
}

function animate() {
    requestAnimationFrame( animate );
	controls.update();
	if(shadowLightHelper){ shadowLightHelper.update(); }
	if(shadowCameraHelper){ shadowCameraHelper.update(); }
    renderer.render( scene, camera );
}

BASE.start(initializeScene,preprocessSceneConfiguration,updateScene,animate);