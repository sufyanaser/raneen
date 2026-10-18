import {useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default function Map({lat,lng,onChange}:{lat?:number;lng?:number;onChange?:(lat:number,lng:number)=>void}){
  const el=useRef<HTMLDivElement>(null);
  const mapRef=useRef<L.Map|null>(null);
  const markerRef=useRef<L.CircleMarker|null>(null);
  const cb=useRef(onChange);
  cb.current=onChange;

  useEffect(()=>{
    if(!el.current)return;
    const initialLat=lat??33.425;
    const initialLng=lng??43.3;
    const m=L.map(el.current).setView([initialLat,initialLng],lat===undefined?11:16);
    mapRef.current=m;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      attribution:'© OpenStreetMap',
      maxZoom:19,
    }).addTo(m);

    const marker=L.circleMarker([initialLat,initialLng],{
      radius:12,
      color:'#ffffff',
      weight:3,
      fillColor:'#b45e24',
      fillOpacity:0.9,
    }).addTo(m);
    markerRef.current=marker;

    if(cb.current){
      m.on('click',(e:L.LeafletMouseEvent)=>{
        marker.setLatLng(e.latlng);
        cb.current?.(e.latlng.lat,e.latlng.lng);
      });
    }

    return()=>{
      m.remove();
      mapRef.current=null;
      markerRef.current=null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  useEffect(()=>{
    if(lat!==undefined&&lng!==undefined&&markerRef.current&&mapRef.current){
      markerRef.current.setLatLng([lat,lng]);
      mapRef.current.setView([lat,lng],Math.max(mapRef.current.getZoom(),16));
    }
  },[lat,lng]);

  return <div ref={el} className="map" aria-label="خريطة الموقع؛ اضغط لتصحيح الدبوس"/>;
}
