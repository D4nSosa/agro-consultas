const unwrapFeature = input => input?.type === 'Feature' ? input.geometry :
  (input?.type === 'FeatureCollection' && input.features?.length === 1 ? input.features[0]?.geometry : input);
/**
 * geo.js - Utilidades geoespaciales para el módulo Análisis Forestal
 */

/**
 * Valida un objeto GeoJSON (Feature, Polygon, MultiPolygon o Point)
 */
export function validateGeoJSON(geojson) {
  if (!geojson || typeof geojson !== 'object' || Array.isArray(geojson)) return { valid:false,error:'Objeto GeoJSON no válido.' };
  let feature=geojson;
  if(geojson.type==='FeatureCollection'){
    if(!Array.isArray(geojson.features)||geojson.features.length!==1)return{valid:false,error:'La colección debe contener exactamente una geometría de lote.'};
    feature=geojson.features[0];
  }
  const geometry=feature.type==='Feature'?feature.geometry:feature;
  if(!geometry||!['Point','Polygon','MultiPolygon','LineString'].includes(geometry.type))return{valid:false,error:'Tipo GeoJSON no soportado.'};
  const pos=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[0]>=-180&&p[0]<=180&&p[1]>=-90&&p[1]<=90;
  const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const intersects=(a,b,c,d)=>{const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);return((o1>0&&o2<0)||(o1<0&&o2>0))&&((o3>0&&o4<0)||(o3<0&&o4>0));};
  const ringValid=ring=>{
    if(!Array.isArray(ring)||ring.length<4||!ring.every(pos)||ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])return false;
    const n=ring.length-1;let signedArea=0;
    for(let i=0;i<n;i++){
      signedArea+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];
      for(let j=i+1;j<n;j++){if(j===i+1||(i===0&&j===n-1))continue;if(intersects(ring[i],ring[i+1],ring[j],ring[j+1]))return false;}
    }
    return Math.abs(signedArea)>1e-12;
  };
  const pointInRing=(point,ring)=>{
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[i],b=ring[j];
      if(((a[1]>point[1])!==(b[1]>point[1]))&&(point[0]<(b[0]-a[0])*(point[1]-a[1])/((b[1]-a[1])||Number.EPSILON)+a[0]))inside=!inside;
    }
    return inside;
  };
  const ringsIntersect=(a,b)=>{
    for(let i=0;i<a.length-1;i++)for(let j=0;j<b.length-1;j++)if(intersects(a[i],a[i+1],b[j],b[j+1]))return true;
    return false;
  };
  const polygonValid=rings=>{
    if(!Array.isArray(rings)||!rings.length||!rings.every(ringValid))return false;
    const shell=rings[0],holes=rings.slice(1);
    for(let i=0;i<holes.length;i++){
      if(!pointInRing(holes[i][0],shell)||ringsIntersect(holes[i],shell))return false;
      for(let j=0;j<i;j++){
        if(ringsIntersect(holes[i],holes[j])||pointInRing(holes[i][0],holes[j])||pointInRing(holes[j][0],holes[i]))return false;
      }
    }
    return true;
  };
  if(geometry.type==='Point'&&!pos(geometry.coordinates))return{valid:false,error:'Punto fuera del rango WGS84.'};
  if(geometry.type==='LineString'&&(!Array.isArray(geometry.coordinates)||geometry.coordinates.length<2||!geometry.coordinates.every(pos)))return{valid:false,error:'LineString inválida.'};
  if(geometry.type==='Polygon'&&!polygonValid(geometry.coordinates))return{valid:false,error:'Anillos de Polygon inválidos, abiertos o autointersectados.'};
  if(geometry.type==='MultiPolygon'&&(!Array.isArray(geometry.coordinates)||!geometry.coordinates.length||!geometry.coordinates.every(polygonValid)))return{valid:false,error:'MultiPolygon inválido, vacío o con anillos autointersectados.'};
  return{valid:true,geometry,feature:feature.type==='Feature'?feature:toGeoJSONFeature(geometry)};
}

/**
 * Envuelve una geometría en una Feature GeoJSON estándar
 */
export function toGeoJSONFeature(geometry, properties = {}) {
  return {
    type: 'Feature',
    geometry: geometry,
    properties: {
      name: properties.name || 'Lote Forestal',
      createdAt: properties.createdAt || new Date().toISOString(),
      ...properties
    }
  };
}

