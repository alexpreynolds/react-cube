import React from 'react';
import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect';
import { WEBGL } from 'three/examples/jsm/WebGL';
import { debounce } from 'ts-debounce';
import IdleTimer from 'react-idle-timer';
import ReactTooltip from 'react-tooltip';
import PubSub from 'pubsub-js';
import MultivariateNormal from 'multivariate-normal';
// import fragmentShader from './shaders/fragment';
// import vertexShader from './shaders/vertex';

// @ts-ignore
import * as hdf5 from 'h5wasm';

interface Props {}

interface State {
  width: number,
  height: number,
  pointSets: Array<Array<any>>,
  rawPointSets: Array<any>,
  setColors: Array<number>,
  idleTimerRemaining: number,
  idleTimerIsIdle: boolean,
  idleTimerLastActive: number,
  idleTimerElapsed: number,
  tooltipInnerText: string,
  currentSelectedUUID: string,
  currentSelectedAbsolutePointIndices: Set<number>,
}

class App extends React.Component<Props, State> {

  static readonly NUM_POINTS_PER_SET = 100;
  static readonly NUM_SETS = 5;
  static readonly INTERSECTION_EVENT = 'INTERSECTION_EVENT';
  static readonly POINT_MESH_SCALE_DEFAULT = 1.5;
  static readonly POINT_MESH_SCALE_HIGHLIGHTED = App.POINT_MESH_SCALE_DEFAULT * 3;
  static readonly RAW_UINT8_ELEMENTS_FOR_XYZ_FLOATS = 12;
  static readonly RAW_UINT8_ELEMENTS_FOR_XYZ_FLOAT_POINTS = 3;
  static readonly RAW_UINT8_ELEMENTS_FOR_XYZ_FLOAT = App.RAW_UINT8_ELEMENTS_FOR_XYZ_FLOATS / App.RAW_UINT8_ELEMENTS_FOR_XYZ_FLOAT_POINTS;
  static readonly RAW_UINT8_ELEMENTS_FOR_XYZ_FLOAT_BUFFER = new ArrayBuffer(App.RAW_UINT8_ELEMENTS_FOR_XYZ_FLOAT);
  static readonly RAW_UINT8_ELEMENTS_FOR_XYZ_FLOAT_BUFFER_VIEW = new DataView(App.RAW_UINT8_ELEMENTS_FOR_XYZ_FLOAT_BUFFER);

  private canvasRef = React.createRef<HTMLDivElement>(); // adds canvas to React component
  private tooltipRef = React.createRef<HTMLDivElement>();

  idleTimer : IdleTimer | null;
  idleTimerTimeout: number;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  lights: THREE.DirectionalLight[];
  effect: OutlineEffect;
  animateOnInit: boolean;
  textureLoader: THREE.TextureLoader;
  cubeBackgroundGroup: THREE.Object3D;
  cubePointStyledGroup: THREE.Object3D;
  isDragging: boolean;
  previousMousePosition: { [key: string]: number };

