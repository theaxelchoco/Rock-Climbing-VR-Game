/* eslint-disable @typescript-eslint/consistent-type-assertions */
/* eslint-disable no-var */
/* CSCI 4262 Tutorial 5
 * Author: Derek Reilly, heavily based on code by E.S. Rosenberg
 * License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
 */ 
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Scene } from "@babylonjs/core/scene";

import "@babylonjs/inspector"
import "@babylonjs/core/Helpers/sceneHelpers"
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { AssetsManager } from "@babylonjs/core/Misc/assetsManager";
import { PointerEventTypes, PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { Logger } from "@babylonjs/core/Misc/logger";
import { WebXRControllerComponent } from "@babylonjs/core/XR/motionController/webXRControllerComponent";
import { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import { PhysicsImpostor } from "@babylonjs/core/Physics/physicsImpostor";
import * as Cannon from "cannon";
import { CannonJSPlugin } from "@babylonjs/core/Physics/Plugins/cannonJSPlugin";
import "@babylonjs/core/Physics/physicsEngineComponent";
import { WebXRCamera } from "@babylonjs/core/XR/webXRCamera";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { MeshBuilder, Ray } from "@babylonjs/core";

enum LocomotionMode { 
    viewDirected, 
    handDirected, 
    teleportation
}

enum RotationMode {
    smoothRotation, 
    snapRotation
}

class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;

    private xrCamera: WebXRCamera | null;
    private leftController: WebXRInputSource | null;
    private rightController: WebXRInputSource | null;

    private rightGrabbedObject: AbstractMesh | null;
    private grabbableObjects: Array<AbstractMesh>;

    private laserPointer: LinesMesh | null;
    private teleportPoint: Vector3 | null;
    private groundMeshes: Array<AbstractMesh>;

    private locomotionMode: LocomotionMode;
    private rotationMode: RotationMode;
    private snapRotationDirection: number;

    constructor () {
        this.canvas = document.getElementById ("renderCanvas") as HTMLCanvasElement;
        this.engine = new Engine (this.canvas, true);        
        this.scene = new Scene (this.engine);    
        this.leftController = null;
        this.rightController = null;
        this.xrCamera = null;
        this.rightGrabbedObject = null;
        this.grabbableObjects = [];
        this.locomotionMode = LocomotionMode.viewDirected;
        this.rotationMode = RotationMode.smoothRotation;
        this.laserPointer = null;
        this.teleportPoint = null;
        this.groundMeshes = [];
        this.snapRotationDirection = 0;
    }

    private async createScene (): Promise<void> {

        // create and position a first-person camera (non-mesh)
        var camera = new UniversalCamera ("camera1", new Vector3 (0, 1.6, 0), this.scene);
        camera.attachControl (this.canvas, true);

        // ambient light to illuminate the scene
        var light = new HemisphericLight ("light", new Vector3 (0,1,0), this.scene);
        light.intensity = 0.5;

        // here comes the sun
        var dLight = new DirectionalLight("theSun", new Vector3 (0, -1, 0), this.scene);

        // create a default skybox and ground
        const environment = this.scene.createDefaultEnvironment ({
            createGround: true,
            groundSize: 200,
            skyboxSize: 750,
            skyboxColor: new Color3 (.059, .663, .8)
        });

        // don't pick the sky!
        environment!.skybox!.isPickable = false;

        // set our ground meshes for teleportation
        this.groundMeshes.push (environment!.ground!);

        // create the XR experience helper
        const xrHelper = await this.scene.createDefaultXRExperienceAsync ({});

        // get a reference to the xr camera
        this.xrCamera = xrHelper.baseExperience.camera;

        //remove default teleportation and pointer behaviour
        xrHelper.teleportation.dispose ();
        xrHelper.pointerSelection.dispose ();

        // set up custom laser pointer
        // defining points for the line mesh
        var laserPoints = [];
        laserPoints.push (new Vector3 (0, 0, 0));
        laserPoints.push (new Vector3 (0, 0, 1));
        // initialize laserPointer
        this.laserPointer = MeshBuilder.CreateLines ("laserPointer", {points: laserPoints}, this.scene);
        this.laserPointer.color = Color3.White ();
        this.laserPointer.alpha = .5;
        this.laserPointer.visibility = 0;
        this.laserPointer.isPickable = false;

        // enable physics
        this.scene.enablePhysics (new Vector3 (0, -9.81, 0), new CannonJSPlugin (undefined, undefined, Cannon));

        // set up ground for teleportation and physics
        xrHelper.teleportation.addFloorMesh (environment!.ground!);
        environment!.ground!.isVisible = false;
        environment!.ground!.position = new Vector3 (0, 0, 0);
        environment!.ground!.physicsImpostor = new PhysicsImpostor (environment!.ground!, PhysicsImpostor.BoxImpostor, 
            {mass: 0, friction: 0.5, restitution: 0.7, ignoreParent: true}, this.scene);

        // add handler for when controllers are added
        xrHelper.input.onControllerAddedObservable.add ((inputSource) => {
            if (inputSource.uniqueId.endsWith ("left")) {
                this.leftController = inputSource;
            } else {
                this.rightController = inputSource;
                this.laserPointer!.parent = this.rightController.pointer;
            }
        });


        // add handler for when controllers are removed
        xrHelper.input.onControllerRemovedObservable.add ((inputSource) => {
            if (inputSource.uniqueId.endsWith ("right")) {
                this.laserPointer!.parent = null;
                this.laserPointer!.visibility = 0;
            }
        });


        // load assets        
        var assetsManager = new AssetsManager (this.scene);

        // game world
        var worldTask = assetsManager.addMeshTask ("world task", "", "assets/models/", "FullWorkspace.glb");
        worldTask.onSuccess = (task) => {
            worldTask.loadedMeshes[0].name = "world";
            worldTask.loadedMeshes[0].position = new Vector3(0, 0.3, 0);
            worldTask.loadedMeshes[0].rotation = Vector3.Zero();
           // worldTask.loadedMeshes[0].scaling = Vector3.One();

            // select what meshes are considered "floor" by the teleportation mechanic
           
            worldTask.loadedMeshes.forEach ((mesh) => {
                if (mesh.name.startsWith ("Plane")) {
                    this.groundMeshes.push (mesh);
                } else if (mesh.name.startsWith("Rocks")) {
                    mesh.scaling = new Vector3(.2,.2,.2);
                } else if (mesh.name.startsWith("Shrub")) {
                    var bushSize = .2
                    mesh.scaling = new Vector3(bushSize, bushSize, bushSize);
                }
            });
            
        }
        
        // will display a loading screen while loading
        assetsManager.load ();

        // things to do once the assets are loaded
        assetsManager.onFinish = (tasks) => {
            worldTask.loadedMeshes.forEach ((mesh) => {
                if (mesh.name == "rpgpp_lt_table_01") {
                    mesh.setParent (null);
                    mesh.physicsImpostor = new PhysicsImpostor (mesh, PhysicsImpostor.BoxImpostor, 
                        {mass: 0}, this.scene);
                } else if (mesh.parent?.name == "Props") {
                    mesh.setParent (null);
                    this.grabbableObjects.push (mesh);
                    mesh.physicsImpostor = new PhysicsImpostor (mesh, PhysicsImpostor.BoxImpostor, 
                        {mass: 1}, this.scene);
                    mesh.physicsImpostor.sleep ();
                }
            })
            // show the debug layer
            this.scene.debugLayer.show ();

        };
        
    }


    // this update code will be executed once per frame before rendering the scene
    private update (): void {
        this.processControllerInput ();
    }

    // handle any changes in controller interaction 
    private processControllerInput (): void {
        this.onRightTrigger(this.rightController?.motionController?.getComponent("xr-standard-trigger"));
        this.onRightSqueeze(this.rightController?.motionController?.getComponent("xr-standard-squeeze"));
        this.onRightThumbstick(this.rightController?.motionController?.getComponent("xr-standard-thumbstick"));
        this.onRightA(this.rightController?.motionController?.getComponent("a-button"));
        this.onRightB(this.rightController?.motionController?.getComponent("b-button"));
    }

 

    private onRightTrigger(component?: WebXRControllerComponent)
    {  
        if(component?.changes.pressed)
        {
            if(component?.pressed)
            {
                Logger.Log("right trigger pressed");
            }
            else
            {
                Logger.Log("right trigger released");
            }
        }  
    }

    // process right squeeze button changes
    private onRightSqueeze (component?: WebXRControllerComponent) {
        if (component?.changes.pressed) {
            if (component?.pressed) {
                Logger.Log ("right squeeze pressed");
                // are we intersecting an object that can be grasped?
                for (var i = 0; i < this.grabbableObjects.length && !this.rightGrabbedObject; i++) {
                    if (this.rightController!.grip!.intersectsMesh (this.grabbableObjects [i], true)) {
                        this.rightGrabbedObject = this.grabbableObjects [i];
                        this.rightGrabbedObject.physicsImpostor?.sleep ();
                        this.rightGrabbedObject.setParent (this.rightController!.grip!);
                    }
                }

            } else {
                Logger.Log ("right squeeze released");
                // release the grasped object (if any)
                if (this.rightGrabbedObject) {
                    this.rightGrabbedObject.setParent (null);
                    this.rightGrabbedObject.physicsImpostor?.wakeUp ();
                    this.rightGrabbedObject = null;
                }
            }

        }
    }

    private onRightA(component?: WebXRControllerComponent) {  
        if(component?.changes.pressed?.current) {
            if (this.locomotionMode == LocomotionMode.teleportation) {
                this.locomotionMode = 0;
            } else {
                this.locomotionMode += 1;
            }
        }  
    }

    private onRightB(component?: WebXRControllerComponent)
    {  
        if(component?.changes.pressed?.current) {
            if (this.rotationMode == RotationMode.snapRotation) {
                this.rotationMode = 0;
            } else {
                this.rotationMode += 1;
            }
        }
    }

    private onRightThumbstick(component?: WebXRControllerComponent)
    {  
        if(component?.changes.pressed)
        {
            if(component?.pressed)
            {
                Logger.Log("right thumbstick pressed");
            }
            else
            {
                Logger.Log("right thumbstick released");
            }
        }  

        if(component?.changes.axes)
        {
            Logger.Log("right thumbstick axes: (" + component.axes.x + "," + component.axes.y + ")");

            if (this.locomotionMode == LocomotionMode.teleportation) { // teleportation
                if (component.axes.y < -.75) {
                    // create a ray cast using the controller orientation
                    var ray = new Ray (this.rightController!.pointer.position, 
                            this.rightController!.pointer.forward, 30);
                    var pickInfo = this.scene.pickWithRay (ray);

                    if (pickInfo?.hit && this.groundMeshes.includes(pickInfo!.pickedMesh!)) {
                        this.teleportPoint = pickInfo.pickedPoint;
                        this.laserPointer!.scaling.z = pickInfo.distance;
                        this.laserPointer!.visibility = 1;
                    } else {
                        this.teleportPoint = null;
                        this.laserPointer!.visibility = 0;
                    }
                } else if (component.axes.y == 0) { // thumbstick released
                    this.laserPointer!.visibility = 0;
                    
                    if (this.teleportPoint) {
                        // teleport!
                        this.xrCamera!.position.x = this.teleportPoint.x;
                        this.xrCamera!.position.y = this.teleportPoint.y + this.xrCamera!.realWorldHeight;
                        this.xrCamera!.position.z = this.teleportPoint.z;
                        this.teleportPoint = null;
                    }
                }

            } else { // view directed or hand directed steering
                var directionVector = (this.locomotionMode == LocomotionMode.handDirected) 
                ? this.rightController!.pointer.forward
                : this.xrCamera!.getDirection (Axis.Z);
                // use the delta in time to determine the distance to move based on 3 m/s
                var moveDistance = (this.engine.getDeltaTime () / 1000) * 3 * component.axes.y * -1;
                // move the camera forward
                this.xrCamera!.position.addInPlace (directionVector.scale (moveDistance));
                
            }

            if (this.rotationMode == RotationMode.smoothRotation) {
                // smooth turning
                // use the delta in time to determine the turn angle based on 60 degrees / sec
                var turnAngle = (this.engine.getDeltaTime () / 1000) * 60 * component.axes.x;
                // get the rotation 
                var cameraRotation = Quaternion.FromEulerAngles (0, turnAngle * Math.PI / 180, 0);
                // rotate the camera 
                this.xrCamera!.rotationQuaternion.multiplyInPlace (cameraRotation);
                
            } else {
                // snap turning
                if (Math.abs(component.axes.x) > .75) {
                    this.snapRotationDirection = Math.sign (component.axes.x);
                } else if (component.axes.x == 0) {
                    if (this.snapRotationDirection != 0) {
                        var cameraRotation = Quaternion.FromEulerAngles (0, this.snapRotationDirection * 30 * Math.PI/180, 0);  
                        this.xrCamera!.rotationQuaternion.multiplyInPlace (cameraRotation);
                        this.snapRotationDirection = 0;
                    }
                }
            }
        }
    }  
    
    start (): void {
        // create the scene, wait for scene to be created  
        this.createScene ().then (() => {
            // run render loop
            this.engine.runRenderLoop (() => {
                this.update ();
                this.scene.render ();
            });
            // watch for resize events
            window.addEventListener ("resize", () => {
                this.engine.resize ();
            });
        });
    }
} /* Game class ends */

// entering scriptsville
var game = new Game ();
game.start ();
