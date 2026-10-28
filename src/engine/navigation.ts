/** Cardinal navigation over the existing authorized plot graph. Buildings retain the
 * broker's existing traversability; no new street, cross-district edge or access right. */
export interface GridPoint {x:number;y:number}
export const pointKey=(p:GridPoint)=>`${p.x},${p.y}`;
export const adjacent=(a:GridPoint,b:GridPoint)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)===1;
export function reachablePlots(plots:readonly GridPoint[],from:GridPoint):GridPoint[]{
  if(plots.length>5000||!plots.every(p=>Number.isSafeInteger(p.x)&&Number.isSafeInteger(p.y)))throw Error('navigation_grid');
  const points=new Map(plots.map(p=>[pointKey(p),p]));
  if(points.size!==plots.length||!points.has(pointKey(from)))throw Error('navigation_origin');
  const queue=[from],seen=new Set([pointKey(from)]);
  for(let i=0;i<queue.length;i++)for(const p of cardinalNeighbors(queue[i]!))if(points.has(pointKey(p))&&!seen.has(pointKey(p))){seen.add(pointKey(p));queue.push(p);}
  return plots.filter(p=>seen.has(pointKey(p))&&pointKey(p)!==pointKey(from)).map(p=>({x:p.x,y:p.y}));
}
export function cardinalNeighbors(p:GridPoint):GridPoint[]{return [{x:p.x-1,y:p.y},{x:p.x,y:p.y-1},{x:p.x,y:p.y+1},{x:p.x+1,y:p.y}];}
export function shortestGridPath(plots:readonly GridPoint[],from:GridPoint,to:GridPoint):GridPoint[]{
  reachablePlots(plots,from);
  const points=new Map(plots.map(p=>[pointKey(p),p])),previous=new Map<string,GridPoint|null>([[pointKey(from),null]]),queue=[from];
  for(let i=0;i<queue.length&&!previous.has(pointKey(to));i++)for(const p of cardinalNeighbors(queue[i]!))if(points.has(pointKey(p))&&!previous.has(pointKey(p))){previous.set(pointKey(p),queue[i]!);queue.push(p);}
  if(!previous.has(pointKey(to)))throw Error('navigation_unreachable');
  const path:GridPoint[]=[];let p:GridPoint|null=to;
  while(p&&pointKey(p)!==pointKey(from)){path.push({x:p.x,y:p.y});p=previous.get(pointKey(p))!;}
  return path.reverse();
}
export function assertGridPath(plots:readonly GridPoint[],from:GridPoint,to:GridPoint,path:readonly GridPoint[]):void{
  const expected=shortestGridPath(plots,from,to),points=new Set(plots.map(pointKey)),visited=new Set([pointKey(from)]);
  if(path.length!==expected.length)throw Error('navigation_path_length');
  let previous=from;
  for(const p of path){if(!p||Object.keys(p).sort().join(',')!=='x,y'||!Number.isSafeInteger(p.x)||!Number.isSafeInteger(p.y)||!points.has(pointKey(p))||!adjacent(previous,p)||visited.has(pointKey(p)))throw Error('navigation_invalid_step');visited.add(pointKey(p));previous=p;}
  if(pointKey(previous)!==pointKey(to))throw Error('navigation_wrong_arrival');
}
