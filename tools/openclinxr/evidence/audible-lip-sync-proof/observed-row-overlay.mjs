import {DataTexture, Mesh, MeshBasicMaterial, NearestFilter, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene} from "three";
import {encodeObservedRowMarker} from "./observed-row-barcode.mjs";

/** Actual GL bottom strip. Only the strip is uploaded; texture-row orientation cannot move its placement. */
export function createObservedRowOverlay() {
  const layout=encodeObservedRowMarker({callbackSerial:0,generation:"fixture:0",nodeSerial:0}).layout;
  const width=layout.cellPx*layout.bitCount;
  const data=new Uint8Array(width*layout.stripPx*4);
  const texture=new DataTexture(data,width,layout.stripPx,RGBAFormat);
  texture.magFilter=texture.minFilter=NearestFilter;
  texture.flipY=false;
  const scene=new Scene();
  const camera=new OrthographicCamera(-1,1,1,-1,0,1);
  const geometry=new PlaneGeometry(2*width/layout.viewport,2*layout.stripPx/layout.viewport);
  const material=new MeshBasicMaterial({map:texture,depthTest:false,depthWrite:false,toneMapped:false});
  const quad=new Mesh(geometry,material);
  quad.position.set(2*(layout.x0+width/2)/layout.viewport-1,1-2*(layout.y0+layout.stripPx/2)/layout.viewport,0);
  scene.add(quad);
  return {
    render(renderer,row) {
      const marker=encodeObservedRowMarker(row);
      for(let y=0;y<layout.stripPx;y++)for(let bit=0;bit<marker.bits.length;bit++)for(let dx=0;dx<layout.cellPx;dx++){
        const at=(y*width+bit*layout.cellPx+dx)*4;
        const value=marker.bits[bit]?255:0;
        data[at]=data[at+1]=data[at+2]=value;data[at+3]=255;
      }
      texture.needsUpdate=true;
      const previous=renderer.autoClear;
      try {renderer.autoClear=false;renderer.clearDepth();renderer.render(scene,camera);}
      finally {renderer.autoClear=previous;}
      return marker;
    },
    dispose(){texture.dispose();geometry.dispose();material.dispose();},
    layout,
    textureBytes:data.length,
  };
}
