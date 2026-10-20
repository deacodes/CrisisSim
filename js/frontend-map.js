import * as THREE from './vendor/three.module.js';
import {RivertonThreeMap} from './three-map.js';
import {OBJLoader} from './vendor/OBJLoader.js';
import {MTLLoader} from './vendor/MTLLoader.js';
import {LiveMap} from './live-map.js';

const ground=(x,y)=>-1.2+.002*y+3*(1-Math.exp(-(((x-1200-120*Math.sin(y/400))/160)**2)));
// Metric coordinates; vertical exaggeration is disclosed in the map hint.
const point=(x,y,z=ground(x,y))=>new THREE.Vector3((x-1200)*.025,z*.35,(y-1000)*.025);
const disposeGroup=group=>{
  group?.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else{o.material?.map?.dispose();o.material?.dispose();}});
  group?.clear();
};

class ConnectedThreeMap extends RivertonThreeMap {
  addTerrain() {
    this.city=this.options.city;this.mesh=this.options.mesh;
    this.nodes=Object.fromEntries(this.city.nodes.map(n=>[n.id,n]));
    this.layers={flood:true,roads:true,routes:true,agents:true,facilities:true,resources:true};
    const positions=[];
    if(this.mesh){
      this.mesh.triangles.forEach((t,i)=>t.forEach((v,j)=>{
        const p=this.mesh.vertices[v],q=point(p[0],p[1],this.mesh.vertex_bed_m[i][j]);positions.push(q.x,q.y,q.z);
      }));
    }else{
      // Geometry preview of the backend's analytic terrain, not a flood result.
      for(let x=0;x<2400;x+=40)for(let y=0;y<2000;y+=40)
        for(const [px,py] of [[x,y],[x+40,y],[x,y+40],[x+40,y],[x+40,y+40],[x,y+40]]){
          const q=point(px,py);positions.push(q.x,q.y,q.z);
        }
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.computeVertexNormals();
    const terrain=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x426452,roughness:.94,side:THREE.DoubleSide}));
    terrain.receiveShadow=true;this.scene.add(terrain);
    const base=new THREE.Mesh(new THREE.BoxGeometry(60,1,50),new THREE.MeshStandardMaterial({color:0x293a32,roughness:1}));
    base.position.y=-1;this.scene.add(base);
    this.dynamic=new THREE.Group();this.scene.add(this.dynamic);
    this.modelGroup=new THREE.Group();this.scene.add(this.modelGroup);
    this.resourceGroup=new THREE.Group();this.scene.add(this.resourceGroup);
    this.labelGroup=new THREE.Group();this.scene.add(this.labelGroup);
  }
  addRoadsAndRoutes() {
    for(const r of this.city.roads){
      const p=r.geometry.map(p=>point(...p,(r.deck_elevation_m??ground(...p))+.1));
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p),new THREE.LineBasicMaterial({color:0x8d9da5})));
    }
  }
  addMarkers() {
    for(const f of this.city.facilities){
      if(f.kind==='depot')continue;
      const p=point(f.x,f.y),sprite=this.addMapLabel(f.id.replaceAll('-',' '),p.x,p.y+4,p.z,f.kind==='hospital'?'#ff7770':'#21d49b');
      this.labelGroup.attach(sprite);sprite.userData.kind=f.kind;
    }
  }
  addAgents() {} // No decorative looping residents. Positions arrive in snapshots.
  updateSimulationState() {} // Never synthesize hazard/agent state from a clock.
  async loadCityAssets() {
    try{
      const root=new URL('../assets/riverton-obj-assets/',import.meta.url).href;
      const materials=await new MTLLoader().loadAsync(root+'riverton.mtl');materials.preload();
      const loader=new OBJLoader().setMaterials(materials);
      const names=['office-tower','apartment-building','row-house','hospital','emergency-shelter','bridge','rescue-boat','ambulance','tree','flood-barrier','emergency-park'];
      const models=await Promise.all(names.map(n=>loader.loadAsync(root+n+'.obj')));
      if(this.disposed){models.forEach(disposeGroup);return;}
      this.models=Object.fromEntries(names.map((n,i)=>[n,models[i]]));
      for(const [i,b] of (this.city.buildings||[]).entries()){
        const source=this.models[['row-house','apartment-building','office-tower'][i%3]];
        this.place(source,b.x,b.y,i%3===0?.8:1.1,this.modelGroup);
      }
      for(const f of this.city.facilities){
        if(f.kind==='depot')continue;
        const obj=this.place(this.models[f.kind==='hospital'?'hospital':'emergency-shelter'],f.x,f.y,2.4,this.modelGroup);
        obj.userData.kind=f.kind;
      }
      for(const r of this.city.roads.filter(r=>r.bridge)){
        const a=r.geometry[0],b=r.geometry.at(-1);
        const obj=this.place(this.models.bridge,(a[0]+b[0])/2,(a[1]+b[1])/2,r.length_m*.025,this.modelGroup,r.deck_elevation_m);
        obj.rotation.y=-Math.atan2(b[1]-a[1],b[0]-a[0]);obj.userData.road=r.id;
      }
      this.loaded=true;this.refresh();
    }catch(error){
      if(!this.disposed)this.container.dispatchEvent(new CustomEvent('map-error',{detail:`OBJ models could not load: ${error.message}`}));
    }
  }
  place(source,x,y,size,group,z){
    const copy=source.clone(true),box=new THREE.Box3().setFromObject(copy),dims=box.getSize(new THREE.Vector3());
    const scale=size/Math.max(dims.x,dims.z,1),center=box.getCenter(new THREE.Vector3()),p=point(x,y,z);
    copy.scale.setScalar(scale);copy.position.set(p.x-center.x*scale,p.y-box.min.y*scale,p.z-center.z*scale);
    copy.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    group.add(copy);return copy;
  }
  update(snapshot,field){this.snapshot=snapshot;this.field=field;this.refresh();}
  refresh(){
    if(this.disposed||!this.dynamic)return;
    disposeGroup(this.dynamic);
    this.resourceGroup.clear(); // shared OBJ geometry stays owned by model cache
    const snapshot=this.snapshot;
    const legend=this.container.querySelector('.map-3d-legend');
    if(legend&&!this.legendUpdated){
      legend.children[1].lastChild.textContent='Current water depth';
      legend.children[2].lastChild.textContent='Assigned route';
      this.legendUpdated=true;
    }
    const hint=this.container.querySelector('.map-3d-hint');
    if(hint)hint.textContent='Drag to orbit · scroll to zoom · right-drag to pan · elevation ×14 · markers are a resident sample';
    const status=this.container.querySelector('.map-3d-status strong');
    if(status)status.textContent=snapshot?'3D city simulation · computed snapshot':'3D city model · geometry preview';
    const time=this.container.querySelector('#map-3d-hour');if(time)time.textContent=snapshot?`${(snapshot.time_s/60).toFixed(1)} min`:'No run';
    if(!snapshot)return;
    if(this.layers.flood&&this.field&&this.mesh){
      const positions=[];
      this.mesh.triangles.forEach((t,i)=>{
        if(this.field.depth_m[i]<.01)return;
        t.forEach(v=>{const p=this.mesh.vertices[v],q=point(...p,this.field.stage_m[i]+.03);positions.push(q.x,q.y,q.z);});
      });
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.computeVertexNormals();
      this.dynamic.add(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x157fb0,roughness:.3,metalness:.1,transparent:true,opacity:.78,side:THREE.DoubleSide})));
    }
    if(this.layers.roads){
      const closed=new Set(snapshot.roads.filter(r=>r.closed).map(r=>r.id));
      for(const r of this.city.roads){
        const positions=r.geometry.map(p=>point(...p,(r.deck_elevation_m??ground(...p))+.16));
        this.dynamic.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(positions),new THREE.LineBasicMaterial({color:closed.has(r.id)?0xef4444:0x8d9da5})));
        if(closed.has(r.id)&&this.models){
          const a=r.geometry[0],b=r.geometry.at(-1);
          this.place(this.models['flood-barrier'],(a[0]+b[0])/2,(a[1]+b[1])/2,1,this.resourceGroup,r.deck_elevation_m??undefined);
        }
      }
    }
    if(this.layers.routes)for(const r of snapshot.routes){
      const pts=r.nodes.map(id=>this.nodes[id]).filter(Boolean).map(n=>point(n.x,n.y,ground(n.x,n.y)+.3));
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineDashedMaterial({color:0x45e0e7,dashSize:.5,gapSize:.3}));
      line.computeLineDistances();this.dynamic.add(line);
    }
    if(this.layers.agents){
      const positions=snapshot.agents.filter(a=>a.state!=='sheltered').flatMap(a=>{const p=point(a.x,a.y,ground(a.x,a.y)+.6);return[p.x,p.y,p.z];});
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      this.dynamic.add(new THREE.Points(geo,new THREE.PointsMaterial({color:0xf7c84a,size:.18})));
    }
    if(this.layers.resources&&this.models)for(const r of snapshot.resources){
      let z=ground(r.x,r.y);
      if(r.kind==='boat'&&this.field&&this.mesh){
        let nearest=0,best=Infinity;this.mesh.centers.forEach((p,i)=>{const d=(p[0]-r.x)**2+(p[1]-r.y)**2;if(d<best){best=d;nearest=i;}});
        z=Math.max(z,this.field.stage_m[nearest]);
      }
      if(r.kind==='bus'){
        const p=point(r.x,r.y,z+.4),bus=new THREE.Mesh(new THREE.BoxGeometry(.9,.4,.4),new THREE.MeshStandardMaterial({color:0xe9b949}));
        bus.position.copy(p);this.dynamic.add(bus);
      }else this.place(this.models[r.kind==='boat'?'rescue-boat':'ambulance'],r.x,r.y,1.1,this.resourceGroup,z);
    }
  }
  animate(){
    if(this.disposed)return;
    this.controls.update();this.renderer.render(this.scene,this.camera);
    this.raf=requestAnimationFrame(()=>this.animate());
  }
  setPerspective(layer) {
    this.layers.flood=layer==='flood'||layer==='pop';this.layers.agents=layer==='pop';
    this.layers.roads=layer==='road'||layer==='pop';this.layers.routes=layer==='road';
    this.labelGroup.children.forEach(o=>o.visible=!['shelter','hospital'].includes(layer)||o.userData.kind===layer);
    this.modelGroup.children.forEach(o=>o.visible=!['shelter','hospital'].includes(layer)||o.userData.kind===layer);
    this.refresh();
  }
  dispose(){
    this.disposed=true;super.dispose();
    this.scene?.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else{o.material?.map?.dispose();o.material?.dispose();}});
  }
}
export async function mountOriginalMap(host,state,prefs,onNeighborhood) {
  window.CrisisData={NEIGHBORHOODS:state.city?.neighborhoods||[]};
  if(!state.city){host.textContent='Connect to the backend to load the city model.';return{update(){},dispose(){}};}
  const empty={agents:[],roads:[],routes:[],resources:[],time_s:0};
  if(prefs.mapMode==='2d'){
    host.innerHTML='<div class="map-3d-shell"><div class="map-3d-toolbar"><div class="map-3d-status"><strong>2D operations map</strong></div><div class="map-3d-actions"></div></div><div class="map-3d-canvas"></div><div class="map-3d-hint">Drag to pan · scroll to zoom · computed snapshots</div></div>';
    const canvas=host.querySelector('.map-3d-canvas');
    const map=new LiveMap(canvas,state.city,state.mesh||{triangles:[],vertices:[]},'2d');
    canvas.querySelector('svg').style.cssText='width:100%;height:100%;touch-action:none';
    const actions=host.querySelector('.map-3d-actions');
    for(const [label,fn] of [['Reset view',()=>map.reset()],['Zoom in',()=>map.zoom(.8)],['Zoom out',()=>map.zoom(1.25)],['3D map',()=>window.dispatchEvent(new CustomEvent('crisissim-map-mode-change',{detail:{mode:'3d'}}))]]){
      const b=document.createElement('button');b.className='map-3d-action';b.textContent=label;b.addEventListener('click',fn);actions.append(b);
    }
    map.update(state.snapshot||empty,state.field);return map;
  }
  const map=new ConnectedThreeMap(host.id,{city:state.city,mesh:state.mesh,isCompact:false,showControls:true,showLegend:host.id==='command-center-map-wrapper'||host.id==='city-model-map-wrapper',onNeighborhoodClick:onNeighborhood});
  map.update(state.snapshot,state.field);
  const actions=host.querySelector('.map-3d-actions');
  for(const [label,factor] of [['Zoom in',.8],['Zoom out',1.25]]){
    const b=document.createElement('button');b.className='map-3d-action';b.textContent=label;b.addEventListener('click',()=>{
      map.camera.position.sub(map.controls.target).multiplyScalar(factor).add(map.controls.target);map.controls.update();
    });actions?.append(b);
  }
  return map;
}
