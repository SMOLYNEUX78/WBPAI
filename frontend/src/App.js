import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useNavigate
} from "react-router-dom";
import BuildingDashboard from "./pages/performance/BuildingDashboard";

const addOutlinedMesh = (geometry, material, parent) => {
  const mesh = new THREE.Mesh(geometry, material);
  parent.add(mesh);
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.7 })
  );
  mesh.add(outline);
  return mesh;
};

const AuditHouseScene = ({ stage }) => {
  const canvasRef = useRef(null);
  const stageRef = useRef(stage);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f5f3);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(8.5, 6.2, 10.5);
    camera.lookAt(0, 1, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd1d5db, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(6, 9, 7);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const house = new THREE.Group();
    house.rotation.y = -0.35;
    scene.add(house);

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.72 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.8 });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.5 });
    const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.18, metalness: 0.08 });
    const verifiedMaterial = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x065f46,
      emissiveIntensity: 0,
      roughness: 0.5,
    });

    const shell = addOutlinedMesh(new THREE.BoxGeometry(5.8, 3.1, 4.2), wallMaterial, house);
    shell.position.y = 1.55;
    shell.castShadow = true;
    shell.receiveShadow = true;

    const roof = addOutlinedMesh(new THREE.ConeGeometry(4.1, 2.15, 4), roofMaterial, house);
    roof.position.y = 4.15;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;

    const door = addOutlinedMesh(new THREE.BoxGeometry(1.05, 2.15, 0.12), darkMaterial, house);
    door.position.set(0.8, 1.08, 2.16);

    [-1.65, 2.05].forEach((x) => {
      const windowMesh = addOutlinedMesh(new THREE.BoxGeometry(1.15, 1.05, 0.13), glassMaterial, house);
      windowMesh.position.set(x, 1.85, 2.17);
    });

    const sideWindow = addOutlinedMesh(new THREE.BoxGeometry(0.13, 1.05, 1.35), glassMaterial, house);
    sideWindow.position.set(-2.96, 1.85, -0.5);

    const chimney = addOutlinedMesh(new THREE.BoxGeometry(0.55, 1.6, 0.65), roofMaterial, house);
    chimney.position.set(1.65, 4.7, -0.45);

    const foundation = new THREE.Mesh(
      new THREE.BoxGeometry(7.3, 0.18, 5.7),
      new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 1 })
    );
    foundation.position.y = -0.16;
    foundation.receiveShadow = true;
    scene.add(foundation);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 18),
      new THREE.MeshStandardMaterial({ color: 0xf4f5f3, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.27;
    ground.receiveShadow = true;
    scene.add(ground);

    const scanMaterial = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const scanPlane = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 6.6), scanMaterial);
    scanPlane.rotation.x = -Math.PI / 2;
    scanPlane.position.y = -0.05;
    scene.add(scanPlane);

    const scanEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(8.4, 6.6)),
      new THREE.LineBasicMaterial({ color: 0x047857, transparent: true, opacity: 0.85 })
    );
    scanEdge.rotation.x = -Math.PI / 2;
    scene.add(scanEdge);

    const evidencePoints = [
      [-2.5, 1.1, 2.5],
      [2.6, 2.4, 1.7],
      [-2.7, 3.7, -1.8],
      [1.8, 4.9, 0.1],
    ].map(([x, y, z]) => {
      const point = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 18), verifiedMaterial.clone());
      point.position.set(x, y, z);
      point.scale.setScalar(0.001);
      scene.add(point);
      return point;
    });

    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      if (!clientWidth || !clientHeight) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      if (camera.aspect < 0.8) {
        camera.position.set(13.5, 8.5, 17.5);
        camera.lookAt(0, 2.2, 0);
      } else {
        camera.position.set(8.5, 6.2, 10.5);
        camera.lookAt(0, 1, 0);
      }
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const clock = new THREE.Clock();
    let frameId;
    const render = () => {
      const elapsed = clock.getElapsedTime();
      const currentStage = stageRef.current;
      house.rotation.y = -0.35 + Math.sin(elapsed * 0.45) * 0.055;

      const scanProgress = Math.min(1, Math.max(0, (elapsed - 0.45) / 1.9));
      const scanY = -0.05 + scanProgress * 5.65;
      scanPlane.position.y = scanY;
      scanEdge.position.y = scanY + 0.006;
      scanPlane.visible = currentStage < 3;
      scanEdge.visible = currentStage < 3;

      evidencePoints.forEach((point, index) => {
        const visible = currentStage >= 2;
        const targetScale = visible ? 1 + Math.sin(elapsed * 3 + index) * 0.08 : 0.001;
        point.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.12);
        point.material.emissiveIntensity = currentStage >= 3 ? 1.2 : 0.35;
      });

      wallMaterial.color.lerp(new THREE.Color(currentStage >= 3 ? 0xd1fae5 : 0xe5e7eb), 0.06);
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      scene.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material?.dispose?.();
      });
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="wbp-audit-canvas" aria-hidden="true" />;
};


const SplashScreen = () => {
  const navigate = useNavigate();
  const [stage, setStage] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const profileTimer = setTimeout(() => setStage(1), 500);
    const identityTimer = setTimeout(() => setStage(2), 1500);
    const completionTimer = setTimeout(() => setStage(3), 2500);
    const exitTimer = setTimeout(() => setFadeOut(true), 3400);
    const navigationTimer = setTimeout(() => navigate("/dashboard/new"), 3900);

    return () => {
      clearTimeout(profileTimer);
      clearTimeout(identityTimer);
      clearTimeout(completionTimer);
      clearTimeout(exitTimer);
      clearTimeout(navigationTimer);
    };
  }, [navigate]);

  return (
    <div
      className={`relative min-h-screen overflow-hidden bg-[#f4f5f3] transition-opacity duration-500 ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      <main className="flex min-h-screen items-center justify-center px-5 py-8 sm:px-10">
        <section className={`wbp-audit-ident stage-${stage}`} aria-label="Whole Build Profile audit scan">
          <div className="wbp-audit-scene">
            <AuditHouseScene stage={stage} />
            <div className="wbp-audit-reticle" aria-hidden="true">
              <span className="wbp-audit-reticle-tl" />
              <span className="wbp-audit-reticle-tr" />
              <span className="wbp-audit-reticle-bl" />
              <span className="wbp-audit-reticle-br" />
            </div>
            <div className="wbp-audit-coordinates" aria-hidden="true">
              <span>52.0945, 1.30488</span>
              <span>WBP-001</span>
            </div>
            <div className="wbp-audit-pass">
              <span className="wbp-audit-check">✓</span>
              <strong>Audit passed</strong>
            </div>
          </div>

          <div className="wbp-audit-copy">
            <div>
              <h1>Whole Build Profile</h1>
              <p>{stage < 2 ? "Scanning building fabric" : stage < 3 ? "Validating monitored evidence" : "Audit evidence verified"}</p>
            </div>
            <span className="wbp-audit-progress">{stage < 1 ? "12" : stage < 2 ? "46" : stage < 3 ? "81" : "100"}%</span>
          </div>

          <div className="wbp-audit-steps" aria-hidden="true">
            {["Fabric", "Energy", "Health", "Evidence"].map((label, index) => (
              <span key={label} className={stage >= Math.min(3, index + 1) ? "is-complete" : ""}>{label}</span>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

const App = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<SplashScreen />} />
        <Route path="/dashboard/*" element={<BuildingDashboard />} />
      </Routes>
    </Router>
  );
};

export default App;
