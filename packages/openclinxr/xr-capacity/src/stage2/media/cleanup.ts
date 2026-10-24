/** Independent best-effort releases: one throwing object never prevents the rest from closing. */
export function stage2ReleaseObjects(resources:{peer?:Pick<RTCPeerConnection,'close'|'connectionState'>|undefined;tracks:Iterable<Pick<MediaStreamTrack,'stop'|'readyState'>>;nodes:Iterable<Pick<AudioNode,'disconnect'>>;observers:Iterable<{close():void}>;listeners:Array<()=>void>},fault:(reason:string)=>void):{peers:number;tracks:number;nodes:number;ports:number;listeners:number} {
 const left={peers:0,tracks:0,nodes:0,ports:0,listeners:0};
 if(resources.peer){try{resources.peer.close();}catch(error){fault(`peer close: ${String(error)}`);}left.peers=resources.peer.connectionState==='closed'?0:1;}
 for(const track of resources.tracks){try{track.stop();}catch(error){fault(`track stop: ${String(error)}`);}if(track.readyState!=='ended')left.tracks++;}
 for(const remove of resources.listeners.splice(0)){try{remove();}catch(error){left.listeners++;fault(`listener removal: ${String(error)}`);}}
 for(const node of resources.nodes){try{node.disconnect();}catch(error){left.nodes++;fault(`node disconnect: ${String(error)}`);}}
 for(const observer of resources.observers){try{observer.close();}catch(error){left.ports++;fault(`port close: ${String(error)}`);}}
 return left;
}
