import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { OBJLoader } from './vendor/OBJLoader.js';
import { MTLLoader } from './vendor/MTLLoader.js';

const SCALE = .02;
const ground = (x,y) => -1.2+.002*y+3*(1-Math.exp(-Math.pow((x-(1200+120*Math.sin(y/400)))/160,2)));
const pos = (x,y,z=ground(x,y)) => new THREE.Vector3((x-1200)*SCALE,z*.3,(y-1000)*SCALE);

export class LiveMap {
  constructor(host, city, mesh, mode='3d') {
    this.host=host; this.city=city; this.mesh=mesh; this.mode=mode;
    this.layers={flood:true, roads:true, routes:true, agents:true, facilities:true, resources:true};
    this.nodes=Object.fromEntries(city.nodes.map(n=>[n.id,n]));
    this.disposed=false;
    if(mode==='3d') this.init3D(); else this.init2D();
  }
  init3D() {
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color('#080e17');
    this.camera=new THREE.PerspectiveCamera(45,1,.1,250);
    this.camera.position.set(32,44,42);
    this.renderer=new THREE.WebGLRenderer({antialias:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.host.replaceChildren(this.renderer.domElement);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.maxPolarAngle=Math.PI*.48; this.controls.minDistance=10; this.controls.maxDistance=100;
    this.scene.add(new THREE.HemisphereLight(0xe3efff,0x324133,2));
    const sun=new THREE.DirectionalLight(0xffffff,2); sun.position.set(20,40,15); this.scene.add(sun);
    const terrain=[];
    this.mesh.triangles.forEach((triangle,i)=>triangle.forEach((v,j)=>{
      const p=this.mesh.vertices[v]; const q=pos(p[0],p[1],this.mesh.vertex_bed_m[i][j]); terrain.push(q.x,q.y,q.z);
    }));
    const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(terrain,3)); geo.computeVertexNormals();
    this.scene.add(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x293b38,side:THREE.DoubleSide,roughness:1})));
    this.dynamic=new THREE.Group(); this.scene.add(this.dynamic);
    this.assets=new THREE.Group(); this.scene.add(this.assets);
    this.loadModels();
    this.resize=new ResizeObserver(()=>{
      const w=this.host.clientWidth,h=this.host.clientHeight;
      this.renderer.setSize(w,h); this.camera.aspect=w/Math.max(1,h);this.camera.updateProjectionMatrix();
    });this.resize.observe(this.host);
    const frame=()=>{if(this.disposed)return;this.controls.update();this.renderer.render(this.scene,this.camera);this.raf=requestAnimationFrame(frame);};frame();
  }
  async loadModels() {
    try {
      const base='/assets/riverton-obj-assets/';
      const materials=await new MTLLoader().loadAsync(base+'riverton.mtl');materials.preload();
      const loader=new OBJLoader().setMaterials(materials);
      const names=['emergency-shelter.obj','hospital.obj','row-house.obj','ambulance.obj','rescue-boat.obj'];
      const models=await Promise.all(names.map(n=>loader.loadAsync(base+n)));
      if(this.disposed)return;
      this.models=models;
      for(const building of this.city.buildings||[]) this.placeModel(models[2],building.x,building.y,.7);
      for(const f of this.city.facilities) {
        if(f.kind==='depot')continue;
        const object=this.placeModel(models[f.kind==='hospital'?1:0],f.x,f.y,2);
        object.userData.facility=true;
      }
      if(this.snapshot)this.update(this.snapshot,this.field);
    } catch(error) {
      if(!this.disposed) this.host.dispatchEvent(new CustomEvent('map-error',{detail:`OBJ assets unavailable: ${error.message}`}));
    }
  }
  placeModel(source,x,y,size) {
    const model=source.clone(true);
    const box=new THREE.Box3().setFromObject(model), dimensions=box.getSize(new THREE.Vector3());
    const scale=size/Math.max(dimensions.x,dimensions.z,1);
    model.scale.setScalar(scale);
    const center=box.getCenter(new THREE.Vector3()), p=pos(x,y);
    model.position.set(p.x-center.x*scale,p.y-box.min.y*scale,p.z-center.z*scale);
    this.assets.add(model);return model;
  }
  init2D() {
    const ns='http://www.w3.org/2000/svg';
    this.svg=document.createElementNS(ns,'svg');this.svg.setAttribute('viewBox','0 0 2400 2000');
    this.svg.setAttribute('aria-label','Computed Riverton operations map');
    this.host.replaceChildren(this.svg);this.view={x:0,y:0,w:2400,h:2000};
    const apply=()=>this.svg.setAttribute('viewBox',`${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`);
    this.svg.addEventListener('wheel',e=>{
      e.preventDefault();const scale=e.deltaY>0?1.12:.89;
      const w=Math.max(300,Math.min(6000,this.view.w*scale)), ratio=w/this.view.w;
      this.view.x+=(this.view.w-w)/2;this.view.y+=this.view.h*(1-ratio)/2;this.view.w=w;this.view.h*=ratio;apply();
    },{passive:false});
    this.svg.addEventListener('pointerdown',e=>{this.drag={x:e.clientX,y:e.clientY};this.svg.setPointerCapture(e.pointerId);});
    this.svg.addEventListener('pointerup',()=>{this.drag=null;});
    this.svg.addEventListener('pointermove',e=>{
      if(!this.drag)return;
      this.view.x-=(e.clientX-this.drag.x)*this.view.w/this.host.clientWidth;
      this.view.y-=(e.clientY-this.drag.y)*this.view.h/this.host.clientHeight;
      this.drag={x:e.clientX,y:e.clientY};apply();
    });
  }
  update(snapshot,field) {
    if(this.disposed)return;this.snapshot=snapshot;this.field=field;
    if(this.mode==='2d'){this.render2D();return;}
    for(const child of [...this.dynamic.children]) {
      this.dynamic.remove(child);child.geometry?.dispose();child.material?.dispose();
    }
    if(this.layers.flood&&field) {
      const points=[];
      this.mesh.triangles.forEach((tri,i)=>{if(field.depth_m[i]<.01)return;
        tri.forEach(v=>{const p=this.mesh.vertices[v],q=pos(p[0],p[1],field.stage_m[i]+.025);points.push(q.x,q.y,q.z);});
      });
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.computeVertexNormals();
      this.dynamic.add(new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x249fce,transparent:true,opacity:.7,side:THREE.DoubleSide})));
    }
    const closed=new Set(snapshot.roads.filter(r=>r.closed).map(r=>r.id));
    if(this.layers.roads)for(const road of this.city.roads) {
      const points=road.geometry.map(p=>pos(...p,road.deck_elevation_m??ground(...p)+.1));
      this.dynamic.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({color:closed.has(road.id)?0xf06b64:0x9ca9ad})));
    }
    if(this.layers.routes)for(const route of snapshot.routes) {
      const points=route.nodes.map(id=>{const n=this.nodes[id];return pos(n.x,n.y,ground(n.x,n.y)+.25);});
      this.dynamic.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({color:0x34d399})));
    }
    if(this.layers.agents) {
      const points=snapshot.agents.filter(a=>a.state!=='sheltered').flatMap(a=>{const p=pos(a.x,a.y,ground(a.x,a.y)+.5);return[p.x,p.y,p.z];});
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
      this.dynamic.add(new THREE.Points(g,new THREE.PointsMaterial({color:0xffdb8c,size:.2})));
    }
    this.assets.children.filter(o=>o.userData.resource).forEach(o=>this.assets.remove(o));
    if(this.layers.resources&&this.models)for(const r of snapshot.resources) {
      const obj=this.placeModel(this.models[r.kind==='boat'?4:3],r.x,r.y,1);
      obj.userData.resource=true;
    }
    this.assets.children.filter(o=>o.userData.facility).forEach(o=>{o.visible=this.layers.facilities;});
  }
  render2D() {
    const ns='http://www.w3.org/2000/svg';this.svg.replaceChildren();
    const add=(tag,attrs)=>{const e=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);this.svg.append(e);return e;};
    add('rect',{x:0,y:0,width:2400,height:2000,fill:'#293b38'});
    if(this.layers.flood&&this.field)this.mesh.triangles.forEach((tri,i)=>{
      if(this.field.depth_m[i]<.01)return;
      add('polygon',{points:tri.map(v=>this.mesh.vertices[v].join(',')).join(' '),fill:'#249fce',opacity:.7});
    });
    const closed=new Set(this.snapshot.roads.filter(r=>r.closed).map(r=>r.id));
    if(this.layers.roads)this.city.roads.forEach(r=>add('polyline',{points:r.geometry.map(p=>p.join(',')).join(' '),fill:'none',stroke:closed.has(r.id)?'#f06b64':'#9ca9ad','stroke-width':8}));
    if(this.layers.routes)this.snapshot.routes.forEach(r=>add('polyline',{points:r.nodes.map(id=>`${this.nodes[id].x},${this.nodes[id].y}`).join(' '),fill:'none',stroke:'#34d399','stroke-width':5}));
    if(this.layers.facilities)this.city.facilities.forEach(f=>{
      add('rect',{x:f.x-18,y:f.y-18,width:36,height:36,fill:f.kind==='hospital'?'#f06b64':'#34d399'});
      const label=add('text',{x:f.x+24,y:f.y,fill:'white','font-size':30});label.textContent=f.id;
    });
    if(this.layers.agents)this.snapshot.agents.filter(a=>a.state!=='sheltered').forEach(a=>add('circle',{cx:a.x,cy:a.y,r:6,fill:'#ffdb8c'}));
    if(this.layers.resources)this.snapshot.resources.forEach(r=>add('rect',{x:r.x-8,y:r.y-8,width:16,height:16,fill:'#fff'}));
  }
  setLayer(name,value){this.layers[name]=value;if(this.snapshot)this.update(this.snapshot,this.field);}
  reset(){if(this.mode==='3d'){this.camera.position.set(32,44,42);this.controls.target.set(0,0,0);}else{this.view={x:0,y:0,w:2400,h:2000};this.svg.setAttribute('viewBox','0 0 2400 2000');}}
  zoom(factor){if(this.mode==='3d'){this.camera.position.multiplyScalar(factor);}else{this.view.w*=factor;this.view.h*=factor;this.svg.setAttribute('viewBox',`${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`);}}
  pan(x,y){if(this.mode==='3d'){this.camera.position.x+=x;this.camera.position.z+=y;this.controls.target.x+=x;this.controls.target.z+=y;}else{this.view.x+=x*30;this.view.y+=y*30;this.svg.setAttribute('viewBox',`${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`);}}
  dispose(){this.disposed=true;cancelAnimationFrame(this.raf);this.resize?.disconnect();this.controls?.dispose();this.scene?.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});this.renderer?.dispose();}
}