/**
 * Calcula el área en hectáreas y metros cuadrados de una geometría Polygon/MultiPolygon
 */
export function calculateArea(input) {
  const geom=unwrapFeature(input);
  if(!geom)return{hectares:0,squareMeters:0,isPoint:false,valid:false,error:'Geometría ausente.'};
  if(geom.type==='Point')return{hectares:0,squareMeters:0,isPoint:true,message:'Un punto no posee superficie.'};
  const checked=validateGeoJSON(input);
  if(!checked.valid)return{hectares:0,squareMeters:0,isPoint:false,valid:false,error:checked.error};
  const polygons=geom.type==='Polygon'?[geom.coordinates]:geom.type==='MultiPolygon'?geom.coordinates:[];
  if(!polygons.length)return{hectares:0,squareMeters:0,isPoint:false,valid:false,error:'La geometría no representa una superficie.'};
  const radius=6371008.8;
  const ringArea=ring=>{let sum=0;for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1];sum+=(b[0]-a[0])*Math.PI/180*(2+Math.sin(a[1]*Math.PI/180)+Math.sin(b[1]*Math.PI/180));}return Math.abs(sum*radius*radius/2);};
  const area=polygons.reduce((total,rings)=>total+Math.max(0,ringArea(rings[0])-rings.slice(1).reduce((holes,ring)=>holes+ringArea(ring),0)),0);
  const squareMeters=Math.round(area*100)/100,hectares=Math.round(squareMeters/10000*100)/100;
  return{hectares,squareMeters,isPoint:false,valid:squareMeters>0,warning:hectares>10000?'AOI mayor a 10.000 ha: revisá el perímetro antes de analizar.':null,method:'Aproximación geodésica esférica WGS84; no equivale a mensura.'};
}

/**
 * Calcula el centroide [lat, lng] de una geometría
 */
export function calculateCentroid(input) {
  const geom=unwrapFeature(input);if(!geom)return null;
  if(geom.type==='Point'&&Array.isArray(geom.coordinates))return{lat:geom.coordinates[1],lng:geom.coordinates[0]};
  const polygons=geom.type==='Polygon'?[geom.coordinates]:geom.type==='MultiPolygon'?geom.coordinates:[];
  let weightedX=0,weightedY=0,totalWeight=0;
  for(const rings of polygons){
    const stats=rings.map((ring,index)=>{let crossSum=0,x=0,y=0;for(let i=0;i<ring.length-1;i++){const c=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];crossSum+=c;x+=(ring[i][0]+ring[i+1][0])*c;y+=(ring[i][1]+ring[i+1][1])*c;}if(Math.abs(crossSum)<1e-14)return null;return{lng:x/(3*crossSum),lat:y/(3*crossSum),weight:(index===0?1:-1)*Math.abs(crossSum/2)};}).filter(Boolean);
    const weight=stats.reduce((sum,v)=>sum+v.weight,0);if(weight<=0)continue;
    weightedX+=stats.reduce((sum,v)=>sum+v.lng*v.weight,0)/weight*weight;
    weightedY+=stats.reduce((sum,v)=>sum+v.lat*v.weight,0)/weight*weight;totalWeight+=weight;
  }
  if(totalWeight>0)return{lat:weightedY/totalWeight,lng:weightedX/totalWeight};
  if(geom.type==='LineString'&&geom.coordinates?.length){const p=geom.coordinates[Math.floor((geom.coordinates.length-1)/2)];return{lat:p[1],lng:p[0]};}
  return null;
}

/**
 * Retorna el Bounding Box [minLng, minLat, maxLng, maxLat]
 */
export function getBoundingBox(input) {
  const geom=unwrapFeature(input);if(!geom)return null;
  const points=[];const walk=value=>{if(Array.isArray(value)&&typeof value[0]==='number')points.push(value);else if(Array.isArray(value))value.forEach(walk);};
  walk(geom.type==='Point'?[geom.coordinates]:geom.coordinates);
  if(!points.length||points.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1])))return null;
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
}

/**
 * Exporta la geometría a formato KML para QField / SW Maps / Google Earth
 */
