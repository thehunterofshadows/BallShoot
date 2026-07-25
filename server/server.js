'use strict';

const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');
const lobbies = require('./lobbies');
const { Scores } = require('./scores');

/* The leaderboard is served over plain HTTP rather than the room socket so that Local
   offline play — which never opens a WebSocket — can read and post scores too. */
function scoreRoutes(scores) {
  const json = (res, code, body) => { res.writeHead(code, { 'content-type':'application/json', 'cache-control':'no-store' }); res.end(JSON.stringify(body)); };
  const clientAddress = req => String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();
  return (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/scores') return false;
    if (req.method === 'GET') {
      const mode = url.searchParams.get('mode') || 'clear', level = url.searchParams.get('level');
      try { json(res, 200, { entries: scores.list(mode, level === null ? 0 : level) }); }
      catch (e) { json(res, 400, { code: e.code || 'bad_request', message: e.message }); }
      return true;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 2048) req.destroy(); });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = scores.submit({ initials: payload.initials, score: payload.score,
            mode: payload.mode, level: payload.level }, clientAddress(req));
          json(res, 200, result);
        } catch (e) { json(res, e.code === 'rate_limited' ? 429 : 400, { code: e.code || 'bad_request', message: e.message || 'Invalid submission.' }); }
      });
      return true;
    }
    json(res, 405, { code:'bad_method', message:'Use GET or POST.' });
    return true;
  };
}

function createServer() {
  const scores = new Scores();
  const routeScores = scoreRoutes(scores);
  const server=http.createServer((req,res)=>{if(req.url==='/healthz'){res.writeHead(200,{'content-type':'text/plain'});res.end('ok\n');return;}if(routeScores(req,res))return;res.writeHead(404);res.end();});
  const wss=new WebSocketServer({server,path:'/ws',maxPayload:8192});
  wss.on('connection',(ws,req)=>{
    ws.alive=true;ws.on('pong',()=>{ws.alive=true;});
    const address=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();
    const send=(type,payload={})=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type,...payload}));};
    ws.on('message',raw=>{let msg;try{msg=JSON.parse(raw.toString());if(!msg||typeof msg.type!=='string')throw lobbies.fail('bad_message','Message type is required.');
      let current=lobbies.findBySocket(ws), result;
      if(msg.type==='create'){result=lobbies.create(msg.name,ws,address);send('joined',{token:result.p.token,playerId:result.p.id,room:lobbies.publicRoom(result.room)});lobbies.broadcastState(result.room);return;}
      if(msg.type==='join'){result=lobbies.join(msg.code,msg.name,ws,address);send('joined',{token:result.p.token,playerId:result.p.id,room:lobbies.publicRoom(result.room)});return;}
      if(msg.type==='rejoin'){result=lobbies.rejoin(msg.code,msg.token,ws);send('joined',{token:result.p.token,playerId:result.p.id,room:lobbies.publicRoom(result.room),snapshot:result.room.game?.snapshotFor(result.p.id,true)});return;}
      if(!current.room)throw lobbies.fail('not_joined','Join a room first.'); const {room,p}=current;
      switch(msg.type){case'update_settings':lobbies.updateSettings(room,p,msg.settings,msg.revision);break;case'start':lobbies.start(room,p);break;
        case'input':if(Number(msg.seq)>p.inputSeq){p.inputSeq=Number(msg.seq);room.game?.input(p.id,msg.held||{});}break;
        case'fire':room.game?.fire(p.id);break;case'swap':room.game?.swap(p.id);break;case'target':if(room.settings.mode!=='battle')throw lobbies.fail('bad_message','Targeting is only available in battle mode.');room.game?.target(p.id,String(msg.targetId||''));break;case'pause':lobbies.pause(room,p,true);break;case'resume':lobbies.pause(room,p,false);break;
        case'restart':lobbies.restart(room,p);break;case'return_to_lobby':lobbies.returnToLobby(room,p);break;case'leave':lobbies.disconnect(room,p,true);send('left');break;
        default:throw lobbies.fail('bad_message','Unknown message type.');}
    }catch(error){send('error',{code:error.code||'bad_message',message:error.message||'Invalid message.'});}});
    ws.on('close',()=>{const {room,p}=lobbies.findBySocket(ws);if(room)lobbies.disconnect(room,p,false);});
  });
  const tick=setInterval(()=>lobbies.tick(1/60),1000/60), snapshots=setInterval(()=>lobbies.snapshots(),50), sweep=setInterval(()=>lobbies.sweep(),30_000);
  const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}},30_000);
  server.on('close',()=>{clearInterval(tick);clearInterval(snapshots);clearInterval(sweep);clearInterval(heartbeat);lobbies.clear();scores.close();});
  return {server,wss,scores};
}

if(require.main===module){const{server}=createServer();server.listen(Number(process.env.PORT)||8080,'0.0.0.0',()=>console.log('BallShoot game server listening on 8080'));}
module.exports={createServer};
