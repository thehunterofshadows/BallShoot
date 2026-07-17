'use strict';

const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');
const lobbies = require('./lobbies');

function createServer() {
  const server=http.createServer((req,res)=>{if(req.url==='/healthz'){res.writeHead(200,{'content-type':'text/plain'});res.end('ok\n');return;}res.writeHead(404);res.end();});
  const wss=new WebSocketServer({server,path:'/ws',maxPayload:8192});
  wss.on('connection',(ws,req)=>{
    ws.alive=true;ws.on('pong',()=>{ws.alive=true;});
    const address=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();
    const send=(type,payload={})=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type,...payload}));};
    ws.on('message',raw=>{let msg;try{msg=JSON.parse(raw.toString());if(!msg||typeof msg.type!=='string')throw lobbies.fail('bad_message','Message type is required.');
      let current=lobbies.findBySocket(ws), result;
      if(msg.type==='create'){result=lobbies.create(msg.name,ws,address);send('joined',{token:result.p.token,playerId:result.p.id,room:lobbies.publicRoom(result.room)});lobbies.broadcastState(result.room);return;}
      if(msg.type==='join'){result=lobbies.join(msg.code,msg.name,ws,address);send('joined',{token:result.p.token,playerId:result.p.id,room:lobbies.publicRoom(result.room)});return;}
      if(msg.type==='rejoin'){result=lobbies.rejoin(msg.code,msg.token,ws);send('joined',{token:result.p.token,playerId:result.p.id,room:lobbies.publicRoom(result.room),snapshot:result.room.game?.snapshot()});return;}
      if(!current.room)throw lobbies.fail('not_joined','Join a room first.'); const {room,p}=current;
      switch(msg.type){case'update_settings':lobbies.updateSettings(room,p,msg.settings,msg.revision);break;case'start':lobbies.start(room,p);break;
        case'input':if(Number(msg.seq)>p.inputSeq){p.inputSeq=Number(msg.seq);room.game?.input(p.id,msg.held||{});}break;
        case'fire':room.game?.fire(p.id);break;case'pause':lobbies.pause(room,p,true);break;case'resume':lobbies.pause(room,p,false);break;
        case'restart':lobbies.restart(room,p);break;case'return_to_lobby':lobbies.returnToLobby(room,p);break;case'leave':lobbies.disconnect(room,p,true);send('left');break;
        default:throw lobbies.fail('bad_message','Unknown message type.');}
    }catch(error){send('error',{code:error.code||'bad_message',message:error.message||'Invalid message.'});}});
    ws.on('close',()=>{const {room,p}=lobbies.findBySocket(ws);if(room)lobbies.disconnect(room,p,false);});
  });
  const tick=setInterval(()=>lobbies.tick(1/60),1000/60), snapshots=setInterval(()=>lobbies.snapshots(),50), sweep=setInterval(()=>lobbies.sweep(),30_000);
  const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}},30_000);
  server.on('close',()=>{clearInterval(tick);clearInterval(snapshots);clearInterval(sweep);clearInterval(heartbeat);lobbies.clear();});
  return {server,wss};
}

if(require.main===module){const{server}=createServer();server.listen(Number(process.env.PORT)||8080,'0.0.0.0',()=>console.log('BallShoot game server listening on 8080'));}
module.exports={createServer};