export function exportToKML(input,name='Lote Forestal') {
  const geom=unwrapFeature(input),checked=validateGeoJSON(input);if(!checked.valid)throw new Error(checked.error);
  const esc=v=>String(v??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
  const ring=r=>r.map(p=>p[0]+','+p[1]+',0').join(' ');
  const poly=rings=>'<Polygon><outerBoundaryIs><LinearRing><coordinates>'+ring(rings[0])+'</coordinates></LinearRing></outerBoundaryIs>'+rings.slice(1).map(r=>'<innerBoundaryIs><LinearRing><coordinates>'+ring(r)+'</coordinates></LinearRing></innerBoundaryIs>').join('')+'</Polygon>';
  let body='';if(geom.type==='Point')body='<Point><coordinates>'+geom.coordinates[0]+','+geom.coordinates[1]+',0</coordinates></Point>';
  else if(geom.type==='LineString')body='<LineString><coordinates>'+ring(geom.coordinates)+'</coordinates></LineString>';
  else if(geom.type==='Polygon')body=poly(geom.coordinates);else if(geom.type==='MultiPolygon')body='<MultiGeometry>'+geom.coordinates.map(poly).join('')+'</MultiGeometry>';
  return'<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>'+esc(name)+'</name><Placemark><name>'+esc(name)+'</name>'+body+'</Placemark></Document></kml>';
}

/**
 * Exporta la geometría a formato GPX para GPS de mano Garmin en campo
 */
export function exportToGPX(input,name='Lote Forestal') {
  const geom=unwrapFeature(input),checked=validateGeoJSON(input);if(!checked.valid)throw new Error(checked.error);
  const esc=v=>String(v??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
  const label=esc(name),centroid=calculateCentroid(geom);
  const track=(coords,title)=>'<trk><name>'+label+' - '+esc(title)+'</name><trkseg>'+coords.map((p,i)=>'<trkpt lat="'+p[1]+'" lon="'+p[0]+'"><name>Vértice '+(i+1)+'</name></trkpt>').join('')+'</trkseg></trk>';
  let tracks='';if(geom.type==='LineString')tracks=track(geom.coordinates,'Recorrido');
  if(geom.type==='Polygon')tracks=geom.coordinates.map((r,i)=>track(r,i?'Anillo interior '+i:'Perímetro')).join('');
  if(geom.type==='MultiPolygon')tracks=geom.coordinates.flatMap((poly,p)=>poly.map((r,i)=>track(r,'Polígono '+(p+1)+(i?' anillo interior '+i:' perímetro')))).join('');
  if(geom.type==='Point')tracks='<wpt lat="'+geom.coordinates[1]+'" lon="'+geom.coordinates[0]+'"><name>'+label+'</name></wpt>';
  const waypoint=centroid?'<wpt lat="'+centroid.lat+'" lon="'+centroid.lng+'"><name>'+label+' - Centroide</name></wpt>':'';
  return'<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Agro Consultas" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>'+label+'</name><time>'+new Date().toISOString()+'</time></metadata>'+waypoint+tracks+'</gpx>';
}

/**
 * Genera un script Python/PyQGIS para automatización en QGIS y PostGIS
 */
export function exportToPyQGISScript(input, name = 'Lote Forestal') {
  const geometry = unwrapFeature(input);
  const checked = validateGeoJSON(input);
  if (!checked.valid) throw new Error(checked.error);
  const feature = input?.type === 'Feature' ? input : toGeoJSONFeature(geometry);
  const geometryType = geometry.type === 'MultiPolygon' ? 'MultiPolygon'
    : geometry.type === 'Point' ? 'Point'
    : geometry.type === 'LineString' ? 'LineString' : 'Polygon';
  // JSON.stringify genera literales escapados válidos tanto para Python como para datos con comillas.
  const geojsonLiteral = JSON.stringify(JSON.stringify(feature));
  const layerTypeLiteral = JSON.stringify(geometryType + '?crs=EPSG:4326');
  const nameLiteral = JSON.stringify(String(name));
  return `# Script PyQGIS generado por Agro Consultas
import json
from qgis.core import QgsVectorLayer, QgsFeature, QgsGeometry, QgsProject

data = json.loads(${geojsonLiteral})
layer = QgsVectorLayer(${layerTypeLiteral}, ${nameLiteral}, "memory")
if not layer.isValid():
    raise RuntimeError("No se pudo crear la capa vectorial WGS84")
feature = QgsFeature()
geometry_json = json.dumps(data["geometry"], separators=(",", ":"))
feature.setGeometry(QgsGeometry.fromJson(geometry_json.encode("utf-8")))
layer.dataProvider().addFeatures([feature])
layer.updateExtents()
QgsProject.instance().addMapLayer(layer)
print("Capa cargada. Verificar geometría y CRS antes de usarla.")
`;
}