  constructor(props: Props) {
    super(props);

    this.idleTimer = null;
    this.idleTimerTimeout = 500;

    // const pointSets = Array(App.NUM_SETS);
    // for (let s = 0; s < App.NUM_SETS; s++) {
      // pointSets[s] = this.initializePointClouds(2*s + 5);
      // console.log(`pointSets[${s}] ${JSON.stringify(pointSets[s])}`);
    // }
    // const setColors = randomColor({
    //   count: App.NUM_SETS,
    //   luminosity: 'dark',
    //   hue: 'random',
    //   format: 'rgb',
    // });

    this.state = {
      width: window.innerWidth,
      height: window.innerHeight,
      pointSets: [],
      rawPointSets: [],
      setColors: [],
      idleTimerRemaining: this.idleTimerTimeout,
      idleTimerIsIdle: true,
      idleTimerLastActive: 0,
      idleTimerElapsed: 0,
      tooltipInnerText: "",
      currentSelectedUUID: "",
      currentSelectedAbsolutePointIndices: new Set<number>(),
    };

    // https://reactjs.org/docs/refs-and-the-dom.html
    this.canvasRef = React.createRef();
    this.tooltipRef = React.createRef();

    // https://threejs.org/docs/#api/en/scenes/Scene
    this.scene = new THREE.Scene();

    // https://threejs.org/docs/#api/en/cameras/PerspectiveCamera
    this.camera = new THREE.PerspectiveCamera( 
      45, 
      window.innerWidth / window.innerHeight, 
      1.5, 
      1000 
    );

    // https://threejs.org/docs/#api/en/renderers/WebGLRenderer
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: false,
      precision: "highp",
      powerPreference: "high-performance",
    });

    this.lights = Array(3).fill(new THREE.DirectionalLight(0xaabbff, 2));

    // Global effect
    this.effect = new OutlineEffect(this.renderer, { 
      defaultThickness: 0.0015, 
      defaultColor: [0, 0, 0], 
      defaultAlpha: 0.1 
    });

    this.animateOnInit = false;

    this.textureLoader = new THREE.TextureLoader();

    this.isDragging = false;

    this.previousMousePosition = {
      x: 0,
      y: 0,
    };

    this.cubeBackgroundGroup = new THREE.Object3D();
    this.cubePointStyledGroup = new THREE.Object3D();
  }

  async componentDidMount(): Promise<void> {
    const self = this;
    // this.initializeScene();
    window.addEventListener('resize', this.handleResize);
    if (this.idleTimer) {
      this.setState({
        idleTimerRemaining: this.idleTimer.getRemainingTime(),
        idleTimerLastActive: this.idleTimer.getLastActiveTime(),
        idleTimerElapsed: this.idleTimer.getElapsedTime(),
      });
      setInterval(() => {
        if (this.idleTimer) {
          this.setState({
            idleTimerRemaining: this.idleTimer.getRemainingTime(),
            idleTimerLastActive: this.idleTimer.getLastActiveTime(),
            idleTimerElapsed: this.idleTimer.getElapsedTime(),
          });
        }
      }, 100);
    }
    PubSub.subscribe(App.INTERSECTION_EVENT, this.handleIntersectionEvent);

    //
    // h5wasm
    //

    await fetch("https://somebits.io/data_samples1000.h5")
      .then(function(response) {
        return response.arrayBuffer()
      })
      .then(function(buffer) {
        const containerKey = "wxi5d0tv"; // will change with different container!
        hdf5.FS.writeFile("data.h5", new Uint8Array(buffer));
        const f = new hdf5.File("data.h5", "r");
        console.log(`f.keys ${JSON.stringify(f.keys())}`);
        const data = f.get('data') as hdf5.Group;
        console.log(`data.attrs ${JSON.stringify(data.attrs)}`);
        console.log(`data.keys ${JSON.stringify(data.keys())}`);
        const dataGroup = data.get(containerKey) as hdf5.Dataset;
        const dataSlice : any[] = dataGroup.slice([[0, ]]);
        // console.log(`dataSlice ${JSON.stringify(dataSlice)}`);

        const arrayColumn = (arr : Array<any>, n : number) => arr.map((x : any) => x[n] as any);
        const dataPoints = arrayColumn(dataSlice, 0);
        const dataPointClouds = arrayColumn(dataSlice, 1);
        const dataPointSets = Array(dataPointClouds.length);
        const rawPoints = Array(dataPointClouds.length);
        const rawDataPointSets = Array(dataPointClouds.length);
        let maxX = Number.MIN_VALUE;
        let minX = Number.MAX_VALUE;
        let maxY = Number.MIN_VALUE;
        let minY = Number.MAX_VALUE;
        let maxZ = Number.MIN_VALUE;
        let minZ = Number.MAX_VALUE;
        for (let s = 0; s < dataPointClouds.length; s++) {
          const rawPoint = {
            x: dataPoints[s][0],
            y: dataPoints[s][1],
            z: dataPoints[s][2],
          };
          rawPoints[s] = rawPoint;
          rawDataPointSets[s] = rawPoint;
          maxX = (dataPoints[s][0] > maxX) ? dataPoints[s][0] : maxX;
          minX = (dataPoints[s][0] < minX) ? dataPoints[s][0] : minX;
          maxY = (dataPoints[s][1] > maxY) ? dataPoints[s][1] : maxY;
          minY = (dataPoints[s][1] < minY) ? dataPoints[s][1] : minY;
          maxZ = (dataPoints[s][2] > maxZ) ? dataPoints[s][2] : maxZ;
          minZ = (dataPoints[s][2] < minZ) ? dataPoints[s][2] : minZ;
        }
        const scale = 0;
        const normalize = (val: number, max: number, min: number) : number => { return (val - min) / (max - min); }
        maxX += scale * maxX;
        minX -= Math.abs(scale * minX);
        maxY += scale * maxY;
        minY -= Math.abs(scale * minY);
        maxZ += scale * maxZ;
        minZ -= Math.abs(scale * minZ);
        for (let i = 0; i < dataPointClouds.length; i++) {
          const rawPoint = rawPoints[i];
          const normalizedPoint = {
            x: normalize(rawPoint.x, minX, maxX) - 0.5,
            y: normalize(rawPoint.y, minY, maxY) - 0.5,
            z: normalize(rawPoint.z, minZ, maxZ) - 0.5,
          };
          dataPointSets[i] = [normalizedPoint];
        }

        const metadata = f.get('metadata') as hdf5.Group;
        // console.log(`metadata.keys ${JSON.stringify(metadata.keys())}`);
        const groups = metadata.get('groups') as hdf5.Group;
        const group = groups.get(containerKey) as hdf5.Group;
        // console.log(`metadata.groups[containerKey].attrs ${JSON.stringify(group.attrs)}`);
        const groupLabels = group.get('labels') as hdf5.Dataset;
        const rgbaLabelTuples = groupLabels.slice([[0, ]]) as [];
        // console.log(`rgbaLabelTuples ${JSON.stringify(rgbaLabelTuples)}`);
        const rgba = arrayColumn(rgbaLabelTuples, 0);
        // console.log(`rgba ${JSON.stringify(rgba)}`);
        const pointSetColors = Array(dataPointSets.length);
        const backgroundRed = 0;
        const backgroundGreen = 0;
        const backgroundBlue = 0;
        for (let i = 0; i < dataPointClouds.length; i++) {
          const alpha = 1 - rgba[i][3];
          const red = Math.round((rgba[i][3] * (rgba[i][0] / 255) + (alpha * (backgroundRed / 255)))); // rgba[i][0];
          const green = Math.round((rgba[i][3] * (rgba[i][1] / 255) + (alpha * (backgroundGreen / 255)))); // rgba[i][1];
          const blue = Math.round((rgba[i][3] * (rgba[i][2] / 255) + (alpha * (backgroundBlue / 255)))); // rgba[i][2];
          pointSetColors[i] = `rgb(${red}, ${green}, ${blue})`; // alpha component scales rgb
        }
        // console.log(`pointSetColors ${JSON.stringify(pointSetColors)}`);

        self.setState({
          pointSets: dataPointSets,
          rawPointSets: rawDataPointSets,
          setColors: pointSetColors,
        }, () => {
          self.initializeScene();
        });
      })
      .catch(err => {
        console.log(`err ${err}`);
      });
  }

  public componentWillUnmount() {
    PubSub.unsubscribe(App.INTERSECTION_EVENT);
  }

  public initializePointClouds = (scale: number) : any => {
    let rawPoints = [];
    let normalizedPoints = [];
    const muX = Math.random() - 0.5;
    const muY = Math.random() - 0.5;
    const muZ = Math.random() - 0.5;
    const meanVector = [muX, muY, muZ];
    const covA = 0.9;
    const covB = 0.25;
    const covC = Math.random() - 0.5;
    const covarianceMatrix = [
      [ covA, covB, covC ],
      [ covB, covA, covB ],
      [ covC, covB, covA ],
    ];
    let maxX = Number.MIN_VALUE;
    let minX = Number.MAX_VALUE;
    let maxY = Number.MIN_VALUE;
    let minY = Number.MAX_VALUE;
    let maxZ = Number.MIN_VALUE;
    let minZ = Number.MAX_VALUE;
    const multivariateDistribution = MultivariateNormal(meanVector, covarianceMatrix);
    for (let i = 0; i < App.NUM_POINTS_PER_SET; i++) {
      const sample = multivariateDistribution.sample();
      rawPoints.push({
        x: sample[0],
        y: sample[1],
        z: sample[2],
      });
      maxX = (sample[0] > maxX) ? sample[0] : maxX;
      minX = (sample[0] < minX) ? sample[0] : minX;
      maxY = (sample[1] > maxY) ? sample[1] : maxY;
      minY = (sample[1] < minY) ? sample[1] : minY;
      maxZ = (sample[2] > maxZ) ? sample[2] : maxZ;
      minZ = (sample[2] < minZ) ? sample[2] : minZ;
    }
    const normalize = (val: number, max: number, min: number) : number => { return (val - min) / (max - min); }
    maxX += scale * maxX * Math.random();
    minX -= Math.abs(scale * minX * Math.random());
    maxY += scale * maxY * Math.random();
    minY -= Math.abs(scale * minY * Math.random());
    maxZ += scale * maxZ * Math.random();
    minZ -= Math.abs(scale * minZ * Math.random());
    for (let i = 0; i < App.NUM_POINTS_PER_SET; i++) {
      const rawPoint = rawPoints[i];
      normalizedPoints.push({
        x: normalize(rawPoint.x, minX, maxX) - 0.5,
        y: normalize(rawPoint.y, minY, maxY) - 0.5,
        z: normalize(rawPoint.z, minZ, maxZ) - 0.5,
      });
    }
    // console.log(`normalizedPoints ${JSON.stringify(normalizedPoints)}`);
    return normalizedPoints;
  }

  public initializeScene = () => {
    if (WEBGL.isWebGL2Available() === false) {
      document.body.appendChild(WEBGL.getWebGL2ErrorMessage());
      return;
    }

    let camera = this.camera;
    camera.position.set(
      2, 
      1.5, 
      2.5
    );
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    let scene = this.scene;
    scene.background = new THREE.Color(
      0,
      0,
      0
    );

    let firstLight = this.lights[0];
    firstLight.position.x = 100;
    firstLight.position.y = 100;
    firstLight.position.z = -100;
    scene.add(firstLight);

    this.initializeCubeBackgroundGroup(scene);
    this.initializeCubePointStyledGroup(scene);

    scene.add(new THREE.AmbientLight(0x111111));

    let renderer = this.renderer;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    this.canvasRef.current?.appendChild(renderer.domElement); // (this.canvasRef as any).appendChild(renderer.domElement);

    let effect = this.effect;
    let cubeBackgroundGroup = this.cubeBackgroundGroup;
    let cubePointStyledGroup = this.cubePointStyledGroup;
    if (this.animateOnInit) {
      let animate = function () {
        requestAnimationFrame(animate);
        cubeBackgroundGroup.rotation.x += 0.01;
        cubeBackgroundGroup.rotation.y += 0.01;
        cubePointStyledGroup.rotation.x += 0.01;
        cubePointStyledGroup.rotation.y += 0.01;
        effect.render(scene, camera);
      };
      animate();
    }
    else {
      setTimeout(() => {
        effect.render(scene, camera);
      }, 1000);
    }
  }

  public renderScene = () => {
    let effect = this.effect;
    let scene = this.scene;
    let camera = this.camera;
    effect.render(scene, camera);
  }

  public handleResize = debounce((event: UIEvent): any => {
    this.setState({
      width: window.innerWidth,
      height: window.innerHeight
    }, () => {
      console.log(`${this.state.width} X ${this.state.height}`);
      this.updateCameraDimensions();
      this.renderScene();
    });
  }, 1000);

  public updateCameraDimensions = () => {
    let camera = this.camera;
    let effect = this.effect;
    camera.aspect = this.state.width / this.state.height;
    camera.updateProjectionMatrix();
    effect.setSize(this.state.width, this.state.height);
  }

  public initializeCubeBackgroundGroup = (scene: THREE.Scene) : void => {
    let cubeBackgroundGroup = this.cubeBackgroundGroup;

    // Bounding cube faces
    const boundingCubePadding = {
      xMin: 0.075,
      xMax: 0.075,
      yMin: 0.075,
      yMax: 0.075,
      zMin: 0.075,
      zMax: 0.075,
    }
    const edgePadding = 0.001;
    const boundingCubeGeometry = new THREE.BoxGeometry(
      1 + boundingCubePadding.xMin + boundingCubePadding.xMax + edgePadding, 
      1 + boundingCubePadding.yMin + boundingCubePadding.yMax + edgePadding, 
      1 + boundingCubePadding.zMin + boundingCubePadding.zMax + edgePadding
    );
    const boundingCubeMaterialColor = 0xe7e7e7;
    const boundingCubeMaterial = new THREE.MeshBasicMaterial({color: boundingCubeMaterialColor, transparent: true, opacity: 0.125, side: THREE.FrontSide});
    boundingCubeMaterial.userData.outlineParameters = {
      thickness: 0.0,
      color: [0, 0, 0],
      alpha: 1,
      visible: false,
      keepAlive: false
    };
    const boundingCubeMaterials = Array(12).fill(boundingCubeMaterial);
    const boundingCube = new THREE.Mesh(boundingCubeGeometry, boundingCubeMaterials);
    for (let idx = 0; idx < boundingCube.geometry.faces.length; idx++) {
      boundingCube.geometry.faces[idx].materialIndex = idx;
    }
    cubeBackgroundGroup.add(boundingCube);

    // Bounding cube edges
    const boundingCubeEdges = new Array(6);
    for (let cubeEdgeIndex = 0; cubeEdgeIndex < boundingCubeEdges.length; cubeEdgeIndex++) {
      const cubeEdgeGeometry = new THREE.Geometry();
      let cubeEdgeColor = 0x999999;
      switch (cubeEdgeIndex % boundingCubeEdges.length) {
        case 0:
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin, -0.5 - boundingCubePadding.yMin,  0.5 + boundingCubePadding.zMax));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3( 0.5 + boundingCubePadding.xMax, -0.5 - boundingCubePadding.yMin,  0.5 + boundingCubePadding.zMax));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3( 0.5 + boundingCubePadding.xMax, -0.5 - boundingCubePadding.yMin, -0.5 - boundingCubePadding.zMin));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin, -0.5 - boundingCubePadding.yMin, -0.5 - boundingCubePadding.zMin));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin, -0.5 - boundingCubePadding.yMin,  0.5 + boundingCubePadding.zMax));
          break;
        case 1:
          cubeEdgeGeometry.vertices.push(new THREE.Vector3( 0.5 + boundingCubePadding.xMax,  0.5 + boundingCubePadding.yMax, -0.5 - boundingCubePadding.zMin));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin,  0.5 + boundingCubePadding.yMax, -0.5 - boundingCubePadding.zMin));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin,  0.5 + boundingCubePadding.yMax,  0.5 + boundingCubePadding.zMax));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3( 0.5 + boundingCubePadding.xMax,  0.5 + boundingCubePadding.yMax,  0.5 + boundingCubePadding.zMax));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3( 0.5 + boundingCubePadding.xMax,  0.5 + boundingCubePadding.yMax, -0.5 - boundingCubePadding.zMin));
          break;
        case 2:
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin,  0.5 + boundingCubePadding.yMax,  0.5 + boundingCubePadding.zMax));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin, -0.5 - boundingCubePadding.yMin,  0.5 + boundingCubePadding.zMax));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin, -0.5 - boundingCubePadding.yMin, -0.5 - boundingCubePadding.zMin));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin,  0.5 + boundingCubePadding.yMax, -0.5 - boundingCubePadding.zMin));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin,  0.5 + boundingCubePadding.yMax,  0.5 + boundingCubePadding.zMax));
          break;
        case 3:
          cubeEdgeGeometry.vertices.push(new THREE.Vector3( 0.5 + boundingCubePadding.xMax,  0.5 + boundingCubePadding.yMax, -0.5 - boundingCubePadding.zMin));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3( 0.5 + boundingCubePadding.xMax, -0.5 - boundingCubePadding.yMin, -0.5 - boundingCubePadding.zMin));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3( 0.5 + boundingCubePadding.xMax, -0.5 - boundingCubePadding.yMin,  0.5 + boundingCubePadding.zMax));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3( 0.5 + boundingCubePadding.xMax,  0.5 + boundingCubePadding.yMax,  0.5 + boundingCubePadding.zMax));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3( 0.5 + boundingCubePadding.xMax,  0.5 + boundingCubePadding.yMax, -0.5 - boundingCubePadding.zMin));
          break;
        case 4:
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin,  0.5 + boundingCubePadding.yMax,  0.5 + boundingCubePadding.zMax));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3( 0.5 + boundingCubePadding.xMax,  0.5 + boundingCubePadding.yMax,  0.5 + boundingCubePadding.zMax));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3( 0.5 + boundingCubePadding.xMax, -0.5 - boundingCubePadding.yMin,  0.5 + boundingCubePadding.zMax));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin, -0.5 - boundingCubePadding.yMin,  0.5 + boundingCubePadding.zMax));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin,  0.5 + boundingCubePadding.yMax,  0.5 + boundingCubePadding.zMax));
          break;
        case 5:
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin,  0.5 + boundingCubePadding.yMax, -0.5 - boundingCubePadding.zMin));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3( 0.5 + boundingCubePadding.xMax,  0.5 + boundingCubePadding.yMax, -0.5 - boundingCubePadding.zMin));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3( 0.5 + boundingCubePadding.xMax, -0.5 - boundingCubePadding.yMin, -0.5 - boundingCubePadding.zMin));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin, -0.5 - boundingCubePadding.yMin, -0.5 - boundingCubePadding.zMin));
          cubeEdgeGeometry.vertices.push(new THREE.Vector3(-0.5 - boundingCubePadding.xMin,  0.5 + boundingCubePadding.yMax, -0.5 - boundingCubePadding.zMin));
          break;
      }
      const boundingCubeEdgeMaterial = new THREE.LineBasicMaterial({
        color: cubeEdgeColor as number, 
        opacity: 1, 
        linewidth: 3
      });
      const boundingCubeEdge = new THREE.Line(cubeEdgeGeometry, boundingCubeEdgeMaterial);
      boundingCubeEdges[cubeEdgeIndex] = boundingCubeEdge;
      cubeBackgroundGroup.add(boundingCubeEdge);
    }

    const axisLineMaterial = new THREE.LineBasicMaterial({
      color: 0xff0000,
      linewidth: 1,
      opacity: 1,
    });
    const axisLineGeometry = new THREE.Geometry();
    axisLineGeometry.vertices.push(
      new THREE.Vector3( -0.5 - boundingCubePadding.xMin, -0.5 - boundingCubePadding.yMin,  0 ),
      new THREE.Vector3(  0.5 + boundingCubePadding.xMax, -0.5 - boundingCubePadding.yMin,  0 ),
    );
    const axisLine = new THREE.Line(axisLineGeometry, axisLineMaterial);
    cubeBackgroundGroup.add(axisLine);

    scene.add(cubeBackgroundGroup);
  }

  public initializeCubePointStyledGroup = (scene: THREE.Scene) : void => {
    let cubePointStyledGroup = this.cubePointStyledGroup;
    
    const eighteenTone = this.textureLoader.load('eighteenTone.png', () => {
      eighteenTone.minFilter = THREE.NearestFilter;
      eighteenTone.magFilter = THREE.NearestFilter;
      eighteenTone.generateMipmaps = false;
      let geometry = new THREE.SphereBufferGeometry(
        0.0075, 
        32, 
        32
      );
      let a = 0;
      for (let s = 0; s < this.state.pointSets.length; s++) {
        // https://threejs.org/docs/#api/en/materials/MeshToonMaterial
        let material = new THREE.MeshToonMaterial( {
          color: this.state.setColors[s],
          gradientMap: eighteenTone,
          dithering: true,
        });
        for (let i = 0; i < 1; i++) {
          let point = this.state.pointSets[s][i];
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.x = point.x;
          mesh.position.y = point.y;
          mesh.position.z = point.z;
          mesh.scale.setScalar(App.POINT_MESH_SCALE_DEFAULT);
          const userData = {
            "setIndex": s,
            "pointIndex": i,
            "absolutePointIndex": a,
            "position": point
          };
          mesh.userData = userData;
          cubePointStyledGroup.add(mesh);
          a++;
        }
      }
    });

    scene.add(cubePointStyledGroup);
  }

  public addHighlightToPointByIndex = (absolutePointIndex: number) : void => {
    //console.log(`addHighlightToPointByIndex ${absolutePointIndex}`);
    const pointObject = this.cubePointStyledGroup.children[absolutePointIndex];
    pointObject.scale.set(
      App.POINT_MESH_SCALE_HIGHLIGHTED, 
      App.POINT_MESH_SCALE_HIGHLIGHTED, 
      App.POINT_MESH_SCALE_HIGHLIGHTED
    );
    this.renderScene();
  }

  public removeHighlightFromPointByIndex = (absolutePointIndex: number) : void => {
    //console.log(`removeHighlightFromPointByIndex ${absolutePointIndex}`);
    if (absolutePointIndex === -1) return;
    const pointObject = this.cubePointStyledGroup.children[absolutePointIndex];
    pointObject.scale.set(
      App.POINT_MESH_SCALE_DEFAULT, 
      App.POINT_MESH_SCALE_DEFAULT, 
      App.POINT_MESH_SCALE_DEFAULT
    );
  }

  public removeHighlightFromPoints = (): void => {
    // console.log(`removeHighlightFromPoints | ${this.state.currentSelectedAbsolutePointIndices.size}`);
    if (this.state.currentSelectedAbsolutePointIndices.size === 0) return;
    const currentSelectedAbsolutePointIndices = Array.from(this.state.currentSelectedAbsolutePointIndices.values());
    for (
      let index = 0;
      index < this.state.currentSelectedAbsolutePointIndices.size;
      index += 1
    ) {
      this.removeHighlightFromPointByIndex(currentSelectedAbsolutePointIndices[index]);
    }
    this.setState({
      currentSelectedAbsolutePointIndices: new Set<number>(),
    }, () => {
      this.renderScene();
    })
  };

  public handleIntersectionEvent = (msg: string, data: any) : void => {
    // console.log(`handleIntersectionEvent ${msg} ${JSON.stringify(data, null, 2)}`);
    const tooltipRef = this.tooltipRef.current;
    if (tooltipRef) {
      const setIndex = data.userData.setIndex;
      const absolutePointIndex = data.userData.absolutePointIndex;
      const uuid = data.uuid;
      // console.log(`this.state.rawPointSets[${setIndex}] ${JSON.stringify(this.state.rawPointSets[setIndex])}`);
      const x = this.state.rawPointSets[setIndex].x.toPrecision(3);
      const y = this.state.rawPointSets[setIndex].y.toPrecision(3);
      const z = this.state.rawPointSets[setIndex].z.toPrecision(3);
      // highlight and show tooltip
      if (!this.state.currentSelectedAbsolutePointIndices.has(absolutePointIndex)) {
        const newCurrentSelectedAbsolutePointIndices = new Set(this.state.currentSelectedAbsolutePointIndices).add(absolutePointIndex);
        this.setState({
          currentSelectedAbsolutePointIndices: newCurrentSelectedAbsolutePointIndices,
          currentSelectedUUID: uuid,
          tooltipInnerText: `<span>x ${x}<br/>y ${y}<br/>z ${z}</span>`,
        }, () => {
          this.addHighlightToPointByIndex(absolutePointIndex);
          tooltipRef.style.top = `${data.viewportOffsetY - 10}px`;
          tooltipRef.style.left = `${data.viewportOffsetX - 10}px`;
          ReactTooltip.show(tooltipRef);
        });
      }
    }
  }

  public handleMouseEvent = (event: React.MouseEvent<Element>) : void => {
    const canvasRef = this.canvasRef.current;
    const tooltipRef = this.tooltipRef.current;
    switch (event.type) {
      case "mousedown":
        this.isDragging = true;
        // this.cubePointStyledGroup.visible = false;
        break;
      case "mousemove":
        // test intersections and adjust pointer class
        let mouse = new THREE.Vector2();
        mouse.x = (event.nativeEvent.offsetX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.nativeEvent.offsetY / window.innerHeight) * 2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);
        const intersects = raycaster.intersectObject(this.cubePointStyledGroup, true);
        if (canvasRef && tooltipRef) {
          if (intersects.length > 0 && !this.isDragging) {
            canvasRef.style.cursor = "pointer";
            const intersectedPoint = intersects[0].object;
            const uuid = intersectedPoint.uuid;
            const userData = intersectedPoint.userData;
            // console.log(`uuid ${uuid} vs ${this.state.currentSelectedUUID}`);
            if (uuid !== this.state.currentSelectedUUID) {
              this.removeHighlightFromPoints();
            }
            // console.log(`intersects ${JSON.stringify(intersectedPoint, null, 2)}`);
            PubSub.publish(App.INTERSECTION_EVENT, {
              uuid: uuid,
              userData: userData,
              viewportOffsetX: event.nativeEvent.offsetX,
              viewportOffsetY: event.nativeEvent.offsetY
            });
          }
          else if (!this.isDragging) {
            canvasRef.style.cursor = "grab";
            this.removeHighlightFromPoints();
            ReactTooltip.hide(tooltipRef);
          }
          else {
            canvasRef.style.cursor = "grabbing";
            this.removeHighlightFromPoints();
            ReactTooltip.hide(tooltipRef);
          }
        }
        // rotate cube, leaving the camera where it is
        let deltaMove = {
          x: event.nativeEvent.offsetX - this.previousMousePosition.x,
          y: event.nativeEvent.offsetY - this.previousMousePosition.y,
        };
        if (this.isDragging) {
          let deltaRotationQuaternion = new THREE.Quaternion();
          deltaRotationQuaternion.setFromEuler(new THREE.Euler(this.toRadians(deltaMove.y * 1), this.toRadians(deltaMove.x * 1), 0, 'XYZ'));
          this.cubeBackgroundGroup.quaternion.multiplyQuaternions(deltaRotationQuaternion, this.cubeBackgroundGroup.quaternion);
          this.cubePointStyledGroup.quaternion.multiplyQuaternions(deltaRotationQuaternion, this.cubePointStyledGroup.quaternion);
          this.renderScene();
        }
        this.previousMousePosition = {
          x: event.nativeEvent.offsetX,
          y: event.nativeEvent.offsetY,
        };
        break;
      case "mouseup":
        this.isDragging = false;
        // this.cubePointStyledGroup.visible = true;
        this.renderScene();
        break;
      default:
        break;
    }
  }

  public toRadians = (angle: number) : number => { return angle * Math.PI / 180; }
  public toDegrees = (angle: number) : number => { return angle * 180 / Math.PI; }

  public handleWheelEvent = (event: React.WheelEvent<Element>) : void => {
    const canvasRef = this.canvasRef.current;
    switch (event.type) {
      case "mousewheel":
      case "wheel":
        const wheelDelta = {
          x: 0,
          y: 0,
          z: 0,
        };
        wheelDelta.x += event.nativeEvent.deltaX;
        wheelDelta.y += event.nativeEvent.deltaY;
        wheelDelta.z += event.nativeEvent.deltaZ;
        if (canvasRef) {
          if ((wheelDelta.x > 0) || (wheelDelta.y > 0) || (wheelDelta.z > 0)) {
            //this.cubePointStyledGroup.visible = false;
            canvasRef.style.cursor = "zoom-out";
            this.camera.zoom /= 1.05;
          }
          else if ((wheelDelta.x < 0) || (wheelDelta.y < 0) || (wheelDelta.z < 0)) {
            //this.cubePointStyledGroup.visible = false;
            canvasRef.style.cursor = "zoom-in";
            this.camera.zoom *= 1.05;
          }
        }
        this.camera.updateProjectionMatrix();
        this.renderScene();
        break;
      default:
        break;
    }
  }

  // IdleTimer event handlers
  public handleIdleTimerOnActive = () => { this.setState({ idleTimerIsIdle: false }); }
  public handleIdleTimerOnIdle = () => { 
    this.setState({ idleTimerIsIdle: true }, () => {
      if (this.canvasRef && this.canvasRef.current) {
        this.canvasRef.current.dispatchEvent(new Event("mousemove", {}));
        //this.cubePointStyledGroup.visible = true;
        //this.renderScene();
      }
    }); 
  }
  public handleIdleTimerReset = () => { if (this.idleTimer) this.idleTimer.reset(); }
  public handleIdleTimerPause = () => { if (this.idleTimer) this.idleTimer.pause(); }
  public handleIdleTimerResume = () => { if (this.idleTimer) this.idleTimer.resume(); }

  public render() {
    return (
      <div>
        
        {/* reset any in-progress mouse events, after inactivity */}
        <IdleTimer
          ref={(ref : any) => { this.idleTimer = ref }}
          onActive={this.handleIdleTimerOnActive}
          onIdle={this.handleIdleTimerOnIdle}
          timeout={this.idleTimerTimeout} />

        {/* canvas */}
        <div 
          ref={this.canvasRef}
          onMouseDown={this.handleMouseEvent} 
          onMouseMove={this.handleMouseEvent} 
          onMouseUp={this.handleMouseEvent}
          onWheel={this.handleWheelEvent}>

          {/* make tooltip a child of parent canvas, so that mouse events bubble up */}
          <div 
            ref={this.tooltipRef}
            onClick={(e) => e.preventDefault()}
            data-tip 
            data-for="pointTooltip"
            style={{
              cursor: "pointer",
              position: "absolute",
              width: "20px",
              height: "20px",
              pointerEvents: "none",
            }}>&nbsp;</div>
          <ReactTooltip 
            id="pointTooltip" 
            effect="solid"
            type="light">
            <div dangerouslySetInnerHTML={{__html: this.state.tooltipInnerText}} />
          </ReactTooltip>
        </div>

      </div>
    );
  }
}

export default App;
