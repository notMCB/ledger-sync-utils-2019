// The enhanced lighting pass: the town rendered to an off-screen buffer, then
// ground-truth ambient occlusion (corners and contact points darken the way
// bounced light says they should), a touch of bloom off the bright things,
// filmic tone mapping, and multisampled edges. Not ray tracing, which no
// browser game can do at speed, but the look of it. Off in Souk Royale, whose
// map is too big to pay for it.

import * as THREE from 'three';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from '../vendor/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';

export class Lighting {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = 'on';
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const w = Math.max(2, Math.round(size.x * pr)), h = Math.max(2, Math.round(size.y * pr));
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);
    this.renderPass = new RenderPass(scene, camera);
    this.renderPass.clear = true;
    this.gtao = new GTAOPass(scene, camera, w, h);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 1.0;
    this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.2, thickness: 1.0, scale: 1.1, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 12 });
    // smoke, flashes, glass and the like must not throw occlusion: hide them for the normal pass
    const gtaoRender = this.gtao.render.bind(this.gtao);
    const hidden = [];
    this.gtao.render = (r, write, read, dt, mask) => {
      hidden.length = 0;
      scene.traverse((o) => {
        if (!o.visible) return;
        const m = o.material;
        if (o.isSprite || o.isLine || o.isPoints || (m && (m.transparent || m.depthWrite === false))) { o.visible = false; hidden.push(o); }
      });
      this.normalsOnly = true;
      try { gtaoRender(r, write, read, dt, mask); } finally {
        for (const o of hidden) o.visible = true;
        this.normalsOnly = false;
      }
    };
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.55, 0.92);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.gtao);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
  }

  setSize(cssW, cssH, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(cssW, cssH);
    // the occlusion at half size on 'half': the blend scales it back up
    if (this.quality === 'half') this.gtao.setSize(Math.round(cssW * pixelRatio / 2), Math.round(cssH * pixelRatio / 2));
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    const size = this.renderer.getSize(new THREE.Vector2());
    this.setSize(size.x, size.y, this.renderer.getPixelRatio());
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
    this.gtao.dispose();
    this.bloom.dispose();
  }
}
