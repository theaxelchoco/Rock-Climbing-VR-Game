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
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";

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

    private leftGrabbedObject: AbstractMesh | null;
    private rightGrabbedObject: AbstractMesh | null;
    private grabbableObjects: Array<AbstractMesh>;

    private laserPointer: LinesMesh | null;
    private teleportPoint: Vector3 | null;
    private groundMeshes: Array<AbstractMesh>;

    private locomotionMode: LocomotionMode;
    private rotationMode: RotationMode;
    private snapRotationDirection: number;
    private skeleton: Skeleton | null = null;
    private leftHandMesh: AbstractMesh | null = null;
    private rightHandMesh: AbstractMesh | null = null;
    private playerCollider: Mesh | null = null;


    constructor() {
        this.canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
        this.engine = new Engine(this.canvas, true);
        this.scene = new Scene(this.engine);
        this.leftController = null;
        this.rightController = null;
        this.xrCamera = null;
        this.rightGrabbedObject = null;
        this.leftGrabbedObject = null;
        this.grabbableObjects = [];
        this.locomotionMode = LocomotionMode.viewDirected;
        this.rotationMode = RotationMode.smoothRotation;
        this.laserPointer = null;
        this.teleportPoint = null;
        this.groundMeshes = [];
        this.snapRotationDirection = 0;
        this.baseRotationY = 0;
        this.playerCollider = null;
    }

    private async createScene(): Promise<void> {

        // create and position a first-person camera (non-mesh)
        var camera = new UniversalCamera("camera1", new Vector3(0, 1.6, 0), this.scene);
        camera.attachControl(this.canvas, true);

        // ambient light to illuminate the scene
        var light = new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);
        light.intensity = 0.5;

        // here comes the sun
        var dLight = new DirectionalLight("theSun", new Vector3(0, -1, 0), this.scene);

        // create a default skybox and ground
        const environment = this.scene.createDefaultEnvironment({
            createGround: true,
            groundSize: 200,
            skyboxSize: 750,
            skyboxColor: new Color3(.059, .663, .8)
        });

        // don't pick the sky!
        environment!.skybox!.isPickable = false;

        // set our ground meshes for teleportation
        this.groundMeshes.push(environment!.ground!);

        // create the XR experience helper
        const xrHelper = await this.scene.createDefaultXRExperienceAsync({
            inputOptions: {
                doNotLoadControllerMeshes: true  // Tell Babylon.js not to load the default controller meshes
            }
        });

        // get a reference to the xr camera
        this.xrCamera = xrHelper.baseExperience.camera;

        //remove default teleportation and pointer behaviour
        xrHelper.teleportation.dispose();
        xrHelper.pointerSelection.dispose();

        // set up custom laser pointer
        // defining points for the line mesh
        var laserPoints = [];
        laserPoints.push(new Vector3(0, 0, 0));
        laserPoints.push(new Vector3(0, 0, 1));
        // initialize laserPointer
        this.laserPointer = MeshBuilder.CreateLines("laserPointer", { points: laserPoints }, this.scene);
        this.laserPointer.color = Color3.White();
        this.laserPointer.alpha = .5;
        this.laserPointer.visibility = 0;
        this.laserPointer.isPickable = false;

        // enable physics
        this.scene.enablePhysics(new Vector3(0, -9.81, 0), new CannonJSPlugin(undefined, undefined, Cannon));

        this.setupPlayerCollider()

        // set up ground for teleportation and physics
        xrHelper.teleportation.addFloorMesh(environment!.ground!);
        environment!.ground!.isVisible = false;
        environment!.ground!.position = new Vector3(0, 0, 0);
        environment!.ground!.physicsImpostor = new PhysicsImpostor(environment!.ground!, PhysicsImpostor.BoxImpostor,
            { mass: 0, friction: 0.5, restitution: 0.7, ignoreParent: true }, this.scene);

        // add handler for when controllers are added
        xrHelper.input.onControllerAddedObservable.add((inputSource) => {
            if (inputSource.uniqueId.endsWith("left")) {
                this.leftController = inputSource;
                this.laserPointer!.parent = this.leftController.pointer;
                if (this.leftController.pointer) {
                    this.leftController.pointer.isVisible = false;
                }
            } else if (inputSource.uniqueId.endsWith("right")) {
                this.rightController = inputSource;
                this.laserPointer!.parent = this.rightController.pointer;
                if (this.rightController.pointer) {
                    this.rightController.pointer.isVisible = false;
                }
            }
            this.onControllerAdded(inputSource);
        });


        // add handler for when controllers are removed
        xrHelper.input.onControllerRemovedObservable.add((inputSource) => {
            if (inputSource.uniqueId.endsWith("left")) {
                this.laserPointer!.parent = null;
                this.laserPointer!.visibility = 0;
            }
            else if (inputSource.uniqueId.endsWith("right")) {
                this.laserPointer!.parent = null;
                this.laserPointer!.visibility = 0;
            }
            this.onControllerRemoved(inputSource);
        });


        // load assets        
        var assetsManager = new AssetsManager(this.scene);

        // game world
        var worldTask = assetsManager.addMeshTask("world task", "", "assets/models/", "FullWorkspace.glb");
        worldTask.onSuccess = (task) => {
            worldTask.loadedMeshes[0].name = "world";
            worldTask.loadedMeshes[0].position = new Vector3(0, 0.3, 0);
            worldTask.loadedMeshes[0].rotation = Vector3.Zero();
            // worldTask.loadedMeshes[0].scaling = Vector3.One();

            // select what meshes are considered "floor" by the teleportation mechanic

            worldTask.loadedMeshes.forEach((mesh) => {
                if (mesh.name.startsWith("Plane")) {
                    this.groundMeshes.push(mesh);
                } else if (mesh.name.startsWith("Rocks")) {
                    mesh.scaling = new Vector3(.2, .2, .2);
                } else if (mesh.name.startsWith("Shrub")) {
                    var bushSize = .2
                    mesh.scaling = new Vector3(bushSize, bushSize, bushSize);
                }
            });

        }

        // will display a loading screen while loading
        assetsManager.load();

        // things to do once the assets are loaded
        assetsManager.onFinish = (tasks) => {
            worldTask.loadedMeshes.forEach((mesh) => {
                if (mesh.name == "rpgpp_lt_table_01") {
                    mesh.setParent(null);
                    mesh.physicsImpostor = new PhysicsImpostor(mesh, PhysicsImpostor.BoxImpostor,
                        { mass: 0 }, this.scene);
                } else if (mesh.parent?.name == "Props") {
                    mesh.setParent(null);
                    this.grabbableObjects.push(mesh);
                    mesh.physicsImpostor = new PhysicsImpostor(mesh, PhysicsImpostor.BoxImpostor,
                        { mass: 1 }, this.scene);
                    mesh.physicsImpostor.sleep();
                }
            })
            // show the debug layer
            this.scene.debugLayer.show();

        };

    }

    private onControllerAdded(controller: WebXRInputSource): void {
        if (controller.uniqueId.endsWith("left")) {
            SceneLoader.ImportMesh("", "assets/models/Hands with animation/", "scene.gltf", this.scene, (meshes, particleSystems, skeletons) => {
                this.leftHandMesh = meshes[0];
                const handScale = 0.001; // Adjust this value as needed to get the desired size
                this.leftHandMesh.scaling = new Vector3(handScale, handScale, handScale);
                this.leftHandMesh.scaling.x *= -1;
                this.leftHandMesh.parent = controller.pointer;
                this.leftHandMesh.rotationQuaternion = Quaternion.FromEulerAngles(0, 0, Math.PI / 2);
                this.leftHandMesh.isVisible = true;
                this.scene.animationGroups.forEach(group => {
                    group.stop();
                });
            });
        } else if (controller.uniqueId.endsWith("right")) {
            SceneLoader.ImportMesh("", "assets/models/Hands with animation/", "scene.gltf", this.scene, (meshes, particleSystems, skeletons) => {
                this.rightHandMesh = meshes[0];
                const handScale = 0.001; // Adjust this value as needed to get the desired size
                this.rightHandMesh.scaling = new Vector3(handScale, handScale, handScale);
                this.rightHandMesh.parent = controller.pointer;
                this.rightHandMesh.rotationQuaternion = Quaternion.FromEulerAngles(0, 0, -Math.PI / 2);
                this.rightHandMesh.isVisible = true;
                this.scene.animationGroups.forEach(group => {
                    group.stop();
                });
            });
        }
    }

    private onControllerRemoved(controller: WebXRInputSource) {
        console.log("controller removed: " + controller.pointer.name);
    }

    private setupPlayerCollider(): void {
        // Create player collider
        this.playerCollider = MeshBuilder.CreateSphere("playerCollider", { diameter: 1.6, segments: 16 }, this.scene);
        this.playerCollider.isVisible = false;
        this.playerCollider.position = new Vector3(0, 0.8, 0);
        this.playerCollider.checkCollisions = true;

        // Setup physics impostor
        this.playerCollider.physicsImpostor = new PhysicsImpostor(
            this.playerCollider,
            PhysicsImpostor.SphereImpostor,
            { mass: 1, restitution: 0.9 },
            this.scene
        );

        // Keep the player's collider under the camera
        this.scene.registerBeforeRender(() => {
            if (this.playerCollider && this.xrCamera) {
                let horizontalPosition = this.xrCamera.position.clone();
                horizontalPosition.y = this.playerCollider.position.y;
                this.playerCollider.position.x = horizontalPosition.x;
                this.playerCollider.position.z = horizontalPosition.z;
            }
        });
    }

    // this update code will be executed once per frame before rendering the scene
    private update(): void {
        this.processControllerInput();
    }

    // handle any changes in controller interaction 
    private processControllerInput(): void {
        this.onRightTrigger(this.rightController?.motionController?.getComponent("xr-standard-trigger"));
        this.onLeftTrigger(this.leftController?.motionController?.getComponent("xr-standard-trigger"));
        this.onRightSqueeze(this.rightController?.motionController?.getComponent("xr-standard-squeeze"));
        this.onLeftSqueeze(this.leftController?.motionController?.getComponent("xr-standard-squeeze"));
        this.onRightThumbstick(this.rightController?.motionController?.getComponent("xr-standard-thumbstick"));
        this.onLeftThumbstick(this.leftController?.motionController?.getComponent("xr-standard-thumbstick"));
        this.onRightA(this.rightController?.motionController?.getComponent("a-button"));
        this.onRightB(this.rightController?.motionController?.getComponent("b-button"));
    }

    private onLeftTrigger(component?: WebXRControllerComponent) {
        if (component?.changes.pressed) {
            if (component?.pressed) {
                Logger.Log("left trigger pressed");
            }
            else {
                Logger.Log("left trigger released");
            }
        }
    }

    private onRightTrigger(component?: WebXRControllerComponent) {
        if (component?.changes.pressed) {
            if (component?.pressed) {
                Logger.Log("right trigger pressed");
            }
            else {
                Logger.Log("right trigger released");
            }
        }
    }

    private onLeftSqueeze(component?: WebXRControllerComponent) {
        if (component?.changes.pressed) {
            if (component?.pressed) {
                Logger.Log("left squeeze pressed");
                this.scene.animationGroups.forEach(group => {
                    if (group.targetedAnimations[0].target === this.leftHandMesh) {
                        group.goToFrame(0); // Assuming 0 is the start of the closing animation
                        group.play(false); // Play animation once without looping
                        group.onAnimationEndObservable.addOnce(() => {
                            group.goToFrame(group.to); // Ensure animation stops at the end
                        });
                    }
                });
                // are we intersecting an object that can be grasped?
                for (var i = 0; i < this.grabbableObjects.length && !this.leftGrabbedObject; i++) {
                    if (this.leftController!.grip!.intersectsMesh(this.grabbableObjects[i], true)) {
                        this.leftGrabbedObject = this.grabbableObjects[i];
                        this.leftGrabbedObject.physicsImpostor?.sleep();
                        this.leftGrabbedObject.setParent(this.leftController!.grip!);
                    }
                }

            } else {
                Logger.Log("left squeeze released");
                this.scene.animationGroups.forEach(group => {
                    if (group.targetedAnimations[0].target === this.leftHandMesh) {
                        group.goToFrame(group.to); // Assuming 'to' is the frame where the hand is fully closed
                        group.play(false); // Play animation once without looping
                        group.onAnimationEndObservable.addOnce(() => {
                            group.goToFrame(0); // Ensure animation stops at the open hand pose
                        });
                    }
                });
                // release the grasped object (if any)
                if (this.leftGrabbedObject) {
                    this.leftGrabbedObject.setParent(null);
                    this.leftGrabbedObject.physicsImpostor?.wakeUp();
                    this.leftGrabbedObject = null;
                }
            }

        }
    }
    // process right squeeze button changes
    private onRightSqueeze(component?: WebXRControllerComponent) {
        if (component?.changes.pressed) {
            if (component?.pressed) {
                Logger.Log("right squeeze pressed");
                this.scene.animationGroups.forEach(group => {
                    if (group.targetedAnimations[0].target === this.rightHandMesh) {
                        group.goToFrame(0); // Assuming 0 is the start of the closing animation
                        group.play(false); // Play animation once without looping
                        group.onAnimationEndObservable.addOnce(() => {
                            group.goToFrame(group.to); // Ensure animation stops at the end
                        });
                    }
                });
                // are we intersecting an object that can be grasped?
                for (var i = 0; i < this.grabbableObjects.length && !this.rightGrabbedObject; i++) {
                    if (this.rightController!.grip!.intersectsMesh(this.grabbableObjects[i], true)) {
                        this.rightGrabbedObject = this.grabbableObjects[i];
                        this.rightGrabbedObject.physicsImpostor?.sleep();
                        this.rightGrabbedObject.setParent(this.rightController!.grip!);
                    }
                }

            } else {
                Logger.Log("right squeeze released");
                this.scene.animationGroups.forEach(group => {
                    if (group.targetedAnimations[0].target === this.rightHandMesh) {
                        group.goToFrame(group.to); // Assuming 'to' is the frame where the hand is fully closed
                        group.play(false); // Play animation once without looping
                        group.onAnimationEndObservable.addOnce(() => {
                            group.goToFrame(0); // Ensure animation stops at the open hand pose
                        });
                    }
                });
                // release the grasped object (if any)
                if (this.rightGrabbedObject) {
                    this.rightGrabbedObject.setParent(null);
                    this.rightGrabbedObject.physicsImpostor?.wakeUp();
                    this.rightGrabbedObject = null;
                }
            }

        }
    }

    private onRightA(component?: WebXRControllerComponent) {
        if (component?.changes.pressed?.current) {
            if (this.locomotionMode == LocomotionMode.teleportation) {
                this.locomotionMode = 0;
            } else {
                this.locomotionMode += 1;
            }
        }
    }

    private onRightB(component?: WebXRControllerComponent) {
        if (component?.changes.pressed?.current) {
            if (this.rotationMode == RotationMode.snapRotation) {
                this.rotationMode = 0;
            } else {
                this.rotationMode += 1;
            }
        }
    }

    private onLeftThumbstick(component?: WebXRControllerComponent) {
        if (!component) return;
        if (this.locomotionMode == LocomotionMode.teleportation) {
            if (component.changes.axes && component.axes.y < -0.75) { // Pushing forward
                var ray = new Ray(this.leftController!.pointer.position,
                    this.leftController!.pointer.forward, 30);
                var pickInfo = this.scene.pickWithRay(ray);

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
        } else {
            if (component && component.changes.axes) {
                var forward = this.xrCamera!.getDirection(Axis.Z);
                var right = this.xrCamera!.getDirection(Axis.X);
                forward.y = 0; // Prevent movement in the Y-axis direction
                right.y = 0; // Prevent movement in the Y-axis direction
                var direction = forward.scale(-component.axes.y).add(right.scale(component.axes.x));
                direction.normalize(); // Normalize the direction to maintain consistent movement speed
                var moveDistance = (this.engine.getDeltaTime() / 1000) * 3;
                this.xrCamera!.position.addInPlace(direction.scale(moveDistance));
                // Ensure the camera stays at a fixed height above the ground
                this.xrCamera!.position.y = this.calculateGroundHeight(this.xrCamera!.position);
            }
        }
    }
    private calculateGroundHeight(position: Vector3): number {
        const ray = new Ray(position.add(new Vector3(0, 1, 0)), new Vector3(0, -1, 0));
        const pickInfo = this.scene.pickWithRay(ray, (mesh) => this.groundMeshes.includes(mesh));
        if (pickInfo && pickInfo.hit) {
            if (pickInfo.pickedPoint) {
                // Ensure the player's height above the ground is maintained
                return pickInfo.pickedPoint.y + 1.6 / 2; // Adjust the offset based on player's collider size
            }
        }
        // If ground height cannot be determined, return a default value
        return 0;
    }
    private baseRotationY = 0; // Base rotation around Y-axis, independent of head tilt

    private onRightThumbstick(component?: WebXRControllerComponent) {
        if (this.xrCamera) {
            if (component && component.changes.axes) {
                const deltaTime = this.engine.getDeltaTime() / 1000;
                if (this.rotationMode === RotationMode.smoothRotation) {
                    let smoothRotationIncrement = component.axes.x * deltaTime * 0.8;
                    let currentRotation = this.xrCamera.rotationQuaternion.toEulerAngles();
                    this.xrCamera.rotationQuaternion = Quaternion.FromEulerAngles(currentRotation.x, currentRotation.y + smoothRotationIncrement, currentRotation.z);
                } else if (this.rotationMode === RotationMode.snapRotation) {
                    // Snap rotation: Apply a fixed rotation increment when thumbstick crosses a threshold
                    if (Math.abs(component.axes.x) > 0.75 && this.snapRotationDirection === 0) {
                        let snapRotationIncrement = Math.sign(component.axes.x) * Math.PI / 6; // 30 degrees in radians
                        let currentRotation = this.xrCamera.rotationQuaternion.toEulerAngles();
                        this.xrCamera.rotationQuaternion = Quaternion.FromEulerAngles(currentRotation.x, currentRotation.y + snapRotationIncrement, currentRotation.z);
                        this.snapRotationDirection = Math.sign(component.axes.x); // Prevent repeated rotation
                    } else if (Math.abs(component.axes.x) <= 0.75) {
                        this.snapRotationDirection = 0; // Reset when thumbstick returns to near-center position
                    }
                }
            }
        }
    }



    start(): void {
        // create the scene, wait for scene to be created  
        this.createScene().then(() => {
            // run render loop
            this.engine.runRenderLoop(() => {
                this.update();
                this.scene.render();
            });
            // watch for resize events
            window.addEventListener("resize", () => {
                this.engine.resize();
            });
        });
    }
} /* Game class ends */

// entering scriptsville
var game = new Game();
game.start();
